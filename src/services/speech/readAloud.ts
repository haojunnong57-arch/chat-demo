import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { useSettings } from '../settings.js'

/**
 * 朗读：同一时间只读一条回复。
 * 请求 TTS 的裸 PCM 流，边收边用 AudioContext 按顺序排程播放，首帧到达即出声。
 * 状态：loading（已请求、未出声）→ playing → 结束回到 idle。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

/** 首帧前多缓冲一点，减少网络抖动造成的断续 */
const START_DELAY = 0.1

type Current = {
  controller: AbortController
  context: AudioContext
  sources: Set<AudioBufferSourceNode>
}

let current: Current | null = null
/** 复用一个 AudioContext：发送时用静音帧解锁，自动朗读才能在回复结束后出声 */
let sharedContext: AudioContext | null = null

const getContext = (): AudioContext => {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  }
  if (sharedContext.state === 'suspended') {
    void sharedContext.resume().catch(() => {})
  }
  return sharedContext
}

/** 在用户点击发送的手势里调用，解锁后续自动朗读 */
export const primeReadAloud = () => {
  try {
    const context = getContext()
    const source = context.createBufferSource()
    source.buffer = context.createBuffer(1, 1, context.sampleRate)
    source.connect(context.destination)
    source.start(0)
  } catch {
    // 解锁失败只影响自动朗读，不影响聊天
  }
}

const finish = (controller: AbortController) => {
  if (current?.controller !== controller) {
    return
  }
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（发送、停止生成、切换会话等场景调用） */
export const stopReadAloud = () => {
  const active = current
  if (!active) {
    return
  }
  active.controller.abort()
  for (const source of active.sources) {
    try {
      source.stop()
    } catch {
      // 已经自然播完的节点再次 stop 会抛错，忽略即可
    }
  }
  active.sources.clear()
  finish(active.controller)
}

/** 16-bit 小端 PCM 转成 Float32；奇数字节留到下一段 */
const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  // 400 表示这段正文服务端无法合成，与其余失败区分开
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return { key: 'ttsFailed' }
  }
}

const begin = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void,
  toggle: boolean
) => {
  const reading = useReadAloud.getState().messageId
  if (toggle && reading === messageId) {
    stopReadAloud()
    return
  }
  stopReadAloud()
  const controller = new AbortController()
  const context = getContext()
  const sources = new Set<AudioBufferSourceNode>()
  current = { controller, context, sources }
  useReadAloud.setState({ messageId, status: 'loading' })
  // 音色在开始朗读时读取，设置中切换后下一次朗读生效
  const { apiKey, ttsVoice } = useSettings.getState()

  void (async () => {
    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)
    try {
      const stream = await synthesize(apiKey ?? '', text, ttsVoice, controller.signal)
      const reader = stream.getReader()
      controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        // 网络慢于播放时从当前时间续上，不补播过去的时间
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        sources.add(source)
        if (useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
        }
      }
      if (lastSource) {
        const finalSource = lastSource
        finalSource.onended = () => {
          sources.delete(finalSource)
          if (sources.size === 0) {
            finish(controller)
          }
        }
      } else {
        finish(controller)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        finish(controller)
        onError(error)
      }
    }
  })()
}

/**
 * 开始朗读一条回复的正文；同一条正在朗读时调用等于停止。
 * 必须在点击事件中同步调用：AudioContext 需要用户手势才能出声。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  begin(messageId, text, onError, true)
}

/** 自动朗读入口：即使该条正在朗读也重新开始，不做 toggle。 */
export const startReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  begin(messageId, text, onError, false)
}
