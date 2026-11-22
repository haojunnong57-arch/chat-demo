import type { TranslationKey } from '../../i18n/index.js'

/**
 * 线协议（wire protocol）抽象：不按「服务商」硬编码请求，按协议适配。
 * - `anthropic-messages`：Anthropic Messages 流（沿用现有 DeepSeek 官方兼容路径）
 * - `openai-chat`：OpenAI Chat Completions 兼容流（含 OpenRouter / xAI / Moonshot 等）
 * - `gemini`：Google Gemini `streamGenerateContent` SSE 流
 */
export type Protocol = 'anthropic-messages' | 'openai-chat' | 'gemini'

/** 内置服务商种类；同一种类可以添加多个实例（工作 / 个人等） */
export type ProviderKind =
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'xai'
  | 'kimi-code'
  | 'github-copilot'

/** 一个可切换的服务商实例：端点、密钥、可用模型与当前模型都挂在实例上 */
export type ProviderInstance = {
  id: string
  kind: ProviderKind
  /** 用户可读的实例标注，如「工作」「个人」；缺省时回退到服务商显示名 */
  label: string
  protocol: Protocol
  /** 去掉结尾斜杠的 API 地址 */
  baseUrl: string
  apiKey: string
  /** 拉取成功后缓存的可用模型列表；拉取失败时保留内置推荐清单 */
  models: string[]
  /** 当前选用的模型名（允许手动填写，不一定在 models 列表里） */
  model: string
  /** 附加请求头（设备码 / 订阅 token 等特殊鉴权场景预留） */
  extraHeaders?: Record<string, string>
}

/** 模型列表拉取方式，与协议对应但独立成枚举便于扩展 */
export type ModelsApi = 'openai' | 'anthropic' | 'gemini'

/** 服务商注册表条目：声明默认协议、端点、密钥提示、推荐模型与能力标记 */
export type ProviderDefinition = {
  kind: ProviderKind
  /** 显示名 i18n key */
  nameKey: TranslationKey
  /** 该服务商允许选择的协议；多于一种时设置页可切换（OpenAI / Anthropic 兼容第三方端点） */
  protocols: Protocol[]
  defaultProtocol: Protocol
  defaultBaseUrl: string
  /** 密钥格式提示 i18n key */
  keyHintKey: TranslationKey
  /** 订阅 / 登录类接入（无传统 API Key），文案上与密钥输入区分 */
  subscription: boolean
  /** 风险提示 i18n key；仅 GitHub Copilot 等非官方方式需要 */
  riskNoteKey?: TranslationKey
  /** 拉取模型失败时的内置推荐清单 */
  recommendedModels: string[]
  modelsApi: ModelsApi
}

/** 模型列表拉取的错误分型：供设置页给出可操作的提示，不抛白屏 */
export type ModelsErrorKind =
  /** 401 / 403：密钥无效或无权限 */
  | 'unauthorized'
  /** 404：端点地址不对 */
  | 'endpointNotFound'
  /** 断网、CORS 被拦截等请求未到达服务端 */
  | 'network'
  /** 响应体无法解析成模型列表 */
  | 'protocol'
  /** 其余 HTTP 错误或未知失败 */
  | 'other'

export type ModelsFailure = {
  kind: ModelsErrorKind
  message: string
  status?: number
}
