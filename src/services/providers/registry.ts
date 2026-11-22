import type { ProviderDefinition, ProviderKind, ProviderInstance, Protocol } from './types.js'

/**
 * 服务商注册表。显示名、密钥提示、风险文案等都走 i18n；
 * 新增服务商时在此补一条声明，协议适配层按协议而非按服务商分发。
 */
export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    kind: 'deepseek',
    nameKey: 'providerNameDeepseek',
    protocols: ['anthropic-messages'],
    defaultProtocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.deepseek.com',
    keyHintKey: 'providerKeyHintDeepseek',
    subscription: false,
    recommendedModels: ['deepseek-flash', 'deepseek-v4-pro'],
    modelsApi: 'openai',
  },
  {
    kind: 'openai',
    nameKey: 'providerNameOpenai',
    protocols: ['openai-chat', 'anthropic-messages'],
    defaultProtocol: 'openai-chat',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHintKey: 'providerKeyHintOpenai',
    subscription: false,
    recommendedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
    modelsApi: 'openai',
  },
  {
    kind: 'anthropic',
    nameKey: 'providerNameAnthropic',
    protocols: ['anthropic-messages', 'openai-chat'],
    defaultProtocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyHintKey: 'providerKeyHintAnthropic',
    subscription: false,
    recommendedModels: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    modelsApi: 'anthropic',
  },
  {
    kind: 'gemini',
    nameKey: 'providerNameGemini',
    protocols: ['gemini'],
    defaultProtocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyHintKey: 'providerKeyHintGemini',
    subscription: false,
    recommendedModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro'],
    modelsApi: 'gemini',
  },
  {
    kind: 'openrouter',
    nameKey: 'providerNameOpenrouter',
    protocols: ['openai-chat'],
    defaultProtocol: 'openai-chat',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyHintKey: 'providerKeyHintOpenrouter',
    subscription: false,
    recommendedModels: [
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash-exp',
    ],
    modelsApi: 'openai',
  },
  {
    kind: 'xai',
    nameKey: 'providerNameXai',
    protocols: ['openai-chat'],
    defaultProtocol: 'openai-chat',
    defaultBaseUrl: 'https://api.x.ai/v1',
    keyHintKey: 'providerKeyHintXai',
    subscription: false,
    recommendedModels: ['grok-2', 'grok-2-mini', 'grok-beta'],
    modelsApi: 'openai',
  },
  {
    kind: 'kimi-code',
    nameKey: 'providerNameKimiCode',
    protocols: ['openai-chat'],
    defaultProtocol: 'openai-chat',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    keyHintKey: 'providerKeyHintKimiCode',
    subscription: true,
    recommendedModels: ['kimi-k2-0905-preview', 'moonshot-v1-8k'],
    modelsApi: 'openai',
  },
  {
    kind: 'github-copilot',
    nameKey: 'providerNameGithubCopilot',
    protocols: ['openai-chat'],
    defaultProtocol: 'openai-chat',
    defaultBaseUrl: 'https://api.githubcopilot.com',
    keyHintKey: 'providerKeyHintGithubCopilot',
    subscription: true,
    riskNoteKey: 'providerRiskGithubCopilot',
    recommendedModels: ['gpt-4o', 'claude-3.5-sonnet'],
    modelsApi: 'openai',
  },
]

export const providerDefinition = (kind: ProviderKind): ProviderDefinition =>
  PROVIDER_DEFINITIONS.find((item) => item.kind === kind) ?? PROVIDER_DEFINITIONS[0]

/** 协议显示名 i18n key */
export const protocolNameKey = (protocol: Protocol): TranslationKeyOfProtocol =>
  protocol === 'anthropic-messages'
    ? 'protocolAnthropicMessages'
    : protocol === 'openai-chat'
      ? 'protocolOpenaiChat'
      : 'protocolGemini'

type TranslationKeyOfProtocol =
  | 'protocolAnthropicMessages'
  | 'protocolOpenaiChat'
  | 'protocolGemini'

/** 规整实例地址：去掉结尾斜杠；空白回退服务商默认地址 */
export const normalizeBaseUrl = (definition: ProviderDefinition, baseUrl: string): string =>
  baseUrl.trim().replace(/\/+$/, '') || definition.defaultBaseUrl

/** 用注册表默认值拼装一个新实例（id 由调用方生成） */
export const buildInstance = (
  kind: ProviderKind,
  patch: Partial<Omit<ProviderInstance, 'id' | 'kind'>>
): ProviderInstance => {
  const definition = providerDefinition(kind)
  return {
    id: '',
    kind,
    label: patch.label?.trim() ?? '',
    protocol: patch.protocol ?? definition.defaultProtocol,
    baseUrl: normalizeBaseUrl(definition, patch.baseUrl ?? definition.defaultBaseUrl),
    apiKey: patch.apiKey?.trim() ?? '',
    models: patch.models?.length ? patch.models : [...definition.recommendedModels],
    model: patch.model ?? definition.recommendedModels[0] ?? '',
    ...(patch.extraHeaders ? { extraHeaders: patch.extraHeaders } : {}),
  }
}
