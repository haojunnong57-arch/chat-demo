import type {
  HttpRequester,
  HttpRequestInput,
  HttpResult,
} from './http.js'
import type { McpCallResult, McpServerConfig, McpTool } from './types.js'

type JsonRpcId = number

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse = {
  jsonrpc?: '2.0'
  id?: JsonRpcId | string | null
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 默认 HTTP 实现由 http.ts 在模块加载时注册（保留浏览器 fetch / iOS 原生桥接选择）；
 * 测试可通过构造参数注入 transport。未注册时回退到全局 fetch，保证会话仍可用。
 */
let defaultRequester: HttpRequester | undefined

export const registerDefaultHttpRequester = (requester: HttpRequester): void => {
  defaultRequester = requester
}

const globalFetchRequester: HttpRequester = async (input: HttpRequestInput): Promise<HttpResult> => {
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

/** 按 HTTP 状态码生成用户可读的错误信息，保留响应体摘要便于排查。 */
export const readableHttpError = (status: number, body?: string): Error => {
  const detail = body?.trim() ? `：${body.trim().slice(0, 500)}` : ''
  if (status === 401) {
    return new Error('MCP 认证失败（HTTP 401）：请检查访问令牌（Token）是否正确' + detail)
  }
  if (status === 403) {
    return new Error('MCP 授权被拒绝（HTTP 403）：当前令牌无权访问该服务端' + detail)
  }
  if (status === 404) {
    return new Error(
      'MCP 端点不存在或会话已过期（HTTP 404）：请检查服务器地址是否正确' + detail
    )
  }
  if (status === 408 || status === 504) {
    return new Error(`MCP 请求超时（HTTP ${status}）：服务端响应过慢，请稍后重试`)
  }
  if (status >= 500) {
    return new Error(`MCP 服务端内部错误（HTTP ${status}）` + detail)
  }
  return new Error(`MCP 服务端返回 HTTP ${status}` + detail)
}

const getHeader = (
  headers: Record<string, string> | undefined,
  name: string
): string | undefined => {
  if (!headers) {
    return undefined
  }
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value
    }
  }
  return undefined
}

const SSE_LINE_SPLIT = /\r\n|\r|\n/

/** 解析单个 SSE 块（已按空行分隔）；注释帧 / 非 JSON 帧返回 null。 */
const parseSseBlock = (block: string): JsonRpcResponse | null => {
  const dataLines: string[] = []
  for (const line of block.split(SSE_LINE_SPLIT)) {
    if (!line || line.startsWith(':')) {
      continue
    }
    if (line.startsWith('data:')) {
      // 规范允许冒号后保留一个前导空格。
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    // event: / id: / retry: 对 JSON-RPC 响应解析无意义，忽略。
  }
  const data = dataLines.join('\n').trim()
  if (!data) {
    return null
  }
  try {
    return JSON.parse(data) as JsonRpcResponse
  } catch {
    // 忽略非 JSON 的保活 / 心跳帧。
    return null
  }
}

/**
 * 状态化 SSE 分帧解析器。
 * 兼容 LF / CRLF / CR 换行、多行 `data:` 拼接、心跳注释帧，以及流末尾缺少
 * 尾部空行的最后一帧。`push` 可多次调用投喂分块数据。
 */
export class SseFrameParser {
  private buffer = ''

  push(chunk: string): JsonRpcResponse[] {
    if (!chunk) {
      return []
    }
    this.buffer += chunk
    const frames: JsonRpcResponse[] = []
    let boundary: number
    while ((boundary = this.findBoundary()) >= 0) {
      const block = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + this.separatorLengthAt(boundary))
      const frame = parseSseBlock(block)
      if (frame) {
        frames.push(frame)
      }
    }
    return frames
  }

  /** 流结束后解析缓冲区里尚未以空行收尾的最后一帧。 */
  end(): JsonRpcResponse[] {
    if (!this.buffer) {
      return []
    }
    const frame = parseSseBlock(this.buffer)
    this.buffer = ''
    return frame ? [frame] : []
  }

  private findBoundary(): number {
    const candidates = ['\n\n', '\r\n\r\n', '\r\r']
      .map((separator) => this.buffer.indexOf(separator))
      .filter((index) => index >= 0)
    return candidates.length > 0 ? Math.min(...candidates) : -1
  }

  private separatorLengthAt(index: number): number {
    if (this.buffer.startsWith('\r\n\r\n', index)) {
      return 4
    }
    if (this.buffer.startsWith('\r\r', index)) {
      return 2
    }
    return 2
  }
}

/** 从一段响应体里找出与请求 id 匹配的 JSON-RPC 消息；兼容裸 JSON 与 SSE 文本。 */
const resolveMessageFromBody = (body: string, id: JsonRpcId): JsonRpcResponse | null => {
  const trimmed = body.trim()
  if (!trimmed) {
    return null
  }
  const looksLikeSse = /^(data:|event:)/m.test(trimmed)
  if (looksLikeSse) {
    const parser = new SseFrameParser()
    const frames = [...parser.push(trimmed), ...parser.end()]
    return frames.find((message) => message.id === id) ?? null
  }
  try {
    const message = JSON.parse(trimmed) as JsonRpcResponse
    return message.id === id ? message : null
  } catch {
    return null
  }
}

const errorFrom = (message: string, data?: unknown): Error => {
  const suffix = data === undefined ? '' : `：${JSON.stringify(data)}`
  return new Error(`${message}${suffix}`)
}

export type McpSessionOptions = {
  /** 可注入的 HTTP 实现（测试用）；缺省走浏览器 fetch 或 iOS 原生桥接。 */
  transport?: HttpRequester
  /** 单次请求超时（毫秒），默认 30000。 */
  timeoutMs?: number
}

/** 一个 MCP 服务端的会话。每次连接重新 initialize，并保留 Mcp-Session-Id。 */
export class McpSession {
  private nextId = 1
  private sessionId?: string
  private protocolVersion = PROTOCOL_VERSIONS[0]
  private readonly server: McpServerConfig
  private readonly signal?: AbortSignal
  private readonly options: McpSessionOptions

  constructor(server: McpServerConfig, signal?: AbortSignal, options: McpSessionOptions = {}) {
    this.server = server
    this.signal = signal
    this.options = options
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
    }
    if (this.server.token.trim()) {
      headers.Authorization = `Bearer ${this.server.token.trim()}`
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }
    return headers
  }

  /** GET 流不需要 body 与 Content-Type，只声明 SSE 接收。 */
  private streamHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
    }
    if (this.server.token.trim()) {
      headers.Authorization = `Bearer ${this.server.token.trim()}`
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }
    return headers
  }

  /** 合并外部中止信号与内部超时，调用注入或默认的 HTTP 实现。 */
  private async request(input: HttpRequestInput): Promise<HttpResult> {
    const requester = this.options.transport ?? defaultRequester ?? globalFetchRequester
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    if (this.signal?.aborted) {
      controller.abort(this.signal.reason)
    }
    const onExternalAbort = () => controller.abort(this.signal?.reason)
    this.signal?.addEventListener('abort', onExternalAbort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('MCP 请求超时')), timeoutMs)
    timer.unref?.()
    try {
      return await requester({ ...input, signal: controller.signal })
    } finally {
      clearTimeout(timer)
      this.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  private async post(
    payload: JsonRpcRequest,
    expectResponse: boolean,
    retried = false
  ): Promise<JsonRpcResponse | null> {
    const hadSessionId = Boolean(this.sessionId)
    const response: HttpResult = await this.request({
      url: this.server.url,
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    })
    const sessionId = getHeader(response.headers, 'mcp-session-id')
    if (sessionId) {
      this.sessionId = sessionId
    }

    if (response.status >= 400) {
      // 会话过期 / 失效：携带会话 id 却收到 404，清掉会话重新握手后重试一次。
      if (response.status === 404 && hadSessionId && !retried) {
        this.sessionId = undefined
        await this.initialize()
        return this.post(payload, expectResponse, true)
      }
      throw readableHttpError(response.status, response.body)
    }

    if (!expectResponse) {
      return null
    }

    // 202 Accepted / 空 body：真实响应在会话的 GET SSE 流上推送。
    if (!response.body.trim()) {
      return this.readResponseFromStream(payload.id as JsonRpcId)
    }

    const message = resolveMessageFromBody(response.body, payload.id as JsonRpcId)
    if (!message) {
      throw new Error('MCP 响应中没有匹配的 JSON-RPC 结果')
    }
    if (message.error) {
      throw errorFrom(message.error.message ?? 'MCP 调用失败', message.error.data)
    }
    return message
  }

  /** 打开会话的 GET SSE 流，等待与请求 id 匹配的 JSON-RPC 响应。 */
  private async readResponseFromStream(id: JsonRpcId): Promise<JsonRpcResponse> {
    const response = await this.request({
      url: this.server.url,
      method: 'GET',
      headers: this.streamHeaders(),
    })
    if (response.status >= 400) {
      throw readableHttpError(response.status, response.body)
    }
    const contentType = getHeader(response.headers, 'content-type') ?? ''
    let message: JsonRpcResponse | null = null
    if (!contentType.includes('text/event-stream')) {
      message = resolveMessageFromBody(response.body, id)
    }
    if (!message) {
      const parser = new SseFrameParser()
      const frames = [...parser.push(response.body), ...parser.end()]
      message = frames.find((item) => item.id === id) ?? null
    }
    if (!message) {
      throw new Error('MCP 服务端在响应流上没有返回匹配的 JSON-RPC 结果')
    }
    if (message.error) {
      throw errorFrom(message.error.message ?? 'MCP 调用失败', message.error.data)
    }
    return message
  }

  async initialize(): Promise<void> {
    let lastError: unknown
    for (const version of PROTOCOL_VERSIONS) {
      this.protocolVersion = version
      try {
        const response = await this.post(
          {
            jsonrpc: '2.0',
            id: this.nextId++,
            method: 'initialize',
            params: {
              protocolVersion: version,
              capabilities: {
                roots: { listChanged: false },
                sampling: {},
                elicitation: {},
              },
              clientInfo: { name: 'DeepSeek Mobile', version: '1.0.0' },
            },
          },
          true
        )
        const result = response?.result as { protocolVersion?: string } | undefined
        if (!result) {
          throw new Error('MCP initialize 没有返回结果')
        }
        if (typeof result.protocolVersion === 'string' && result.protocolVersion) {
          this.protocolVersion = result.protocolVersion
        }
        // 初始化通知没有 id，服务端一般返回 202。
        await this.post(
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          false
        )
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  async listTools(): Promise<Omit<McpTool, 'alias' | 'serverId' | 'serverName'>[]> {
    const tools: Omit<McpTool, 'alias' | 'serverId' | 'serverName'>[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const response = await this.post(
        {
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'tools/list',
          params: cursor ? { cursor } : {},
        },
        true
      )
      const result = response?.result as
        | {
            tools?: {
              name?: string
              title?: string
              description?: string
              inputSchema?: Record<string, unknown>
            }[]
            nextCursor?: string
          }
        | undefined
      for (const tool of result?.tools ?? []) {
        if (!tool.name) {
          continue
        }
        tools.push({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        })
      }
      cursor = result?.nextCursor
      if (!cursor) {
        break
      }
    }
    return tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const response = await this.post(
      {
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      true
    )
    const result = response?.result as McpCallResult | undefined
    if (!result || !Array.isArray(result.content)) {
      throw new Error('MCP tools/call 没有返回内容')
    }
    return result
  }
}

/** 把 MCP 返回的内容块拼成模型可读的纯文本。 */
export const stringifyToolResult = (result: McpCallResult): string => {
  const text = result.content
    .map((item) => {
      if (item.type === 'text' && typeof item.text === 'string') {
        return item.text
      }
      if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
        return JSON.stringify(item.resource)
      }
      return `[${item.type}] ${JSON.stringify(item)}`
    })
    .join('\n')
    .trim()
  return text || JSON.stringify(result)
}

/** 测试连接并返回工具列表。 */
export const testMcpServer = async (server: McpServerConfig): Promise<McpTool[]> => {
  const session = new McpSession(server)
  await session.initialize()
  const tools = await session.listTools()
  return tools.map((tool, index) => ({
    ...tool,
    alias: `mcp_${server.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}_${tool.name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 35)}_${index}`,
    serverId: server.id,
    serverName: server.name,
  }))
}
