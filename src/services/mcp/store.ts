import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { McpSession, stringifyToolResult, testMcpServer } from './client.js'
import type {
  McpConnectionStatus,
  McpServerConfig,
  McpTool,
} from './types.js'

const SERVERS_KEY = 'chat-demo:mcp-servers'
const TOOLS_KEY = 'chat-demo:mcp-enabled-tools'

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储不可用时仅保留在内存中
  }
}

type McpState = {
  loaded: boolean
  servers: McpServerConfig[]
  tools: McpTool[]
  statuses: Record<string, McpConnectionStatus>
  errors: Record<string, string>
  /** alias -> 是否启用，缺省为启用 */
  enabledTools: Record<string, boolean>
}

export const useMcp = create<McpState>(() => ({
  loaded: false,
  servers: [],
  tools: [],
  statuses: {},
  errors: {},
  enabledTools: {},
}))

const { getState: get, setState: set } = useMcp

const persistServers = (servers: McpServerConfig[]) => writeJson(SERVERS_KEY, servers)

const persistEnabledTools = (enabledTools: Record<string, boolean>) =>
  writeJson(TOOLS_KEY, enabledTools)

/** 别名稳定、只含安全字符，并带服务端短 id 避免不同服务端同名工具冲突。 */
export const aliasForTool = (server: McpServerConfig, toolName: string): string => {
  const name = toolName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 45)
  return `mcp_${server.id.slice(0, 6)}_${name}`.slice(0, 64)
}

const withAliases = (server: McpServerConfig, tools: Omit<McpTool, 'alias' | 'serverId' | 'serverName'>[]): McpTool[] => {
  const seen = new Map<string, number>()
  return tools.map((tool) => {
    let alias = aliasForTool(server, tool.name)
    const count = seen.get(alias) ?? 0
    seen.set(alias, count + 1)
    if (count > 0) {
      alias = `${alias.slice(0, 58)}_${count}`
    }
    return { ...tool, alias, serverId: server.id, serverName: server.name }
  })
}

export const loadMcp = () => {
  if (get().loaded) {
    return
  }
  const servers = readJson<McpServerConfig[]>(SERVERS_KEY, []).filter(
    (server) =>
      typeof server?.id === 'string' &&
      typeof server?.name === 'string' &&
      typeof server?.url === 'string'
  )
  const enabledTools = readJson<Record<string, boolean>>(TOOLS_KEY, {})
  set({ loaded: true, servers, enabledTools })
  void refreshAll()
}

export const refreshAll = async () => {
  const servers = get().servers.filter((server) => server.enabled)
  await Promise.allSettled(servers.map((server) => connectServer(server.id)))
}

export const connectServer = async (id: string): Promise<void> => {
  const server = get().servers.find((item) => item.id === id)
  if (!server) {
    return
  }
  set((state) => ({
    statuses: { ...state.statuses, [id]: 'connecting' },
    errors: Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== id)),
  }))
  try {
    const session = new McpSession(server)
    await session.initialize()
    const rawTools = await session.listTools()
    const tools = withAliases(server, rawTools)
    set((state) => ({
      tools: [...state.tools.filter((tool) => tool.serverId !== id), ...tools],
      statuses: { ...state.statuses, [id]: 'connected' },
    }))
  } catch (error) {
    set((state) => ({
      tools: state.tools.filter((tool) => tool.serverId !== id),
      statuses: { ...state.statuses, [id]: 'error' },
      errors: {
        ...state.errors,
        [id]: error instanceof Error ? error.message : String(error),
      },
    }))
  }
}

export const addServer = (input: Omit<McpServerConfig, 'id' | 'enabled'>): McpServerConfig => {
  const server: McpServerConfig = {
    ...input,
    id: createId(),
    enabled: true,
  }
  const servers = [...get().servers, server]
  set({ servers })
  persistServers(servers)
  void connectServer(server.id)
  return server
}

export const updateServer = (
  id: string,
  patch: Partial<Pick<McpServerConfig, 'name' | 'url' | 'token'>>
): void => {
  const servers = get().servers.map((server) =>
    server.id === id ? { ...server, ...patch } : server
  )
  set({ servers })
  persistServers(servers)
  void connectServer(id)
}

export const removeServer = (id: string): void => {
  const servers = get().servers.filter((server) => server.id !== id)
  set((state) => ({
    servers,
    tools: state.tools.filter((tool) => tool.serverId !== id),
    statuses: Object.fromEntries(
      Object.entries(state.statuses).filter(([key]) => key !== id)
    ),
    errors: Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== id)),
  }))
  persistServers(servers)
}

export const setServerEnabled = (id: string, enabled: boolean): void => {
  const servers = get().servers.map((server) =>
    server.id === id ? { ...server, enabled } : server
  )
  set({ servers })
  persistServers(servers)
  if (enabled) {
    void connectServer(id)
  } else {
    set((state) => ({
      tools: state.tools.filter((tool) => tool.serverId !== id),
      statuses: { ...state.statuses, [id]: 'idle' },
    }))
  }
}

export const setToolEnabled = (alias: string, enabled: boolean): void => {
  const enabledTools = { ...get().enabledTools, [alias]: enabled }
  set({ enabledTools })
  persistEnabledTools(enabledTools)
}

/** 本轮请求可用的 MCP 工具；服务端未连接或工具被关闭的不发送。 */
export const getEnabledMcpTools = (): McpTool[] => {
  const { tools, enabledTools, servers, statuses } = get()
  return tools.filter(
    (tool) =>
      enabledTools[tool.alias] !== false &&
      servers.some((server) => server.id === tool.serverId && server.enabled) &&
      statuses[tool.serverId] === 'connected'
  )
}

/** 转成 Anthropic Messages API 的客户端工具声明。 */
export const getMcpToolDefinitions = (): {
  name: string
  description: string
  input_schema: Record<string, unknown>
}[] =>
  getEnabledMcpTools().map((tool) => ({
    name: tool.alias,
    description: `[MCP · ${tool.serverName}] ${tool.description ?? tool.title ?? tool.name}`.slice(
      0,
      1024
    ),
    input_schema:
      tool.inputSchema && Object.keys(tool.inputSchema).length > 0
        ? tool.inputSchema
        : { type: 'object', properties: {} },
  }))

export const callMcpTool = async (
  alias: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> => {
  const tool = get().tools.find((item) => item.alias === alias)
  if (!tool) {
    throw new Error(`未找到 MCP 工具 ${alias}`)
  }
  const server = get().servers.find((item) => item.id === tool.serverId)
  if (!server) {
    throw new Error(`MCP 服务端 ${tool.serverName} 已被移除`)
  }
  const session = new McpSession(server, signal)
  await session.initialize()
  const result = await session.callTool(tool.name, input)
  return stringifyToolResult(result)
}

/** 仅测试连接，不写入 store。 */
export const testConnection = async (server: McpServerConfig): Promise<McpTool[]> => {
  const tools = await testMcpServer(server)
  return withAliases(server, tools)
}
