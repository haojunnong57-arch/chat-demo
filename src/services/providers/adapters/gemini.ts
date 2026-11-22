import type { CreateMessageRequest, MessageParam, MessageStreamEvent } from '../../api/types.js'

// ---------- 线协议类型 ----------

export type GeminiChunkPart = { text?: string }
export type GeminiChunk = {
  candidates?: Array<{
    content?: { parts?: GeminiChunkPart[]; role?: string }
    finishReason?: string
  }>
}

// ---------- 请求翻译：Anthropic 形态 → Gemini generateContent ----------

type GeminiContent = { role: 'user' | 'model'; parts: { text: string }[] }

const userText = (blocks: Extract<MessageParam, { role: 'user' }>['content']): string => {
  if (typeof blocks === 'string') {
    return blocks
  }
  return blocks
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

export const toGeminiRequest = (body: CreateMessageRequest): Record<string, unknown> => {
  const contents: GeminiContent[] = []
  let system = body.system ?? ''

  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      system = system ? `${system}\n\n${message.content}` : message.content
      continue
    }
    if (message.role === 'user') {
      const text = userText(message.content)
      if (text) {
        contents.push({ role: 'user', parts: [{ text }] })
      }
      continue
    }
    const text = message.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    if (text) {
      contents.push({ role: 'model', parts: [{ text }] })
    }
  }

  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    // 当前协议暂不支持 MCP 工具调用：不声明 tools，避免模型静默等待工具结果。
  }
}

// ---------- 流式装配：Gemini 增量 → 统一 MessageStreamEvent ----------

/**
 * 逐 chunk 装配文本增量；Gemini 没有独立的思考通道与工具调用回传，
 * 结束时统一按 end_turn 收尾。
 */
export class GeminiAssembler {
  private started = false
  private textStarted = false
  private readonly textIndex = 0

  push(chunk: GeminiChunk): MessageStreamEvent[] {
    const events: MessageStreamEvent[] = []
    if (!this.started) {
      this.started = true
      events.push({ type: 'message_start', message: { id: 'gemini', model: '' } })
    }
    const candidate = chunk.candidates?.[0]
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text !== 'string' || !part.text) {
        continue
      }
      if (!this.textStarted) {
        this.textStarted = true
        events.push({
          type: 'content_block_start',
          index: this.textIndex,
          content_block: { type: 'text', text: '' },
        })
      }
      events.push({
        type: 'content_block_delta',
        index: this.textIndex,
        delta: { type: 'text_delta', text: part.text },
      })
    }
    return events
  }

  end(): MessageStreamEvent[] {
    const events: MessageStreamEvent[] = []
    if (this.textStarted) {
      events.push({ type: 'content_block_stop', index: this.textIndex })
    }
    events.push({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
    })
    events.push({ type: 'message_stop' })
    return events
  }
}

/** 解析单条 SSE data；非法 JSON 返回 null，调用方跳过。 */
export const parseGeminiChunk = (data: string): GeminiChunk | null => {
  return JSON.parse(data) as GeminiChunk
}
