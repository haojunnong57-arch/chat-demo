import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type Server } from 'node:http'
import { OpenAiAssembler, toOpenAiRequest, parseOpenAiChunk } from '../src/services/providers/adapters/openai.ts'
import { GeminiAssembler, toGeminiRequest, parseGeminiChunk } from '../src/services/providers/adapters/gemini.ts'
import {
  parseOpenAiModels,
  parseAnthropicModels,
  parseGeminiModels,
  fetchModels,
  modelsPath,
} from '../src/services/providers/models.ts'
import { readMessageEvent } from '../src/services/api/parseEvent.ts'
import type { ProviderInstance } from '../src/services/providers/types.ts'

const instance = (baseUrl: string, patch: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id: 'test-instance',
  kind: 'deepseek',
  label: 'Test',
  protocol: 'openai-chat',
  baseUrl,
  apiKey: 'secret-key',
  models: [],
  model: 'gpt-4o',
  ...patch,
})

// ---------- 模型列表响应解析 ----------

test('parseOpenAiModels reads data[].id', () => {
  assert.deepEqual(parseOpenAiModels({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }), [
    'gpt-4o',
    'gpt-4o-mini',
  ])
})

test('parseAnthropicModels reads data[].id', () => {
  assert.deepEqual(parseAnthropicModels({ data: [{ id: 'claude-sonnet-4-5' }] }), [
    'claude-sonnet-4-5',
  ])
})

test('parseGeminiModels strips the models/ prefix', () => {
  assert.deepEqual(
    parseGeminiModels({ models: [{ name: 'models/gemini-2.5-pro' }, { name: 'gemini-1.5-flash' }] }),
    ['gemini-2.5-pro', 'gemini-1.5-flash']
  )
})

test('model list parsers reject malformed payloads', () => {
  assert.throws(() => parseOpenAiModels({}))
  assert.throws(() => parseAnthropicModels({ data: 'nope' }))
  assert.throws(() => parseGeminiModels(null))
})

test('modelsPath maps protocol api to endpoint suffix', () => {
  assert.equal(modelsPath('openai'), '/models')
  assert.equal(modelsPath('anthropic'), '/v1/models')
  assert.equal(modelsPath('gemini'), '/v1beta/models')
})

// ---------- OpenAI Chat 协议：SSE 增量拼装 ----------

test('OpenAI assembler stitches text, tool-call arguments and stop reason', () => {
  const assembler = new OpenAiAssembler()
  const events = [
    ...assembler.push({
      id: 'chat-1',
      model: 'gpt-4o',
      choices: [{ delta: { content: '你好' } }],
    }),
    ...assembler.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city":' } },
            ],
          },
        },
      ],
    }),
    ...assembler.push({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"北京"}' } }] } }],
    }),
    ...assembler.push({ choices: [{ finish_reason: 'tool_calls' }] }),
    ...assembler.end(),
  ]

  assert.equal(events[0].type, 'message_start')
  if (events[0].type === 'message_start') {
    assert.equal(events[0].message.model, 'gpt-4o')
  }

  const textStart = events.find((event) => event.type === 'content_block_start' && event.index === 0)
  assert.ok(textStart)
  const textDeltas = events.filter(
    (event) => event.type === 'content_block_delta' && event.index === 0
  )
  assert.equal(textDeltas.length, 1)
  if (textDeltas[0]?.type === 'content_block_delta' && textDeltas[0].delta.type === 'text_delta') {
    assert.equal(textDeltas[0].delta.text, '你好')
  }

  const toolStart = events.find(
    (event) => event.type === 'content_block_start' && event.content_block.type === 'tool_use'
  )
  assert.ok(toolStart)
  if (toolStart?.type === 'content_block_start' && toolStart.content_block.type === 'tool_use') {
    assert.equal(toolStart.content_block.id, 'call_1')
    assert.equal(toolStart.content_block.name, 'get_weather')
  }
  const argDeltas = events.filter(
    (event) => event.type === 'content_block_delta' && event.delta.type === 'input_json_delta'
  )
  assert.deepEqual(
    argDeltas.map((event) =>
      event.type === 'content_block_delta' && event.delta.type === 'input_json_delta'
        ? event.delta.partial_json
        : ''
    ),
    ['{"city":', '"北京"}']
  )

  const lastDelta = events.at(-2)
  assert.equal(lastDelta?.type, 'message_delta')
  if (lastDelta?.type === 'message_delta') {
    assert.equal(lastDelta.delta.stop_reason, 'tool_use')
  }
  assert.equal(events.at(-1)?.type, 'message_stop')
})

test('OpenAI assembler ends a plain chat with end_turn', () => {
  const assembler = new OpenAiAssembler()
  assembler.push({ choices: [{ delta: { content: 'hi' } }] })
  const events = assembler.end()
  const delta = events.find((event) => event.type === 'message_delta')
  assert.ok(delta)
  if (delta?.type === 'message_delta') {
    assert.equal(delta.delta.stop_reason, 'end_turn')
  }
})

test('parseOpenAiChunk treats [DONE] as terminal and ignores bad JSON', () => {
  assert.equal(parseOpenAiChunk('[DONE]'), null)
  assert.throws(() => parseOpenAiChunk('not-json'))
})

// ---------- Gemini 协议：SSE 增量拼装 ----------

test('Gemini assembler stitches parts text and finishes with end_turn', () => {
  const assembler = new GeminiAssembler()
  const events = [
    ...assembler.push({ candidates: [{ content: { parts: [{ text: 'Hello ' }] } }] }),
    ...assembler.push({
      candidates: [{ content: { parts: [{ text: 'world' }] }, finishReason: 'STOP' }],
    }),
    ...assembler.end(),
  ]

  assert.equal(events[0].type, 'message_start')
  const deltas = events.filter(
    (event) => event.type === 'content_block_delta' && event.delta.type === 'text_delta'
  )
  assert.deepEqual(
    deltas.map((event) =>
      event.type === 'content_block_delta' && event.delta.type === 'text_delta'
        ? event.delta.text
        : ''
    ),
    ['Hello ', 'world']
  )
  const delta = events.find((event) => event.type === 'message_delta')
  if (delta?.type === 'message_delta') {
    assert.equal(delta.delta.stop_reason, 'end_turn')
  }
  assert.equal(events.at(-1)?.type, 'message_stop')
})

test('parseGeminiChunk rejects bad JSON', () => {
  assert.throws(() => parseGeminiChunk('{oops'))
})

// ---------- Anthropic Messages 协议：既有事件解析回归 ----------

test('anthropic readMessageEvent parses start / delta / stop frames', () => {
  const start = readMessageEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  assert.equal(start?.type, 'content_block_start')
  const delta = readMessageEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'hi' },
  })
  assert.equal(delta?.type, 'content_block_delta')
  const stop = readMessageEvent({ type: 'message_stop' })
  assert.equal(stop?.type, 'message_stop')
})

// ---------- 请求翻译 ----------

test('toOpenAiRequest maps system, messages and MCP tools', () => {
  const request = toOpenAiRequest({
    model: 'gpt-4o',
    system: 'You are helpful.',
    messages: [
      { role: 'latest_reminder', content: 'reminder' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'tool_a', input: { q: 1 } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }],
      },
    ],
    thinking: { type: 'disabled' },
    tools: [
      { type: 'deepseek_read_url', name: 'deepseek_read_url' },
      { name: 'tool_a', description: 'A tool', input_schema: { type: 'object' } },
    ],
    safety_check: { level: 'high' },
  })

  const messages = request.messages as Array<Record<string, unknown>>
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[0].content, 'You are helpful.\n\nreminder')
  assert.equal(messages[1].role, 'user')
  assert.equal(messages[1].content, 'hello')
  const assistant = messages[2]
  assert.deepEqual((assistant.tool_calls as unknown[])[0], {
    id: 'call_1',
    type: 'function',
    function: { name: 'tool_a', arguments: '{"q":1}' },
  })
  const toolMessage = messages[3]
  assert.equal(toolMessage.role, 'tool')
  assert.equal(toolMessage.tool_call_id, 'call_1')
  const tools = request.tools as Array<{ function: { name: string } }>
  assert.equal(tools.length, 1)
  assert.equal(tools[0].function.name, 'tool_a')
})

test('toGeminiRequest maps contents and drops tool declarations', () => {
  const request = toGeminiRequest({
    model: 'gemini-2.5-pro',
    system: 'system prompt',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ],
    thinking: { type: 'disabled' },
    tools: [],
    safety_check: { level: 'high' },
  })
  assert.equal(request.systemInstruction?.parts[0].text, 'system prompt')
  const contents = request.contents as Array<{ role: string; parts: { text: string }[] }>
  assert.equal(contents[0].role, 'user')
  assert.equal(contents[0].parts[0].text, 'hi')
  assert.equal(contents[1].role, 'model')
  assert.equal('tools' in request, false)
})

// ---------- 模型拉取错误分型（本地 mock HTTP，不打外网） ----------

type Handler = (url: string) => { status: number; body: string; contentType?: string }

const startMockServer = (handler: Handler): Promise<{ server: Server; port: number }> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const result = handler(req.url ?? '/')
      res.writeHead(result.status, { 'Content-Type': result.contentType ?? 'application/json' })
      res.end(result.body)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })

test('fetchModels returns parsed models from a mock OpenAI endpoint', async () => {
  const { server, port } = await startMockServer(() => ({
    status: 200,
    body: JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
  }))
  try {
    const result = await fetchModels(instance(`http://127.0.0.1:${port}`))
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.models, ['gpt-4o', 'gpt-4o-mini'])
    }
  } finally {
    server.close()
  }
})

test('fetchModels classifies 401 as unauthorized and 404 as endpointNotFound', async () => {
  const { server, port } = await startMockServer((url) =>
    url.includes('/401')
      ? { status: 401, body: 'unauthorized' }
      : { status: 404, body: 'not found' }
  )
  try {
    const unauthorized = await fetchModels(instance(`http://127.0.0.1:${port}/401`))
    assert.equal(unauthorized.ok, false)
    if (!unauthorized.ok) {
      assert.equal(unauthorized.failure.kind, 'unauthorized')
      assert.equal(unauthorized.failure.status, 401)
    }
    const notFound = await fetchModels(instance(`http://127.0.0.1:${port}/404`))
    assert.equal(notFound.ok, false)
    if (!notFound.ok) {
      assert.equal(notFound.failure.kind, 'endpointNotFound')
    }
  } finally {
    server.close()
  }
})

test('fetchModels classifies a non-JSON body as protocol failure', async () => {
  const { server, port } = await startMockServer(() => ({
    status: 200,
    body: '<html>bad gateway</html>',
    contentType: 'text/html',
  }))
  try {
    const result = await fetchModels(instance(`http://127.0.0.1:${port}`))
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.failure.kind, 'protocol')
    }
  } finally {
    server.close()
  }
})

test('fetchModels classifies an unreachable host as network failure', async () => {
  const result = await fetchModels(instance('http://127.0.0.1:1'))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.failure.kind, 'network')
  }
})
