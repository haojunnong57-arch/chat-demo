import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslationMessage } from '../../i18n/index.js'
import { transcribe } from '../../services/api/speech.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

/**
 * 录音依赖 getUserMedia，只在安全上下文可用（HTTPS、localhost、file://）。
 * 普通 HTTP 页面上直接禁用入口，避免点击后必然失败。
 */
const AVAILABLE = typeof window === 'undefined' || window.isSecureContext

const describeRecordingError = (error: unknown): TranslationMessage => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return { key: 'voiceInputPermissionDenied' }
    }
    if (error.name === 'NotFoundError') {
      return { key: 'voiceInputNoDevice' }
    }
    // 安卓 WebView 里麦克风被其它应用占用、或权限刚撤销时常见
    if (error.name === 'NotReadableError' || error.name === 'AbortError' || error.name === 'TrackStartError') {
      return { key: 'voiceInputMicBusy' }
    }
  }
  return { key: 'voiceInputFailed' }
}

type VoiceInputOptions = {
  /** 转写并插入草稿后触发；按住说话用它来自动发送 */
  onComplete?: (text: string) => void
}

/**
 * 语音输入：按住开始录音，松手结束并转写。
 * 转写结果先交给 onText 插入草稿；如果提供了 onComplete，再在状态回到 idle 后回调。
 * 录满 120 秒自动结束。
 */
export const useVoiceInput = (onText: (text: string) => void, options: VoiceInputOptions = {}) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  /** 本次录音已录秒数，只在录音中递增 */
  const [seconds, setSeconds] = useState(0)
  const recordingRef = useRef<Recording | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const operationRef = useRef(0)
  const pendingStopRef = useRef(false)
  const onTextRef = useRef(onText)
  const onCompleteRef = useRef(options.onComplete)
  onTextRef.current = onText
  onCompleteRef.current = options.onComplete

  const cancelOperation = useCallback(() => {
    operationRef.current++
    pendingStopRef.current = false
    recordingRef.current?.cancel()
    recordingRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const cancel = useCallback(() => {
    cancelOperation()
    setStatus('idle')
  }, [cancelOperation])

  const finish = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording) {
      // 还在等待麦克风授权就松手了：等录音对象创建后立刻结束，而不是丢掉这次操作。
      pendingStopRef.current = true
      return
    }
    pendingStopRef.current = false
    const operation = operationRef.current
    recordingRef.current = null
    let controller: AbortController | null = null
    let recognized = ''
    try {
      let audio: Blob | null
      try {
        audio = await recording.stop()
      } finally {
        recording.cancel()
      }
      if (operationRef.current !== operation || !audio) {
        return
      }
      controller = new AbortController()
      controllerRef.current = controller
      setStatus('transcribing')
      const text = await transcribe(useSettings.getState().apiKey ?? '', audio, controller.signal)
      if (controller.signal.aborted || operationRef.current !== operation) {
        return
      }
      recognized = text.trim()
      if (recognized) {
        onTextRef.current(recognized)
      } else {
        showToast({ key: 'voiceInputEmpty' })
      }
    } catch {
      if (operationRef.current === operation && !controller?.signal.aborted) {
        showToast({ key: 'voiceInputFailed' })
      }
    } finally {
      if (operationRef.current === operation) {
        controllerRef.current = null
        setStatus('idle')
        if (recognized) {
          onCompleteRef.current?.(recognized)
        }
      }
    }
  }, [])

  const start = useCallback(async () => {
    if (!AVAILABLE || status !== 'idle') {
      return
    }
    pendingStopRef.current = false
    const operation = ++operationRef.current
    setStatus('recording')
    try {
      const recording = await startRecording(() => {
        if (operationRef.current === operation) {
          showToast({ key: 'voiceInputLimitReached' })
          void finish()
        }
      })
      if (operationRef.current !== operation) {
        recording.cancel()
        return
      }
      recordingRef.current = recording
      if (pendingStopRef.current) {
        void finish()
      }
    } catch (error) {
      if (operationRef.current === operation) {
        setStatus('idle')
        showToast(describeRecordingError(error))
      }
    }
  }, [status, finish])

  const toggle = useCallback(async () => {
    if (status === 'recording') {
      await finish()
      return
    }
    if (status === 'transcribing') {
      cancel()
      return
    }
    await start()
  }, [status, start, finish, cancel])

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    // 半秒刷新一次，让显示的秒数与实际录音时长保持一致
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => cancelOperation, [cancelOperation])

  /** 当前录音的频谱分析节点，未录音时为 null */
  const getAnalyser = useCallback(() => recordingRef.current?.analyser ?? null, [])

  return { status, seconds, getAnalyser, start, finish, toggle, cancel, available: AVAILABLE }
}
