import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readServerSentEvents,
  ServerSentEventDecoder,
  type ServerSentEvent,
} from '../src/services/api/sse.ts'

const encoder = new TextEncoder()

const streamOf = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })

const collect = async (stream: ReadableStream<Uint8Array>): Promise<ServerSentEvent[]> => {
  const events: ServerSentEvent[] = []
  for await (const event of readServerSentEvents(stream)) events.push(event)
  return events
}

test('decoder handles LF, CRLF and CR line endings', () => {
  const decoder = new ServerSentEventDecoder()
  assert.deepEqual(decoder.push('event: message\ndata: one\n\n'), [
    { event: 'message', data: 'one', lastEventId: '' },
  ])
  assert.deepEqual(decoder.push('event:message\r\ndata: two\r\n\r\n'), [
    { event: 'message', data: 'two', lastEventId: '' },
  ])
  assert.deepEqual(decoder.push('event: message\rdata: three\r\r '), [
    { event: 'message', data: 'three', lastEventId: '' },
  ])
})

test('decoder joins multi-line data and keeps the last event id', () => {
  const decoder = new ServerSentEventDecoder()
  const events = decoder.push('id: 42\nevent: content_block_delta\ndata: line 1\ndata: line 2\n\n')
  assert.deepEqual(events, [
    { event: 'content_block_delta', data: 'line 1\nline 2', lastEventId: '42' },
  ])
})

test('decoder waits for a split CRLF and drops unterminated events at EOF', () => {
  const decoder = new ServerSentEventDecoder()
  assert.deepEqual(decoder.push('data: hello\r'), [])
  assert.deepEqual(decoder.push('\n\r\n'), [{ event: 'message', data: 'hello', lastEventId: '' }])
  assert.deepEqual(decoder.push('data: unfinished'), [])
  assert.deepEqual(decoder.end(), [])
})

test('byte stream preserves UTF-8 characters split across chunks', async () => {
  const full = encoder.encode('data: 你好，世界\n\n')
  const chunks = [
    full.slice(0, 7),
    full.slice(7, 10),
    full.slice(10, 13),
    full.slice(13),
  ]
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  assert.deepEqual(await collect(stream), [
    { event: 'message', data: '你好，世界', lastEventId: '' },
  ])
})

test('stream yields message_stop and keeps ping events out of protocol parsing', async () => {
  const events = await collect(
    streamOf([
      'event: ping\ndata: {}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])
  )
  assert.equal(events.length, 3)
  assert.equal(events[1].event, 'content_block_delta')
  assert.equal(events[2].event, 'message_stop')
})

test('abort cancels the reader and stops iteration', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: first\n\n'))
    },
    cancel() {
      cancelled = true
    },
  })
  const controller = new AbortController()
  const iterator = readServerSentEvents(stream, controller.signal)
  const first = await iterator.next()
  assert.equal(first.value?.data, 'first')
  controller.abort()
  await iterator.return(undefined)
  assert.equal(cancelled, true)
})
