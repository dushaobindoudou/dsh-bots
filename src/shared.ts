/**
 * Wire types shared by the host half (gateway bridge) and the client half
 * (web UI). Keep everything JSON-serializable: these shapes cross the
 * connection RPC boundary verbatim.
 * @module dsh-plugin-bots/shared
 */

/**
 * Trimmed agent projection the UI renders.
 *
 * The projection is deliberately WIDER than the rows it draws: the sidebar
 * needs unread counts, the hidden-from-sidebar flag, and the authoritative
 * composing state (never a client-side guess) to reach native parity. Only
 * genuinely unbounded fields are held back — `avatarDataUrl` is capped by
 * {@link AVATAR_DATA_URL_MAX} so a list poll can never carry megabytes.
 */
export interface AgentInfo {
  id: string
  name: string
  description: string
  title: string
  isGroup: boolean
  memberIds: string[]
  isRunning: boolean
  isActive: boolean
  lastMessagePreview: string | null
  updatedAt: string | null
  /** Authoritative "assistant is producing a reply" flag from the gateway. */
  isComposingMessage: boolean
  hasUnread: boolean
  unreadCount: number
  /** User hid this agent from the sidebar; the nav must not list it. */
  isHiddenFromSidebar: boolean
  /** Non-null when the agent is blocked waiting on the user. */
  awaitingUserResponse: string | null
  lastActivityAt: number | null
  /** Inline avatar image, or null when absent/oversized (see hasAvatar). */
  avatarDataUrl: string | null
  avatarShape: string | null
  avatarColor: string | null
  /** True when the agent has an avatar, even if it was too large to inline. */
  hasAvatar: boolean
}

/** Largest avatar data URL inlined into a list response (bytes). */
export const AVATAR_DATA_URL_MAX = 64 * 1024

/** Workspace row (from the host workspaceRegistry). */
export interface WorkspaceInfo {
  id: string
  title: string
  path: string | null
}

/** Recent dsh session row (from the host sessionQuery + title snapshots). */
export interface SessionInfo {
  id: string
  title: string
  live: boolean
}

/** Gateway health/discovery result. */
export interface GatewayInfo {
  ok: boolean
  baseUrl?: string
  port?: number
  pid?: number | null
  hasToken?: boolean
  reason?: string
  /** Effective sdk-bots data directory (from plugin config, not a constant). */
  dataDir?: string
  health?: {
    pid: number | null
    isBusy: boolean
    activeAgentId: string | null
    startedAt: string | null
  }
}

/**
 * One transcript entry, normalized to a small display union.
 *
 * sdk-bots emits many wire kinds (`message`, `send-message`, `tool-call`,
 * `tool-result`, `thinking`, …). The host collapses them into `display`, so
 * the client renders on a closed set instead of sniffing raw shapes — the
 * previous UI read `entry.content` unconditionally and drew blanks for every
 * kind that keeps its text somewhere else.
 */
export type TranscriptDisplay = 'user' | 'assistant' | 'tool' | 'thinking' | 'event'

export interface TranscriptEntry {
  id: string
  /** Raw sdk-bots wire kind, kept for diagnostics and future kinds. */
  kind: string
  /** Closed display union the renderer switches on. */
  display: TranscriptDisplay
  timestampMs: number | null
  role: string | null
  content: string
  authorId: string | null
  authorName: string | null
  /** Streaming tail: the renderer shows a caret and suppresses the timestamp. */
  isStreaming: boolean
  /** Tool name for `display: 'tool'` entries. */
  toolName: string | null
  /** `running` | `ok` | `error` for `display: 'tool'` entries. */
  toolStatus: 'running' | 'ok' | 'error' | null
}

/**
 * Every prop the dsh shell's renderer puts on a slot component before the
 * entry's own `inject` result, and how our `sidebar.workspaces` shadow
 * reproduces it when it re-renders the shipped entry underneath.
 *
 * Taking over a `single` slot means taking over this assembly. The list is the
 * contract: `tests/delegation.spec.ts` reads the installed renderer and fails
 * if it grows a key that is not accounted for here, so a dsh upgrade surfaces
 * as a red test rather than as another silently blank region.
 */
export const DELEGATED_KIT_KEYS: Record<string, 'synthesized' | 'session-only' | 'guarded'> = {
  /** Root-scope standard props — bound from the host face. */
  useSessions: 'synthesized',
  useWorkspaces: 'synthesized',
  /** Locale seat, when the registration declares a namespace. */
  t: 'synthesized',
  /** Store pair, when the registration declares a store. */
  useStore: 'synthesized',
  actions: 'synthesized',
  /** Child-slot renderer — the one that used to be stubbed to null. */
  renderSlot: 'synthesized',
  /** Needs renderer-internal chain composition; we warn instead of faking it. */
  renderSlotChain: 'guarded',
  /** Needs the renderer's session seat; we warn instead of faking it. */
  SessionProvider: 'guarded',
  /** Only assembled for session-scoped slots; `sidebar.workspaces` is root. */
  sessionId: 'session-only',
  useProjection: 'session-only',
}

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** sdk-bots data directory holding gateway.json. */
  dataDir: string
}

/** `bots/<method>` RPC request/response envelope used by the web client. */
export type RpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

/** One normalized SSE channel event with a local monotonic seq. */
export interface SseEvent {
  seq: number
  channel: string
  data: unknown
}

/** Snapshot of the host SSE ring lifecycle for the UI status line. */
export interface SseState {
  running: boolean
  ok: boolean
  lastError: string | null
  connectedAt: string | null
  droppedAt: string | null
  buffered: number
  total: number
}

/** Reply to `bots.eventsSince(seq)`: replay from the ring plus live status. */
export interface EventsSinceResult {
  events: SseEvent[]
  /** Next seq the caller should request next poll. */
  nextSeq: number
  state: SseState
  /**
   * Unread counts per agent id, computed on the host from the same ring
   * (plugin-owned model — the gateway's own unreadCount is desktop-app
   * semantics and never accumulates headless). Only non-zero entries appear.
   */
  unread?: Record<string, number>
}
