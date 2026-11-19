import { mcpHttpRequest, type HttpResult } from './http.js'
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

const getHeader = (headers: Record<string, string>, name: string): string | undefined => {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value
    }
  }
  return undefined
}

const decodeSse = (body: string, id: JsonRpcId): JsonRpcResponse | null => {
  const blocks = body.split(/\r?\n\r?\n/)
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data) {
      continue
    }
    try {
      const message = JSON.parse(data) as JsonRpcResponse
      if (message.id === id) {
        return message
      }
    } catch {
      // 忽略非 JSON 的保活帧
    }
  }
  return null
}

const errorFrom = (message: string, data?: unknown): Error => {
  const suffix = data === undefined ? '' : `：${JSON.stringify(data)}`
  return new Error(`${message}${suffix}`)
}

/** 一个 MCP 服务端的会话。每次连接重新 initialize，并保留 Mcp-Session-Id。 */
export class McpSession {
  private nextId = 1
  private sessionId?: string
  private protocolVersion = PROTOCOL_VERSIONS[0]

  constructor(
    private readonly server: McpServerConfig,
    private readonly signal?: AbortSignal
  ) {}

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

  private async post(
    payload: JsonRpcRequest,
    expectResponse: boolean
  ): Promise<JsonRpcResponse | null> {
    const response: HttpResult = await mcpHttpRequest({
      url: this.server.url,
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: this.signal,
    })
    const sessionId = getHeader(response.headers, 'mcp-session-id')
    if (sessionId) {
      this.sessionId = sessionId
    }
    if (response.status >= 400) {
      throw new Error(
        `MCP 服务端返回 HTTP ${response.status}${response.body ? `：${response.body.slice(0, 500)}` : ''}`
      )
    }
    if (!expectResponse) {
      return null
    }
    if (!response.body.trim()) {
      throw new Error('MCP 服务端没有返回响应体')
    }
    const contentType = getHeader(response.headers, 'content-type') ?? ''
    const id = payload.id as JsonRpcId
    let message: JsonRpcResponse | null
    if (contentType.includes('text/event-stream') || response.body.trimStart().startsWith('event:')) {
      message = decodeSse(response.body, id)
    } else {
      try {
        message = JSON.parse(response.body) as JsonRpcResponse
      } catch {
        throw new Error(`MCP 响应不是合法 JSON：${response.body.slice(0, 300)}`)
      }
    }
    if (!message) {
      throw new Error('MCP 响应中没有匹配的 JSON-RPC 结果')
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
        if (!response?.result) {
          throw new Error('MCP initialize 没有返回结果')
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
