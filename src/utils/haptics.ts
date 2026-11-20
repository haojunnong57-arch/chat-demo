export type HapticStyle = 'light' | 'medium' | 'soft' | 'success' | 'warning'

type WebkitMessageHandler = {
  postMessage: (message: unknown) => void
}

type WebkitBridge = {
  messageHandlers?: Record<string, WebkitMessageHandler>
}

const bridge = (): WebkitBridge | undefined =>
  (window as unknown as { webkit?: WebkitBridge }).webkit

/**
 * iOS 原生触感。WKWebView 里走 App 注入的 haptic bridge；
 * 普通浏览器没有 bridge 时退回 navigator.vibrate，不影响任何逻辑。
 */
export const haptic = (style: HapticStyle = 'light') => {
  const handler = bridge()?.messageHandlers?.haptic
  if (handler && typeof handler.postMessage === 'function') {
    try {
      handler.postMessage(style)
      return
    } catch {
      // 桥接异常时继续走浏览器回退
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    const duration = style === 'soft' ? 8 : style === 'medium' ? 22 : style === 'warning' ? 30 : 12
    try {
      navigator.vibrate(duration)
    } catch {
      // 某些 WebView 会禁用 vibration API，静默忽略
    }
  }
}
