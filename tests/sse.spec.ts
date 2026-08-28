import { describe, expect, it } from 'vitest'
import { GatewaySseClient, SseParser, SseRingBuffer } from '../src/sse.js'

describe('SseParser', () => {
  it('emits event+data frames across chunk boundaries', () => {
    const frames: Array<[string, string]> = []
    const p = new SseParser((event, data) => frames.push([event, data]))
    p.push('event: agents\nda')
    p.push('ta: {"a":1}\n\n')
    expect(frames).toEqual([['agents', '{"a":1}']])
  })

  it('handles multi-line data, CRLF and default event name', () => {
    const frames: Array<[string, string]> = []
    const p = new SseParser((event, data) => frames.push([event, data]))
    p.push('data: one\r\ndata: two\r\n\r\ndata: {"x":2}\n\n')
    expect(frames).toEqual([
      ['message', 'one\ntwo'],
      ['message', '{"x":2}'],
    ])
  })

  it('ignores comment/heartbeat lines', () => {
    const frames: Array<[string, string]> = []
    const p = new SseParser((event, data) => frames.push([event, data]))
    p.push(': ping\n\n: keepalive\nevent: transcript\ndata: hi\n\n')
    expect(frames).toEqual([['transcript', 'hi']])
  })

  it('defaults event field to message', () => {
    const frames: Array<[string, string]> = []
    const p = new SseParser((event, data) => frames.push([event, data]))
    p.push('data: ok\n\n')
    expect(frames).toEqual([['message', 'ok']])
  })
})

describe('SseRingBuffer', () => {
  it('assigns monotonic seq and replays eventsSince (strictly after)', () => {
    const r = new SseRingBuffer(100)
    r.push('agents', { id: 'a1' })      // seq 0
    r.push('transcript', { id: 't1' })  // seq 1
    r.push('agents', { id: 'a2' })      // seq 2
    expect(r.total).toBe(3)
    expect(r.size).toBe(3)

    const after = r.eventsSince(1)
    expect(after.map((ev) => ev.seq)).toEqual([2])
    expect(after[0]!.channel).toBe('agents')
    expect(after[0]!.data).toEqual({ id: 'a2' })

    expect(r.eventsSince(0).map((ev) => ev.channel)).toEqual(['transcript', 'agents'])
    // Fresh cursor (-1) sees everything.
    expect(r.eventsSince(-1).map((ev) => ev.seq)).toEqual([0, 1, 2])
  })

  it('resyncs fully when the requested seq fell out of the window', () => {
    const r = new SseRingBuffer(2)
    r.push('a', 1) // seq 0 (evicted)
    r.push('b', 2) // seq 1
    r.push('c', 3) // seq 2
    expect(r.size).toBe(2)
    // Carrying a cursor older than the window forces a full resync.
    const all = r.eventsSince(-1)
    expect(all.map((ev) => ev.seq)).toEqual([1, 2])
  })

  it('returns [] for the empty ring', () => {
    expect(new SseRingBuffer().eventsSince(0)).toEqual([])
  })
})

describe('GatewaySseClient', () => {
  it('reports a fresh idle state and empty replay before any connection', () => {
    const c = new GatewaySseClient({ resolveBase: () => null })
    expect(c.state().running).toBe(false)
    expect(c.state().ok).toBe(false)
    const r = c.eventsSince(0)
    expect(r.events).toEqual([])
    expect(r.nextSeq).toBe(0)
  })

  it('exposes ring events through eventsSince without needing a live link', () => {
    const c = new GatewaySseClient({ resolveBase: () => null })
    const seq = c.buffer.push('agents', { id: 'x' })
    const r = c.eventsSince(seq - 1)
    expect(r.events).toHaveLength(1)
    expect(r.events[0]!.channel).toBe('agents')
    expect(r.nextSeq).toBe(1)
  })
})
