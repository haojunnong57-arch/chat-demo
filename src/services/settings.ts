import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ChatModel } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 聊天界面皮肤：默认 DeepSeek / 微信 / iMessage / Instagram / 液态玻璃 */
export type ChatTheme = 'default' | 'wechat' | 'imessage' | 'instagram' | 'glass'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  /** DeepSeek 兼容 API 地址；默认官方地址 */
  apiBaseUrl: string
  /** 对话模型 */
  model: ChatModel
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

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  apiBaseUrl: read(KEYS.apiBaseUrl) || 'https://api.deepseek.com',
  model: read(KEYS.model) === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash',
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
  autoRead: read(KEYS.autoRead) === 'true',
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

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

export const setAutoRead = (autoRead: boolean) => {
  write(KEYS.autoRead, String(autoRead))
  useSettings.setState({ autoRead })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setApiBaseUrl = (apiBaseUrl: string) => {
  const value = apiBaseUrl.trim().replace(/\/+$/, '') || 'https://api.deepseek.com'
  write(KEYS.apiBaseUrl, value)
  useSettings.setState({ apiBaseUrl: value })
}

export const setModel = (model: ChatModel) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
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
