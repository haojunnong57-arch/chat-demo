import { create } from 'zustand'
import type { Message, Session } from './types.js'

/** 保守上限：DeepSeek 长上下文很宽，但按 3.2 万 token 控制更稳、更省钱。 */
export const CONTEXT_LIMIT = 32000

/** 压缩模式：自动（接近上限再压）/ 每 50 轮固定压一次。 */
export type CompactionMode = 'auto' | 'every50'

export type Compaction = {
  /** 压缩到哪条消息为止（含），这条之前的消息不再逐条进请求 */
  uptoId: string
  /** 本地摘出的长期记忆 */
  digest: string
  /** 压缩时间 */
  at: number
  /** 压缩了多少条消息 */
  count: number
}

const STORE_KEY = 'chat-demo:context-compaction'

const read = (): Record<string, Compaction> => {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, Compaction>) : {}
  } catch {
    return {}
  }
}

const persist = (records: Record<string, Compaction>) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(records))
  } catch {
    // 存储不可用时只在内存里生效
  }
}

/** 压缩记录：按会话 id 存，切库、导入都不会互相污染。 */
export const useContextCompaction = create<{ records: Record<string, Compaction> }>(() => ({
  records: read(),
}))

export const getCompaction = (sessionId: string): Compaction | null =>
  useContextCompaction.getState().records[sessionId] ?? null

const setCompaction = (sessionId: string, record: Compaction | null) => {
  const records = { ...useContextCompaction.getState().records }
  if (record) {
    records[sessionId] = record
  } else {
    Reflect.deleteProperty(records, sessionId)
  }
  persist(records)
  useContextCompaction.setState({ records })
}

export const clearCompaction = (sessionId: string) => setCompaction(sessionId, null)

/**
 * 粗算 token：
 * 中日韩字符按 1 字 ≈ 1 token，西文按 4 字符 ≈ 1 token，其余符号统一折半。
 * 只用于进度提示与阈值判断，不追求与分词器完全一致。
 */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  let cjk = 0
  let latin = 0
  let other = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1
    } else if (code < 0x80) {
      latin += 1
    } else {
      other += 1
    }
  }
  return Math.ceil(cjk + latin / 4 + other / 2)
}

const messageText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  // 助手消息取已完成的正文块，思考与工具调用不计入上下文占用
  return message.blocks
    .map((block) => {
      if (block.type === 'text') {
        return block.text
      }
      return ''
    })
    .join('\n')
}

/** 估算一段会话的 token 占用（含角色指令与系统提示的粗略底数）。 */
export const estimateSessionTokens = (session: Session, systemPrompt = ''): number => {
  const messages = session.messages.reduce((total, message) => total + estimateTokens(messageText(message)), 0)
  return messages + estimateTokens(systemPrompt) + estimateTokens(session.instructions ?? '') + 1200
}

/** 压缩后不再逐条发送的消息条数 */
export const compactedCount = (session: Session): number => {
  const record = getCompaction(session.id)
  if (!record) {
    return 0
  }
  const index = session.messages.findIndex((message) => message.id === record.uptoId)
  return index < 0 ? 0 : index + 1
}

/** 按压缩边界裁掉早期消息，只把边界之后的部分逐条送进请求。 */
export const trimForRequest = <T extends { id: string }>(sessionId: string, messages: T[]): T[] => {
  const record = getCompaction(sessionId)
  if (!record) {
    return messages
  }
  const index = messages.findIndex((message) => message.id === record.uptoId)
  return index < 0 ? messages : messages.slice(index + 1)
}

const stamp = (timestamp: number) => {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 单条消息在长期记忆里保留的长度 */
const DIGEST_ITEM = 90
/** 长期记忆总长度上限，太长反而挤占上下文 */
const DIGEST_MAX = 2400

/**
 * 本地压缩：不调用模型、不产生费用，把早期消息抽成时间线式的长期记忆。
 * 保留“谁在什么时候说了什么”的骨架，细节交给模型按需追问。
 */
export const buildDigest = (messages: Message[], limit = DIGEST_MAX): string => {
  const lines = messages.map((message) => {
    const speaker = message.role === 'user' ? '用户' : '角色'
    const text = messageText(message).replace(/\s+/g, ' ').trim().slice(0, DIGEST_ITEM)
    return `[${stamp(message.createdAt)}] ${speaker}：${text}`
  })
  // 从最近往前拼，保证旧记忆被挤掉时丢掉的是最早的部分
  const kept: string[] = []
  let total = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (total + line.length > limit) {
      break
    }
    kept.unshift(line)
    total += line.length
  }
  return kept.join('\n')
}

/** 需要压缩时返回新的压缩记录；不需要时返回 null。 */
export const planCompaction = (
  session: Session,
  mode: CompactionMode,
  systemPrompt = ''
): Compaction | null => {
  const records = useContextCompaction.getState().records
  const prev = records[session.id]
  const startIndex = prev
    ? session.messages.findIndex((message) => message.id === prev.uptoId) + 1
    : 0
  const pending = session.messages.length - startIndex
  // 至少留最近 6 条不压，否则模型会丢失当前语境
  const keepTail = 6
  if (pending <= keepTail + 4) {
    return null
  }

  const shouldCompact =
    mode === 'every50'
      ? session.messages.length >= 50 && session.messages.length % 50 < 8
      : estimateSessionTokens(session, systemPrompt) >= CONTEXT_LIMIT * 0.72

  if (!shouldCompact) {
    return null
  }

  const cutoff = session.messages.length - keepTail
  const target = session.messages[cutoff - 1]
  if (!target) {
    return null
  }
  const slice = session.messages.slice(startIndex, cutoff)
  const digest = [prev?.digest, buildDigest(slice)].filter(Boolean).join('\n')
  return {
    uptoId: target.id,
    digest: digest.length > DIGEST_MAX * 2 ? digest.slice(-DIGEST_MAX * 2) : digest,
    at: Date.now(),
    count: session.messages.length,
  }
}

/** 立即压缩：强制把除最近 6 条以外的消息全部折叠成长期记忆。 */
export const compactNow = (session: Session): Compaction | null => {
  const keepTail = 6
  if (session.messages.length <= keepTail + 2) {
    return null
  }
  const prev = getCompaction(session.id)
  const startIndex = prev
    ? session.messages.findIndex((message) => message.id === prev.uptoId) + 1
    : 0
  const cutoff = session.messages.length - keepTail
  const target = session.messages[cutoff - 1]
  if (!target || cutoff <= startIndex) {
    return null
  }
  const slice = session.messages.slice(startIndex, cutoff)
  const digest = [prev?.digest, buildDigest(slice)].filter(Boolean).join('\n')
  const record: Compaction = {
    uptoId: target.id,
    digest: digest.length > DIGEST_MAX * 2 ? digest.slice(-DIGEST_MAX * 2) : digest,
    at: Date.now(),
    count: session.messages.length,
  }
  setCompaction(session.id, record)
  return record
}

/** 把压缩记录写入：供自动压缩使用 */
export const applyCompaction = (sessionId: string, record: Compaction) => setCompaction(sessionId, record)
