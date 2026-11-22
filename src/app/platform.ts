/**
 * 原生外壳运行环境判断。
 *
 * Android 壳会通过 WebView 注入 `DeepSeekAndroid`，iOS 壳的 UA 带 DeepSeekMobile。
 * 所有平台专属逻辑必须在这里收口，避免 Android 的改动影响 iOS 网页行为。
 */
type AndroidBridge = {
  platform?: () => string
  setChromeTheme?: (dark: boolean) => void
  toast?: (message: string) => void
  saveFile?: (name: string, mime: string, base64: string) => void
  shareFile?: (name: string, mime: string, base64: string) => void
  haptic?: (style: string) => void
}

declare global {
  interface Window {
    DeepSeekAndroid?: AndroidBridge
  }
}

export const androidBridge: AndroidBridge | undefined =
  typeof window === 'undefined' ? undefined : window.DeepSeekAndroid

export const isAndroidShell = Boolean(androidBridge)

export const isIOSShell =
  typeof navigator !== 'undefined' &&
  /DeepSeekMobile/i.test(navigator.userAgent) &&
  /iPhone|iPad|iPod/i.test(navigator.userAgent)

/** 有原生壳时使用壳的触觉反馈，不再依赖浏览器振动 API。 */
export const isNativeShell = isAndroidShell || isIOSShell
