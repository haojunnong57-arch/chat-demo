/** MCP 连接配置与工具类型。仅保存到本机 localStorage，不上传任何服务器信息。 */

export type McpServerConfig = {
  id: string
  name: string
  /** Streamable HTTP 端点，例如 https://mcp.example.com/mcp */
  url: string
  /** 可选的 Bearer Token */
  token: string
  enabled: boolean
}

export type McpTool = {
  /** 发送给模型时使用的安全别名，保证只含字母、数字、下划线和短横线 */
  alias: string
  /** MCP 服务端声明的原始工具名 */
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  serverId: string
  serverName: string
}

export type McpToolContent = {
  type: string
  text?: string
  [key: string]: unknown
}

export type McpCallResult = {
  content: McpToolContent[]
  isError?: boolean
  [key: string]: unknown
}

export type McpConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'
