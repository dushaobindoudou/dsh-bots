/**
 * Field-projection tests for the host→client wire.
 *
 * Both functions under test are the seams where UI capability is decided:
 * whatever `trimAgent` drops, the sidebar cannot draw; whatever `trimEntry`
 * mislabels, the thread renders blank. Both had exactly that failure before.
 */
import { describe, expect, it } from 'vitest'
import { normalizeAgents, trimAgent, trimEntry } from '../src/gateway.js'
import { AVATAR_DATA_URL_MAX } from '../src/shared.js'

/** One agent as the sdk-bots gateway actually returns it (trimmed sample). */
const wireAgent = {
  id: 'ef501b51', name: '速报员', description: '获取最新信息', title: '',
  isGroup: false, memberIds: [], isActive: true, isRunning: false,
  isComposingMessage: true,
  hasUnread: true, unreadCount: 5, lastViewedAt: 1787904017446,
  isHiddenFromSidebar: false, awaitingUserResponse: null,
  lastActivityAt: 1787904514609, updatedAt: 1787904514609,
  lastMessagePreview: '最终确认',
  avatarDataUrl: null, avatarShape: null, avatarColor: null,
}

describe('trimAgent', () => {
  it('carries the fields the native-parity sidebar needs', () => {
    const a = trimAgent(wireAgent)!
    expect(a.isComposingMessage).toBe(true)
    expect(a.hasUnread).toBe(true)
    expect(a.unreadCount).toBe(5)
    expect(a.isHiddenFromSidebar).toBe(false)
    expect(a.lastActivityAt).toBe(1787904514609)
    expect(a.lastMessagePreview).toBe('最终确认')
  })

  it('defaults every flag rather than emitting undefined', () => {
    const a = trimAgent({ id: 'x' })!
    expect(a.isComposingMessage).toBe(false)
    expect(a.unreadCount).toBe(0)
    expect(a.isHiddenFromSidebar).toBe(false)
    expect(a.awaitingUserResponse).toBeNull()
    expect(a.lastActivityAt).toBeNull()
    expect(a.hasAvatar).toBe(false)
  })

  it('inlines a small avatar and drops an oversized one whole', () => {
    const small = 'data:image/png;base64,' + 'a'.repeat(100)
    expect(trimAgent({ id: 'x', avatarDataUrl: small })!.avatarDataUrl).toBe(small)

    const huge = 'data:image/png;base64,' + 'a'.repeat(AVATAR_DATA_URL_MAX + 1)
    const trimmed = trimAgent({ id: 'x', avatarDataUrl: huge })!
    // Never a truncated data URL — that renders as a broken image.
    expect(trimmed.avatarDataUrl).toBeNull()
    expect(trimmed.hasAvatar).toBe(true)
  })

  it('keeps hidden agents in the payload so the client can decide', () => {
    const list = normalizeAgents([{ id: 'a' }, { id: 'b', isHiddenFromSidebar: true }])
    expect(list).toHaveLength(2)
    expect(list[1].isHiddenFromSidebar).toBe(true)
  })
})

describe('trimEntry', () => {
  it('reads a bot reply out of send-message, not entry.content', () => {
    // The regression that made every bot reply render blank: the text of a
    // `send-message` entry lives under `message.content`.
    const en = trimEntry({
      kind: 'send-message', id: 't4s0',
      message: { type: 'text', content: '最终确认' },
      timestampMs: 1787904514609,
    })
    expect(en.display).toBe('assistant')
    expect(en.content).toBe('最终确认')
  })

  it('maps a user message onto the user display', () => {
    const en = trimEntry({ kind: 'message', id: 't2u', role: 'user', content: '你好', isStreaming: false })
    expect(en.display).toBe('user')
    expect(en.content).toBe('你好')
    expect(en.isStreaming).toBe(false)
  })

  it('treats a role-less message as assistant output', () => {
    expect(trimEntry({ kind: 'message', content: 'hi' }).display).toBe('assistant')
  })

  it('classifies tool traffic and its status', () => {
    const call = trimEntry({ kind: 'tool-call', id: '1', toolName: 'Shell' })
    expect(call.display).toBe('tool')
    expect(call.toolName).toBe('Shell')
    expect(call.toolStatus).toBe('running')

    const ok = trimEntry({ kind: 'tool-result', id: '2', name: 'Read', content: 'file body' })
    expect(ok.toolStatus).toBe('ok')
    expect(ok.content).toBe('file body')

    const bad = trimEntry({ kind: 'tool-result', id: '3', name: 'Read', isError: true })
    expect(bad.toolStatus).toBe('error')
  })

  it('groups reasoning kinds under thinking', () => {
    expect(trimEntry({ kind: 'thinking', content: '…' }).display).toBe('thinking')
    expect(trimEntry({ kind: 'reasoning', content: '…' }).display).toBe('thinking')
    expect(trimEntry({ kind: 'redacted-reasoning' }).display).toBe('thinking')
  })

  it('falls back to event for kinds it does not know', () => {
    const en = trimEntry({ kind: 'agent-removed', id: 'z' })
    expect(en.display).toBe('event')
    expect(en.toolName).toBeNull()
    expect(en.toolStatus).toBeNull()
  })

  it('marks a streaming tail', () => {
    expect(trimEntry({ kind: 'message', role: 'assistant', content: 'par', isStreaming: true }).isStreaming).toBe(true)
  })
})
