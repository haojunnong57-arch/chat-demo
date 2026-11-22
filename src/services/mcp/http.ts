/**
 * MCP HTTP 传输层。
 *
 * 浏览器里直接 fetch；在 iOS 壳内由 Swift 原生 URLSession 代发，绕过 MCP 服务端
 * 常见的 CORS 限制，并把响应原样回传给 JS。两条路径对上层暴露同一接口。
 *
 * 测试或定制场景可以通过 `McpSession` 构造参数注入自己的 HTTP 实现；不传时保持
 * 原有浏览器 / 原生桥接行为不变。本模块加载时把默认实现注册回 client。
 */

import { registerDefaultHttpRequester } from './client.js'

export type HttpRequestInput = {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type HttpResult = {
  status: number
  headers: Record<string, string>
  body: string
}

/** 可注入的 HTTP 实现；默认走浏览器 fetch 或 iOS 原生桥接。 */
export type HttpRequester = (input: HttpRequestInput) => Promise<HttpResult>

type BridgeResult = HttpResult & { id: number; error?: string }

type Pending = {
  resolve: (result: HttpResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<number, Pending>()
let sequence = 0

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        mcpHttp?: { postMessage: (message: unknown) => void }
      }
    }
    __mcpHttpResponse?: (result: BridgeResult) => void
  }
}

if (typeof window !== 'undefined') {
  window.__mcpHttpResponse = (result) => {
    const entry = pending.get(result.id)
    if (!entry) {
      return
    }
    pending.delete(result.id)
    clearTimeout(entry.timer)
    if (result.error) {
      entry.reject(new Error(result.error))
      return
    }
    entry.resolve({
      status: result.status,
      headers: result.headers ?? {},
      body: result.body ?? '',
    })
  }
}

export const hasNativeMcpBridge = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.webkit?.messageHandlers?.mcpHttp)

const bridgeRequest = (input: HttpRequestInput): Promise<HttpResult> =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('MCP 请求超时'))
    }, 30_000)
    pending.set(id, { resolve, reject, timer })
    const payload: Record<string, unknown> = {
      id,
      url: input.url,
      method: input.method,
      headers: input.headers,
      body: input.body ?? '',
    }
    try {
      window.webkit?.messageHandlers?.mcpHttp?.postMessage(payload)
    } catch (error) {
      pending.delete(id)
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

/** 把浏览器 fetch 抛回的网络异常（CORS、DNS、连接拒绝等）包装成可读错误。 */
const toNetworkError = (error: unknown): Error => {
  const reason = error instanceof Error ? error.message : String(error)
  return new Error(
    `无法连接到 MCP 服务端（网络错误：${reason}）。浏览器内最常见的原因是服务端未开放 CORS 跨域；请在 iOS 原生壳内使用，或通过允许跨域的代理访问后再试。`
  )
}

const fetchRequest: HttpRequester = async (input: HttpRequestInput): Promise<HttpResult> => {
  let response: Response
  try {
    response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: input.signal,
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch (error) {
    if (input.signal?.aborted) {
      throw error instanceof Error ? error : new Error('MCP 请求已中止')
    }
    throw toNetworkError(error)
  }
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return { status: response.status, headers, body: await response.text() }
}

export const mcpHttpRequest = (
  input: HttpRequestInput,
  requester?: HttpRequester
): Promise<HttpResult> =>
  requester ? requester(input) : hasNativeMcpBridge() ? bridgeRequest(input) : fetchRequest(input)

// 把浏览器 / 原生桥接默认实现注册回 client；测试场景可在构造会话时另行注入。
registerDefaultHttpRequester(mcpHttpRequest)
