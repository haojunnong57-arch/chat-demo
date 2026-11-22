import { ApiError } from '../../api/errors.js'
import { readServerSentEvents } from '../../api/sse.js'
import type { CreateMessageRequest, MessageStreamEvent } from '../../api/types.js'
import type { ProviderInstance } from '../types.js'
import { OpenAiAssembler, parseOpenAiChunk, toOpenAiRequest } from './openai.js'

const postUrl = (instance: ProviderInstance): string => `${instance.baseUrl}/chat/completions`

/**
 * POST OpenAI 兼容 `/chat/completions`（stream: true），逐个产出统一事件。
 * 鉴权用 `Authorization: Bearer`；响应非 SSE 时按 protocol 错误抛出。
 */
export async function* streamOpenAiMessage(
  instance: ProviderInstance,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  let response: Response
  try {
    response = await fetch(postUrl(instance), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${instance.apiKey}`,
        ...(instance.extraHeaders ?? {}),
      },
      body: JSON.stringify(toOpenAiRequest(body)),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ApiError('http', text, response.status)
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw new ApiError('protocol', await response.text().catch(() => ''))
  }

  const assembler = new OpenAiAssembler()
  for await (const { data } of readServerSentEvents(response.body, signal)) {
    let chunk: ReturnType<typeof parseOpenAiChunk>
    try {
      chunk = parseOpenAiChunk(data)
    } catch {
      continue
    }
    if (!chunk) {
      break
    }
    yield* assembler.push(chunk)
  }
  yield* assembler.end()
}
