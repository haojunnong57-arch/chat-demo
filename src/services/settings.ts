import { create } from 'zustand'
import { createId } from '../utils/id.js'
import type { TtsVoice } from './api/speech.js'
import type { ChatModel } from './api/types.js'
import type { ProviderInstance } from './providers/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 聊天界面皮肤：默认 DeepSeek / 微信 / iMessage / Instagram / 液态玻璃 */
export type ChatTheme = 'default' | 'wechat' | 'imessage' | 'instagram' | 'glass'

/**
 * 本机设置，存 localStorage：服务商实例、API Key、语言、主题、位置、朗读音色、
 * 深度思考与智能搜索开关、侧边栏收起状态。
 *
 * `apiKey` / `apiBaseUrl` / `model` 是为兼容旧模块保留的镜像字段，
 * 始终与当前激活实例同步；新代码请通过 `getActiveInstance()` 读取。
 */
type Settings = {
  /** 兼容镜像：当前实例的 API Key */
  apiKey: string | null
  /** 兼容镜像：当前实例的 API 地址 */
  apiBaseUrl: string
  /** 兼容镜像：当前实例的模型 */
  model: ChatModel
  /** 全部服务商实例（同一服务商可添加多个） */
  instances: ProviderInstance[]
  /** 当前激活实例 id；null 表示尚未配置 */
  activeInstanceId: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  /** 聊天界面皮肤 */
  chatTheme: ChatTheme
  /** 自定义聊天背景，data URL；null 表示使用所选主题自带背景 */
  chatBackground: string | null
  /** 我的头像，data URL；null 表示完全不显示头像 */
  userAvatar: string | null
  /** AI 头像，data URL；null 表示完全不显示头像 */
  aiAvatar: string | null
  /** 自定义系统提示词；空字符串表示不发送任何系统提示 */
  systemPrompt: string
  /** 液态玻璃通透度：0.08 最磨砂，1 最通透 */
  glassOpacity: number
  /** 增强动画：关闭后保留必要状态过渡，去掉倾斜、流光、语义块与呼吸动效 */
  enhancedMotion: boolean
  /** AI 回复完成后自动朗读 */
  autoRead: boolean
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  apiBaseUrl: 'chat-demo:api-base-url',
  model: 'chat-demo:model',
  instances: 'chat-demo:provider-instances',
  activeInstance: 'chat-demo:active-provider-instance',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  chatTheme: 'chat-demo:chat-theme',
  chatBackground: 'chat-demo:chat-background',
  userAvatar: 'chat-demo:user-avatar',
  aiAvatar: 'chat-demo:ai-avatar',
  systemPrompt: 'chat-demo:system-prompt',
  glassOpacity: 'chat-demo:glass-opacity',
  enhancedMotion: 'chat-demo:enhanced-motion',
  autoRead: 'chat-demo:auto-read',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialChatTheme = (): ChatTheme => {
  const saved = read(KEYS.chatTheme)
  return saved === 'wechat' || saved === 'imessage' || saved === 'instagram' || saved === 'glass'
    ? saved
    : 'default'
}

/** 默认 0.55：通透但仍保证文字对比度 */
const initialGlassOpacity = (): number => {
  const value = Number(read(KEYS.glassOpacity))
  return Number.isFinite(value) && value > 0 ? Math.min(1, Math.max(0.08, value)) : 0.55
}

/**
 * 读取实例体系；首次升级时把旧版单实例配置（api-key / api-base-url / model）
 * 平滑迁移成第一个 deepseek 实例，不清空老用户数据。
 */
const loadInstances = (): { instances: ProviderInstance[]; activeInstanceId: string | null } => {
  const raw = read(KEYS.instances)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const instances = parsed as ProviderInstance[]
        const activeInstanceId = read(KEYS.activeInstance)
        return {
          instances,
          activeInstanceId: instances.some((item) => item.id === activeInstanceId)
            ? activeInstanceId
            : instances[0].id,
        }
      }
    } catch {
      // 损坏的实例记录走下方迁移逻辑
    }
  }

  const legacyApiKey = read(KEYS.apiKey)
  const legacyBaseUrl = read(KEYS.apiBaseUrl)
  const legacyModel = read(KEYS.model)
  const instance: ProviderInstance = {
    id: createId(),
    kind: 'deepseek',
    label: 'DeepSeek',
    protocol: 'anthropic-messages',
    baseUrl: legacyBaseUrl?.trim() || 'https://api.deepseek.com',
    apiKey: legacyApiKey ?? '',
    models: legacyModel ? [legacyModel] : ['deepseek-flash', 'deepseek-v4-pro'],
    model: legacyModel || 'deepseek-flash',
  }
  return { instances: [instance], activeInstanceId: instance.id }
}

const initialInstances = loadInstances()

/** 由激活实例推导兼容镜像字段 */
const compatFromInstance = (instance: ProviderInstance | null) => ({
  apiKey: instance?.apiKey ? instance.apiKey : null,
  apiBaseUrl: instance?.baseUrl || 'https://api.deepseek.com',
  model: (instance?.model || 'deepseek-flash') as ChatModel,
})

export const useSettings = create<Settings>(() => ({
  ...compatFromInstance(initialInstances.instances[0] ?? null),
  instances: initialInstances.instances,
  activeInstanceId: initialInstances.activeInstanceId,
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  chatTheme: initialChatTheme(),
  chatBackground: read(KEYS.chatBackground),
  userAvatar: read(KEYS.userAvatar),
  aiAvatar: read(KEYS.aiAvatar),
  systemPrompt: read(KEYS.systemPrompt) ?? '',
  glassOpacity: initialGlassOpacity(),
  enhancedMotion: read(KEYS.enhancedMotion) !== 'false',
  autoRead: read(KEYS.autoRead) === 'true',
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

// ---------- 服务商实例体系 ----------

/** 当前激活实例；未配置任何实例时返回 null */
export const getActiveInstance = (): ProviderInstance | null => {
  const { instances, activeInstanceId } = useSettings.getState()
  return instances.find((item) => item.id === activeInstanceId) ?? instances[0] ?? null
}

export const getInstances = (): ProviderInstance[] => useSettings.getState().instances

const persist = (instances: ProviderInstance[], activeInstanceId: string | null) => {
  write(KEYS.instances, JSON.stringify(instances))
  write(KEYS.activeInstance, activeInstanceId)
  const active = instances.find((item) => item.id === activeInstanceId) ?? instances[0] ?? null
  useSettings.setState({
    instances,
    activeInstanceId: active?.id ?? null,
    ...compatFromInstance(active),
  })
}

/** 新增实例；返回写入后的实例 */
export const addInstance = (input: Omit<ProviderInstance, 'id'>): ProviderInstance => {
  const instance: ProviderInstance = { ...input, id: createId() }
  const instances = [...useSettings.getState().instances, instance]
  persist(instances, instance.id)
  return instance
}

/** 局部更新实例；更新当前实例时同步兼容镜像 */
export const updateInstance = (id: string, patch: Partial<Omit<ProviderInstance, 'id'>>) => {
  const instances = useSettings
    .getState()
    .instances.map((item) => (item.id === id ? { ...item, ...patch, id } : item))
  persist(instances, useSettings.getState().activeInstanceId)
}

/** 删除实例；若删除的是当前实例，自动切到剩余第一个。调用方应先确认非唯一实例。 */
export const removeInstance = (id: string) => {
  const instances = useSettings.getState().instances.filter((item) => item.id !== id)
  const activeInstanceId =
    useSettings.getState().activeInstanceId === id
      ? instances[0]?.id ?? null
      : useSettings.getState().activeInstanceId
  persist(instances, activeInstanceId)
}

/** 设为当前实例 */
export const setActiveInstance = (id: string) => {
  persist(useSettings.getState().instances, id)
}

// ---------- 既有设置项 setter ----------

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setChatTheme = (chatTheme: ChatTheme) => {
  write(KEYS.chatTheme, chatTheme)
  useSettings.setState({ chatTheme })
}

export const setChatBackground = (chatBackground: string | null) => {
  // data URL 可能较大，存储失败时仍保留当前会话内的状态
  write(KEYS.chatBackground, chatBackground)
  useSettings.setState({ chatBackground })
}

export const setUserAvatar = (userAvatar: string | null) => {
  write(KEYS.userAvatar, userAvatar)
  useSettings.setState({ userAvatar })
}

export const setAiAvatar = (aiAvatar: string | null) => {
  write(KEYS.aiAvatar, aiAvatar)
  useSettings.setState({ aiAvatar })
}

export const setSystemPrompt = (systemPrompt: string) => {
  write(KEYS.systemPrompt, systemPrompt.trim() ? systemPrompt : '')
  useSettings.setState({ systemPrompt })
}

export const setGlassOpacity = (glassOpacity: number) => {
  const value = Math.min(1, Math.max(0.08, glassOpacity))
  write(KEYS.glassOpacity, String(value))
  useSettings.setState({ glassOpacity: value })
}

export const setEnhancedMotion = (enhancedMotion: boolean) => {
  write(KEYS.enhancedMotion, String(enhancedMotion))
  useSettings.setState({ enhancedMotion })
}

export const setAutoRead = (autoRead: boolean) => {
  write(KEYS.autoRead, String(autoRead))
  useSettings.setState({ autoRead })
}

/** 兼容旧调用方：写入当前实例的 API Key，同时落旧版 key 便于排查 */
export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  const active = getActiveInstance()
  if (active) {
    updateInstance(active.id, { apiKey: apiKey ?? '' })
  } else {
    useSettings.setState({ apiKey })
  }
}

/** 兼容旧调用方：写入当前实例的 API 地址 */
export const setApiBaseUrl = (apiBaseUrl: string) => {
  const value = apiBaseUrl.trim().replace(/\/+$/, '') || 'https://api.deepseek.com'
  write(KEYS.apiBaseUrl, value)
  const active = getActiveInstance()
  if (active) {
    updateInstance(active.id, { baseUrl: value })
  } else {
    useSettings.setState({ apiBaseUrl: value })
  }
}

/** 兼容旧调用方：写入当前实例的模型 */
export const setModel = (model: ChatModel) => {
  write(KEYS.model, model)
  const active = getActiveInstance()
  if (active) {
    updateInstance(active.id, { model })
  } else {
    useSettings.setState({ model })
  }
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
