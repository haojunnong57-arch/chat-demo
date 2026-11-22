import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { McpSession, SseFrameParser, stringifyToolResult } from '../src/services/mcp/client.ts'
import type { HttpRequestInput, HttpResult } from '../src/services/mcp/http.ts'
import type { McpServerConfig } from '../src/services/mcp/types.ts'

type MockRequest = {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

type MockResponse = {
  status: number
  headers?: Record<string, string>
  body?: string
}

type MockHandler = (req: MockRequest) => MockResponse

const makeConfig = (url: string): McpServerConfig => ({
  id: 'test-server',
  name: 'mock',
  url,
  token: '',
  enabled: true,
})

const parseBody = (raw: string): { id?: number; method?: string; params?: unknown } | null => {
  if (!raw.trim()) {
    return null
  }
  try {
    return JSON.parse(raw) as { id?: number; method?: string; params?: unknown }
  } catch {
    return null
  }
}

const sseFrame = (message: unknown): string => `data: ${JSON.stringify(message)}\n\n`

const startMockServer = (handler: MockHandler) =>
  new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk.toString()
      })
      req.on('end', () => {
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
          headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
        }
        let result: MockResponse
        try {
          result = handler({ method: req.method ?? 'GET', url: req.url ?? '/', headers, body: raw })
        } catch (error) {
          result = { status: 500, body: error instanceof Error ? error.message : String(error) }
        }
        res.writeHead(result.status, {
          'Content-Type': 'application/json',
          ...(result.headers ?? {}),
        })
        res.end(result.body ?? '')
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
      })
    })
  })

test('全链路：initialize → notifications/initialized → tools/list → tools/call 成功', async () => {
  const seenMethods: string[] = []
  const server = await startMockServer(({ method, body }) => {
    const msg = parseBody(body)
    if (method !== 'POST' || !msg) {
      return { status: 405, body: 'method not allowed' }
    }
    seenMethods.push(msg.method ?? '')
    if (msg.method === 'initialize') {
      return {
        status: 200,
        headers: { 'Mcp-Session-Id': 'sess-1' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'mock', version: '1.0.0' },
          },
        }),
      }
    }
    if (msg.method === 'notifications/initialized') {
      return { status: 202, body: '' }
    }
    if (msg.method === 'tools/list') {
      return {
        status: 200,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              {
                name: 'ping',
                description: 'ping 工具',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          },
        }),
      }
    }
    if (msg.method === 'tools/call') {
      return {
        status: 200,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'pong' }] },
        }),
      }
    }
    return { status: 404, body: 'unknown method' }
  })

  try {
    const session = new McpSession(makeConfig(server.url))
    await session.initialize()
    const tools = await session.listTools()
    assert.equal(tools.length, 1)
    assert.equal(tools[0]?.name, 'ping')
    const result = await session.callTool('ping', { who: 'demo' })
    assert.equal(stringifyToolResult(result), 'pong')
    assert.deepEqual(seenMethods, [
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
    ])
  } finally {
    await server.close()
  }
})

test('SSE 分帧：data 跨多块、CRLF、心跳注释帧、末尾无空行', () => {
  const parser = new SseFrameParser()

  // data 跨两次 push，CRLF 换行。
  assert.deepEqual(parser.push('data: {"jsonrpc":"2.0","id":1,"resu'), [])
  assert.deepEqual(parser.push('lt":{"ok":true}}\r\n\r\n'), [
    { jsonrpc: '2.0', id: 1, result: { ok: true } },
  ])

  // 心跳注释帧穿插在正式帧之间，应被忽略。
  const frames = parser.push(': ping\r\n: keep-alive\r\ndata: {"jsonrpc":"2.0","id":2}\r\n\r\n')
  assert.deepEqual(frames, [{ jsonrpc: '2.0', id: 2 }])

  // 多行 data 拼接；流结束时补上缺少尾部空行的最后一帧。
  parser.push('data: {"jsonrpc":"2.0","id":3,\ndata: "result":4}\n')
  assert.deepEqual(parser.end(), [{ jsonrpc: '2.0', id: 3, result: 4 }])
})

test('POST 以 text/event-stream 返回响应，心跳注释帧不影响匹配', async () => {
  const server = await startMockServer(({ body }) => {
    const msg = parseBody(body)
    if (msg?.method === 'initialize') {
      const sse = [
        ': heartbeat\n\n',
        `event: message\n${sseFrame({
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: {} },
        })}`,
      ].join('')
      return {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'sess-sse' },
        body: sse,
      }
    }
    if (msg?.method === 'notifications/initialized') {
      return { status: 202, body: '' }
    }
    return { status: 200, body: sseFrame({ jsonrpc: '2.0', id: msg?.id, result: { tools: [] } }) }
  })

  try {
    const session = new McpSession(makeConfig(server.url))
    await session.initialize()
    const tools = await session.listTools()
    assert.equal(tools.length, 0)
  } finally {
    await server.close()
  }
})

test('202 Accepted：POST 空 body，响应在 GET SSE 流上推送', async () => {
  const pending: unknown[] = []
  const getMethods: string[] = []
  const server = await startMockServer(({ method, headers, body }) => {
    const msg = parseBody(body)
    if (method === 'POST') {
      if (msg?.method === 'initialize') {
        pending.push({
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: {} },
        })
        return { status: 202, headers: { 'Mcp-Session-Id': 'sess-202' }, body: '' }
      }
      if (msg?.method === 'notifications/initialized') {
        return { status: 202, body: '' }
      }
      if (msg?.method === 'tools/list') {
        pending.push({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [{ name: 'add', inputSchema: { type: 'object', properties: {} } }],
          },
        })
        return { status: 202, body: '' }
      }
      if (msg?.method === 'tools/call') {
        pending.push({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'sum=42' }] },
        })
        return { status: 202, body: '' }
      }
    }
    if (method === 'GET') {
      getMethods.push(headers['mcp-session-id'] ?? '')
      const frames = pending.splice(0).map((message) => sseFrame(message)).join('')
      return { status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: frames }
    }
    return { status: 405, body: '' }
  })

  try {
    const session = new McpSession(makeConfig(server.url))
    await session.initialize()
    const tools = await session.listTools()
    assert.equal(tools[0]?.name, 'add')
    const result = await session.callTool('add', { a: 1, b: 2 })
    assert.equal(stringifyToolResult(result), 'sum=42')
    // 三个需要响应的请求都通过 GET 流拿到了结果，且带上了会话 id。
    assert.equal(getMethods.length, 3)
    assert.ok(getMethods.every((id) => id === 'sess-202'))
  } finally {
    await server.close()
  }
})

test('会话过期：携带失效 Mcp-Session-Id 收到 404 后自动重连并重放请求', async () => {
  let initializeCount = 0
  let currentSession = ''
  const server = await startMockServer(({ method, headers, body }) => {
    const msg = parseBody(body)
    if (method === 'POST' && msg?.method === 'initialize') {
      initializeCount += 1
      currentSession = initializeCount === 1 ? 'sess-old' : 'sess-new'
      return {
        status: 200,
        headers: { 'Mcp-Session-Id': currentSession },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: {} },
        }),
      }
    }
    if (headers['mcp-session-id'] === 'sess-old') {
      return { status: 404, body: 'session not found' }
    }
    if (method === 'POST' && msg?.method === 'notifications/initialized') {
      return { status: 202, body: '' }
    }
    if (method === 'POST' && msg?.method === 'tools/list') {
      return {
        status: 200,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [{ name: 'renewed', inputSchema: { type: 'object', properties: {} } }],
          },
        }),
      }
    }
    return { status: 405, body: '' }
  })

  try {
    const session = new McpSession(makeConfig(server.url))
    await session.initialize()
    const tools = await session.listTools()
    assert.equal(initializeCount, 2)
    assert.equal(tools.length, 1)
    assert.equal(tools[0]?.name, 'renewed')
  } finally {
    await server.close()
  }
})

test('401 与 500 错误转换为用户可读信息', async () => {
  const unauthorized = await startMockServer(() => ({
    status: 401,
    body: '{"error":"invalid token"}',
  }))
  try {
    const session = new McpSession(makeConfig(unauthorized.url))
    await assert.rejects(() => session.initialize(), /401/)
    await assert.rejects(() => session.initialize(), /令牌/)
  } finally {
    await unauthorized.close()
  }

  const broken = await startMockServer(() => ({ status: 500, body: 'boom' }))
  try {
    const session = new McpSession(makeConfig(broken.url))
    await assert.rejects(() => session.initialize(), /500/)
    await assert.rejects(() => session.initialize(), /内部错误/)
  } finally {
    await broken.close()
  }
})

test('可注入 transport：自定义实现被调用，浏览器默认行为不受影响', async () => {
  const calls: { method: string }[] = []
  const fakeTransport = async (input: HttpRequestInput): Promise<HttpResult> => {
    calls.push({ method: input.method })
    const msg = parseBody(input.body ?? '')
    if (msg?.method === 'initialize') {
      return {
        status: 200,
        headers: { 'mcp-session-id': 'sess-injected' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: {} },
        }),
      }
    }
    if (msg?.method === 'notifications/initialized') {
      return { status: 202, headers: {}, body: '' }
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: msg?.id,
        result: { tools: [], nextCursor: undefined },
      }),
    }
  }

  const session = new McpSession(makeConfig('http://unused.invalid/mcp'), undefined, {
    transport: fakeTransport,
  })
  await session.initialize()
  await session.listTools()
  assert.ok(calls.some((call) => call.method === 'POST'))
})

test('外部 AbortSignal 中止请求时抛出中止错误', async () => {
  const server = await startMockServer(({ body }) => {
    const msg = parseBody(body)
    return {
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: msg?.id,
        result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: {} },
      }),
    }
  })
  try {
    const controller = new AbortController()
    const session = new McpSession(makeConfig(server.url), controller.signal)
    controller.abort()
    await assert.rejects(() => session.initialize(), /中止|超时|abort/i)
  } finally {
    await server.close()
  }
})
