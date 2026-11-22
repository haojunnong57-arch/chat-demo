import { readMessageEvent } from './parseEvent.js'
import { getActiveInstance, useSettings } from '../settings.js'
import { readServerSentEvents } from './sse.js'
import { fetchModels } from '../providers/models.js'
import { streamOpenAiMessage } from '../providers/adapters/openaiStream.js'
import { streamGeminiMessage } from '../providers/adapters/geminiStream.js'
import type { ProviderInstance } from '../providers/types.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

import { ApiError } from './errors.js'

/** ApiError 统一在 errors.ts 定义；此处再导出，保持既有 `api/client.js` 导入路径可用 */
export { ApiError, type ApiErrorKind } from './errors.js'

/** 构建期默认 API 地址；设置里可以改成任意 DeepSeek 兼容端点 */
export const DEFAULT_API_ORIGIN = __API_ORIGIN__

/** 当前生效的 API 地址（兼容旧调用方；取自当前激活实例） */
export const getApiOrigin = (): string =>
  useSettings.getState().apiBaseUrl?.trim().replace(/\/+$/, '') || DEFAULT_API_ORIGIN

/** Anthropic 兼容接口的前缀 */
const anthropicBaseUrl = (baseUrl: string): string => `${baseUrl}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 校验 API Key：按当前实例协议拉取模型列表，失败统一抛 ApiError（不产生聊天费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const active = getActiveInstance()
  const instance: ProviderInstance = active
    ? { ...active, apiKey }
    : {
        id: 'legacy',
        kind: 'deepseek',
        label: 'DeepSeek',
        protocol: 'anthropic-messages',
        baseUrl: getApiOrigin(),
        apiKey,
        models: [],
        model: '',
      }
  const result = await fetchModels(instance, signal)
  if (!result.ok) {
    const { kind, message, status } = result.failure
    throw new ApiError(
      kind === 'network' ? 'network' : kind === 'protocol' ? 'protocol' : 'http',
      message,
      status
    )
  }
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${anthropicBaseUrl(currentBaseUrl())}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${anthropicBaseUrl(currentBaseUrl())}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

/** 当前激活实例的端点；未配置实例时回退构建期默认地址 */
const currentBaseUrl = (): string => getActiveInstance()?.baseUrl || getApiOrigin()

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const active = getActiveInstance()
  const instance: ProviderInstance = active
    ? { ...active, apiKey: apiKey || active.apiKey }
    : {
        id: 'legacy',
        kind: 'deepseek',
        label: 'DeepSeek',
        protocol: 'anthropic-messages',
        baseUrl: getApiOrigin(),
        apiKey,
        models: [],
        model: '',
      }
  const requestBody = instance.model ? { ...body, model: instance.model } : body

  // 按实例协议路由：OpenAI Chat 兼容 / Gemini 走各自适配器；Anthropic Messages 沿用既有路径
  if (instance.protocol === 'openai-chat') {
    yield* streamOpenAiMessage(instance, requestBody, signal)
    return
  }
  if (instance.protocol === 'gemini') {
    yield* streamGeminiMessage(instance, requestBody, signal)
    return
  }

  const response = await request(`${anthropicBaseUrl(instance.baseUrl)}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(instance.apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...requestBody, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
