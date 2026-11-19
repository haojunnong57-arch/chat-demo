/**
 * MCP HTTP 传输层。
 *
 * 浏览器里直接 fetch；在 iOS 壳内由 Swift 原生 URLSession 代发，绕过 MCP 服务端
 * 常见的 CORS 限制，并把响应原样回传给 JS。两条路径对上层暴露同一接口。
 */

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

const fetchRequest = async (input: HttpRequestInput): Promise<HttpResult> => {
  const response = await fetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    signal: input.signal,
    credentials: 'omit',
    cache: 'no-store',
  })
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return { status: response.status, headers, body: await response.text() }
}

export const mcpHttpRequest = (input: HttpRequestInput): Promise<HttpResult> =>
  hasNativeMcpBridge() ? bridgeRequest(input) : fetchRequest(input)
