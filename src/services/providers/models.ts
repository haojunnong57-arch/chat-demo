import type { ModelsApi, ModelsFailure, ProviderInstance } from './types.js'

/** 模型列表拉取统一超时：8 秒，避免设置页长时间转圈 */
export const MODELS_TIMEOUT_MS = 8000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []

/**
 * 解析 OpenAI 兼容 `GET /models` 响应：`{ data: [{ id }] }`。
 * 解析失败时抛出普通 Error，由调用方归入 protocol 分型。
 */
export const parseOpenAiModels = (json: unknown): string[] => {
  if (!isRecord(json) || !Array.isArray(json.data)) {
    throw new Error('invalid models payload')
  }
  return asStringArray(json.data.map((item) => (isRecord(item) ? item.id : undefined)))
}

/** 解析 Anthropic 新接口 `GET /v1/models` 响应：`{ data: [{ id }] }` */
export const parseAnthropicModels = (json: unknown): string[] => {
  if (!isRecord(json) || !Array.isArray(json.data)) {
    throw new Error('invalid models payload')
  }
  return asStringArray(json.data.map((item) => (isRecord(item) ? item.id : undefined)))
}

/** 解析 Gemini `GET /v1beta/models` 响应：`{ models: [{ name: 'models/...' }] }`，去掉 `models/` 前缀 */
export const parseGeminiModels = (json: unknown): string[] => {
  if (!isRecord(json) || !Array.isArray(json.models)) {
    throw new Error('invalid models payload')
  }
  return asStringArray(
    json.models.map((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') {
        return undefined
      }
      return item.name.replace(/^models\//, '')
    })
  )
}

const PARSERS: Record<ModelsApi, (json: unknown) => string[]> = {
  openai: parseOpenAiModels,
  anthropic: parseAnthropicModels,
  gemini: parseGeminiModels,
}

/**
 * 模型列表拉取方式：DeepSeek 沿用旧版 `/models`（兼容既有校验路径）；
 * 其余按协议映射——Anthropic 新接口 `/v1/models`，Gemini `/v1beta/models`，OpenAI 系 `/models`。
 */
const apiFor = (instance: ProviderInstance): ModelsApi => {
  if (instance.kind === 'deepseek') {
    return 'openai'
  }
  if (instance.protocol === 'anthropic-messages') {
    return 'anthropic'
  }
  if (instance.protocol === 'gemini') {
    return 'gemini'
  }
  return 'openai'
}

/** 各协议拉取模型列表的相对路径（去掉 baseUrl 后的部分），供报告与调试对照 */
export const modelsPath = (api: ModelsApi): string =>
  api === 'openai' ? '/models' : api === 'anthropic' ? '/v1/models' : '/v1beta/models'

/** 计算实例对应的模型列表完整 URL */
export const modelsEndpoint = (instance: ProviderInstance): string =>
  `${instance.baseUrl}${modelsPath(apiFor(instance))}`

const authHeaders = (instance: ProviderInstance): Record<string, string> => {
  if (!instance.apiKey) {
    return {}
  }
  if (instance.protocol === 'anthropic-messages') {
    return { 'x-api-key': instance.apiKey, 'anthropic-version': '2023-06-01' }
  }
  if (instance.protocol === 'gemini') {
    return { 'x-goog-api-key': instance.apiKey }
  }
  return { Authorization: `Bearer ${instance.apiKey}` }
}

const classifyStatus = (status: number): ModelsFailure['kind'] => {
  if (status === 401 || status === 403) {
    return 'unauthorized'
  }
  if (status === 404) {
    return 'endpointNotFound'
  }
  return 'other'
}

/**
 * 拉取实例可用模型列表。预期失败统一收敛成 `ModelsFailure`，不抛白屏；
 * 只有调用方主动中止（AbortSignal.aborted）时才透传 AbortError。
 */
export const fetchModels = async (
  instance: ProviderInstance,
  external?: AbortSignal
): Promise<{ ok: true; models: string[] } | { ok: false; failure: ModelsFailure }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  external?.addEventListener('abort', onExternalAbort, { once: true })

  let response: Response
  try {
    response = await fetch(modelsEndpoint(instance), {
      method: 'GET',
      headers: authHeaders(instance),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    external?.removeEventListener('abort', onExternalAbort)
    if (external?.aborted) {
      throw error
    }
    return {
      ok: false,
      failure: {
        kind: 'network',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
  clearTimeout(timer)
  external?.removeEventListener('abort', onExternalAbort)

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      ok: false,
      failure: { kind: classifyStatus(response.status), message: text, status: response.status },
    }
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { ok: false, failure: { kind: 'protocol', message: 'invalid JSON body' } }
  }

  try {
    const models = PARSERS[apiFor(instance)](json)
    return { ok: true, models }
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: 'protocol',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
