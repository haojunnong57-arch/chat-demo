import { ApiError } from '../../api/errors.js'
import { readServerSentEvents } from '../../api/sse.js'
import type { CreateMessageRequest, MessageStreamEvent } from '../../api/types.js'
import type { ProviderInstance } from '../types.js'
import { GeminiAssembler, parseGeminiChunk, toGeminiRequest } from './gemini.js'

const postUrl = (instance: ProviderInstance): string =>
  `${instance.baseUrl}/v1beta/models/${encodeURIComponent(instance.model)}:streamGenerateContent?alt=sse`

/**
 * POST Gemini `streamGenerateContent`（SSE），逐个产出统一事件。
 * 鉴权用 `x-goog-api-key` 头；当前协议不支持工具调用，请求里不携带 tools。
 */
export async function* streamGeminiMessage(
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
        'x-goog-api-key': instance.apiKey,
        ...(instance.extraHeaders ?? {}),
      },
      body: JSON.stringify(toGeminiRequest(body)),
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

  const assembler = new GeminiAssembler()
  for await (const { data } of readServerSentEvents(response.body, signal)) {
    let chunk: ReturnType<typeof parseGeminiChunk>
    try {
      chunk = parseGeminiChunk(data)
    } catch {
      continue
    }
    if (!chunk) {
      continue
    }
    yield* assembler.push(chunk)
  }
  yield* assembler.end()
}
