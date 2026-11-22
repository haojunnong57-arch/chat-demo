import type {
  AssistantBlockParam,
  ClientTool,
  CreateMessageRequest,
  MessageParam,
  MessageStreamEvent,
} from '../../api/types.js'

// ---------- 线协议类型 ----------

type OpenAiToolCallWire = {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

type OpenAiChunkDelta = {
  content?: string
  reasoning_content?: string
  tool_calls?: OpenAiToolCallWire[]
}

export type OpenAiChunk = {
  id?: string
  model?: string
  choices?: Array<{ index?: number; delta?: OpenAiChunkDelta; finish_reason?: string | null }>
}

type OpenAiMessage = {
  role: 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

// ---------- 请求翻译：Anthropic 形态 → OpenAI Chat Completions ----------

const textOfUserBlocks = (
  blocks: Extract<MessageParam, { role: 'user' }>['content']
): string => {
  if (typeof blocks === 'string') {
    return blocks
  }
  return blocks
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

const assistantToOpenAi = (content: AssistantBlockParam[]): OpenAiMessage => {
  const text = content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const toolCalls = content
    .filter((block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      type: 'function' as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }))
  return {
    role: 'assistant',
    ...(text ? { content: text } : { content: null }),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  }
}

/** MCP 工具声明映射成 OpenAI `tools[].function`；DeepSeek 专有服务端工具在该协议下不发送。 */
export const toOpenAiTools = (tools: CreateMessageRequest['tools']) =>
  tools
    .filter((tool): tool is ClientTool => 'input_schema' in tool)
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }))

export const toOpenAiRequest = (body: CreateMessageRequest): Record<string, unknown> => {
  const messages: OpenAiMessage[] = []
  let system = body.system ?? ''

  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      system = system ? `${system}\n\n${message.content}` : message.content
      continue
    }
    if (message.role === 'user') {
      const text = textOfUserBlocks(message.content)
      if (text) {
        messages.push({ role: 'user', content: text })
      }
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'tool_result') {
            messages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: block.content,
            })
          }
        }
      }
      continue
    }
    messages.push(assistantToOpenAi(message.content))
  }

  const tools = toOpenAiTools(body.tools)
  const nextMessages = system ? [{ role: 'system' as const, content: system }, ...messages] : messages
  return {
    model: body.model,
    messages: nextMessages,
    stream: true,
    ...(tools.length ? { tools } : {}),
  }
}

// ---------- 流式装配：OpenAI 增量 → 统一 MessageStreamEvent ----------

type PendingTool = {
  id: string
  name: string
  args: string
  index: number
  started: boolean
  stopped: boolean
}

/**
 * 无状态依赖的增量装配器：逐 chunk 喂入，产出与 Anthropic 流一致的事件序列，
 * 供上层 store 按既有逻辑消费；结束时补齐 block_stop / message_delta / message_stop。
 */
export class OpenAiAssembler {
  private started = false
  private id = ''
  private model = ''
  private textStarted = false
  private thinkingStarted = false
  private readonly tools = new Map<number, PendingTool>()
  private readonly textIndex = 0
  private readonly thinkingIndex = 1
  private toolIndex = 2
  private stopReason: 'end_turn' | 'tool_use' = 'end_turn'

  push(chunk: OpenAiChunk): MessageStreamEvent[] {
    const events: MessageStreamEvent[] = []
    if (!this.started) {
      this.started = true
      this.id = chunk.id ?? 'openai'
      this.model = chunk.model ?? ''
      events.push({ type: 'message_start', message: { id: this.id, model: this.model } })
    }
    const choice = chunk.choices?.[0]
    if (!choice) {
      return events
    }
    const delta = choice.delta ?? {}

    if (typeof delta.content === 'string' && delta.content) {
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
        delta: { type: 'text_delta', text: delta.content },
      })
    }

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      if (!this.thinkingStarted) {
        this.thinkingStarted = true
        events.push({
          type: 'content_block_start',
          index: this.thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        })
      }
      events.push({
        type: 'content_block_delta',
        index: this.thinkingIndex,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      })
    }

    for (const call of delta.tool_calls ?? []) {
      const key = typeof call.index === 'number' ? call.index : 0
      let pending = this.tools.get(key)
      if (!pending) {
        pending = {
          id: call.id ?? `call_${key}`,
          name: call.function?.name ?? '',
          args: '',
          index: this.toolIndex++,
          started: false,
          stopped: false,
        }
        this.tools.set(key, pending)
      }
      if (call.function?.name) {
        pending.name = call.function.name
      }
      if (typeof call.function?.arguments === 'string') {
        pending.args += call.function.arguments
        events.push({
          type: 'content_block_delta',
          index: pending.index,
          delta: { type: 'input_json_delta', partial_json: call.function.arguments },
        })
      }
      if (!pending.started) {
        pending.started = true
        events.push({
          type: 'content_block_start',
          index: pending.index,
          content_block: { type: 'tool_use', id: pending.id, name: pending.name, input: {} },
        })
      }
    }

    if (choice.finish_reason === 'tool_calls') {
      this.stopReason = 'tool_use'
    }
    return events
  }

  end(): MessageStreamEvent[] {
    const events: MessageStreamEvent[] = []
    for (const pending of this.tools.values()) {
      if (!pending.stopped) {
        pending.stopped = true
        events.push({ type: 'content_block_stop', index: pending.index })
      }
    }
    if (this.textStarted) {
      events.push({ type: 'content_block_stop', index: this.textIndex })
    }
    if (this.thinkingStarted) {
      events.push({ type: 'content_block_stop', index: this.thinkingIndex })
    }
    events.push({
      type: 'message_delta',
      delta: { stop_reason: this.stopReason, stop_sequence: null },
    })
    events.push({ type: 'message_stop' })
    return events
  }
}

/** 解析单条 SSE data；`[DONE]` 与非法 JSON 返回 null，调用方跳过。 */
export const parseOpenAiChunk = (data: string): OpenAiChunk | null => {
  if (data === '[DONE]') {
    return null
  }
  return JSON.parse(data) as OpenAiChunk
}
