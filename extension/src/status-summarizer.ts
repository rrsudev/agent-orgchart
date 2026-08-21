/**
 * Live agent status summarizer.
 *
 * Turns the stream of AgentEvents into a short, human-readable activity clause
 * per agent ("debugging server-side auth errors") that the webview renders as a
 * dim status line under the node name ("guava is …"). The call-sign prefix is NOT
 * added here — only the web side knows the assigned call-sign — so this module
 * emits the bare clause via `agent_status` events.
 *
 * Two generation paths, interchangeable behind the same shape:
 *   1. A mini LLM via OpenRouter (when enabled + an API key is present).
 *   2. A deterministic fallback derived from tool activity (always available).
 *
 * PRIVACY: by default the payload sent to OpenRouter is METADATA-ONLY — tool
 * names, already-truncated arg summaries, file basenames, and TodoWrite active
 * steps. Raw thinking/assistant text and file contents are never sent unless
 * `sendRawText` is explicitly enabled. This egress must be disclosed at study
 * enrollment. See the plan / study consent for details.
 */

import type { AgentEvent } from './protocol'

/** Default OpenRouter chat-completions endpoint. Overridable for tests. */
export const DEFAULT_STATUS_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
/** Default model — a mini model tuned for ultra-low latency + cost. The status
 *  task (turn a few tool names into a 6-word clause) needs no heavy reasoning, so
 *  a flash-lite tier is the sweet spot; override via the `model` setting. */
export const DEFAULT_STATUS_MODEL = 'google/gemini-2.5-flash-lite'
/** Default minimum interval between model calls per agent. */
export const DEFAULT_STATUS_THROTTLE_MS = 5000
/** Default per-call network timeout. A slow/unreachable router aborts after this
 *  so the deterministic fallback shows promptly instead of hanging. */
export const DEFAULT_STATUS_TIMEOUT_MS = 4000
/** How many recent actions we keep per agent to feed the summarizer. */
const ACTIVITY_WINDOW = 5
/** Standardized status format: a lowercase "[verb-ing] [what]" clause of at most
 *  MAX_WORDS words (rendered as "callsign is <clause>"), hard-capped in chars so a
 *  misbehaving model can never blow up the label. Keep these two in sync with the
 *  prompt in buildRequestBody(). */
const MAX_WORDS = 5
const CLAUSE_MAX = 48

export interface StatusSummarizerConfig {
  /** Master switch (config + key present). When false, the summarizer is inert. */
  enabled: boolean
  /** Runtime visibility gate driven by the webview's status toggle. When false we
   *  still buffer activity (free) but make NO model calls — so a user with the
   *  status line toggled off never spends credits. Defaults to true. */
  active?: boolean
  /** OpenRouter API key. When absent, the deterministic fallback is used. */
  apiKey?: string
  model?: string
  endpoint?: string
  throttleMs?: number
  /** Per-call network timeout (ms). Defaults to DEFAULT_STATUS_TIMEOUT_MS. */
  timeoutMs?: number
  /** Include a short thinking/assistant snippet in the model prompt. Off by
   *  default for privacy (metadata-only). */
  sendRawText?: boolean
  /** Injectable for tests. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number
}

/** One normalized action in an agent's recent-activity window. */
export interface ActivityItem {
  tool: string
  /** Already-summarized arg string from the event (safe, truncated). */
  summary: string
}

interface AgentActivity {
  task?: string
  items: ActivityItem[]
  /** Optional short text snippet (only populated when sendRawText). */
  lastText?: string
  /** Last session id seen for this agent — echoed on the emitted status event so
   *  the webview namespaces it to the right session in the parallel view. */
  sessionId?: string
  /** New activity has arrived since the last emitted status. */
  dirty: boolean
}

/**
 * Extract the agent id an event pertains to, or null if the event carries no
 * per-agent activity we care about.
 */
export function eventAgentId(event: AgentEvent): string | null {
  const p = event.payload
  switch (event.type) {
    case 'agent_spawn':
      return typeof p.name === 'string' ? p.name : null
    case 'tool_call_start':
    case 'message':
      return typeof p.agent === 'string' ? p.agent : null
    default:
      return null
  }
}

/** Present-continuous verb for a tool. Empty → the object IS the whole phrase
 *  (TodoWrite/update_plan carry their own natural-language active step). */
function verbFor(tool: string): string {
  switch (tool) {
    case 'Edit': case 'Write': case 'NotebookEdit': case 'apply_patch': return 'editing'
    case 'Read': return 'reading'
    case 'Bash': case 'exec_command': return 'running'
    case 'Grep': case 'Glob': return 'searching'
    case 'WebSearch': return 'searching'
    case 'WebFetch': return 'fetching'
    case 'Task': case 'Agent': return 'delegating'
    case 'Skill': return 'running'
    case 'AskUserQuestion': return 'asking'
    case 'TodoWrite': case 'update_plan': return ''
    default: return 'working'
  }
}

/**
 * Clean, generic object phrase for the deterministic fallback — a couple of plain
 * words, never a raw path/flag/regex/query. Specific phrasing is the model's job;
 * the fallback just needs to read as a tidy "[verb] [what]" clause.
 */
function cleanObject(tool: string, summary: string): string {
  const basename = (p: string) => (p.split('/').pop() || p).replace(/\s+—\s+(edit|write)$/i, '').trim()
  switch (tool) {
    case 'Read': case 'Edit': case 'Write': case 'NotebookEdit':
      return basename(summary.replace(/\s+—\s+(edit|write)$/i, '')) || 'a file'
    case 'apply_patch':
      return 'a file'
    case 'Bash': case 'exec_command': {
      // The command's first word or two, dropping flags and path-y args.
      const words = summary.split(/\s+/).filter(w => w && !w.startsWith('-') && !w.includes('/'))
      return words.slice(0, 2).join(' ') || 'a command'
    }
    case 'Grep': case 'Glob': return 'the code'
    case 'WebSearch': return 'the web'
    case 'WebFetch': return 'a page'
    case 'Task': case 'Agent': return 'a subagent'
    case 'Skill': return 'a skill'
    case 'AskUserQuestion': return 'a question'
    case 'TodoWrite': case 'update_plan':
      // The active-step phrase, with the "(1/4)" progress count stripped.
      return summary.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()
    default: return ''
  }
}

/**
 * Deterministic status clause from the most recent action. Always available;
 * used as the fallback when the model is disabled/unavailable, and as the seed
 * shown before the first model response arrives.
 */
export function deterministicStatus(activity: Pick<AgentActivity, 'items' | 'task'>): string | null {
  const last = activity.items[activity.items.length - 1]
  if (!last) {
    return activity.task ? 'starting up' : null
  }
  const obj = cleanObject(last.tool, last.summary)
  const verb = verbFor(last.tool)
  let phrase: string
  if (!verb) phrase = obj || 'updating plan'  // TodoWrite/update_plan: object is the phrase
  else if (!obj) phrase = verb
  else phrase = `${verb} ${obj}`
  return normalizeClause(phrase) || null
}

/**
 * Standardize any clause (model- or rule-produced) into the canonical status
 * format: a single lowercase line, "[verb-ing] [what]", at most MAX_WORDS words,
 * no subject, quotes, code punctuation, or trailing operators. This is the single
 * gate every emitted status passes through, so both paths read identically.
 */
export function normalizeClause(raw: string): string {
  let s = (raw || '').split('\n')[0].trim()
  // Strip wrapping quotes/backticks a model might add.
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim()
  // Drop an accidental subject prefix the model may add ("the agent is …", "it is
  // …", "is …"). Deliberately NOT a generic "<word> is" strip: that would mangle
  // legitimate status text whose second word is "is" (e.g. "server is unresponsive"
  // → "unresponsive"). The call-sign is added by the web layer and is unknown here,
  // so the model can't echo it anyway.
  s = s.replace(/^(?:the\s+agent|this\s+agent|the\s+assistant|agent|it)\s+is\s+/i, '').trim()
  s = s.replace(/^is\s+/i, '').trim()
  // Collapse whitespace, then cap to the word budget.
  s = s.replace(/\s+/g, ' ').split(' ').filter(Boolean).slice(0, MAX_WORDS).join(' ')
  // Trim trailing punctuation and dangling shell operators (". , ; : | & / \ -").
  s = s.replace(/[\s.,;:|&/\\-]+$/g, '').trim()
  if (s) s = s.charAt(0).toLowerCase() + s.slice(1)
  return s.slice(0, CLAUSE_MAX)
}

/** Build the OpenRouter request body for an agent's current activity. */
export function buildRequestBody(model: string, activity: AgentActivity, sendRawText: boolean): unknown {
  const lines: string[] = []
  if (activity.task) lines.push(`Task: ${activity.task}`)
  if (activity.items.length > 0) {
    lines.push('Recent actions:')
    for (const it of activity.items) {
      lines.push(`- ${it.tool}: ${it.summary}`)
    }
  }
  if (sendRawText && activity.lastText) {
    lines.push(`Latest note: ${activity.lastText}`)
  }
  const system =
    'You write a terse but SPECIFIC live status for a coding agent, from its recent ' +
    'actions. Reply with ONE lowercase present-tense clause of AT MOST 5 words, in the ' +
    'form "[verb-ing] [what]", in plain English. Name the concrete thing being worked ' +
    'on — the file (by name), feature, component, or topic — do NOT settle for a vague ' +
    'state like "thinking", "working", "processing", "running", or "done"; if the actions ' +
    'are unclear, infer the most likely specific task. No agent name, no subject, no ' +
    'quotes, no punctuation, and no long file paths, flags, regex, or code. Examples: ' +
    '"debugging server-side auth", "wiring the Stripe adapter", "writing checkout tests".'
  return {
    model,
    max_tokens: 24,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `${lines.join('\n')}\n\nStatus:` },
    ],
  }
}

/**
 * StatusSummarizer observes an AgentEvent stream and periodically emits a short
 * status clause per agent via the `onStatus` callback. Wire `observe()` into the
 * watcher event forwarder and turn each `onStatus(agentId, clause)` into an
 * `agent_status` AgentEvent sent to the panel.
 */
export class StatusSummarizer {
  private readonly cfg: Required<Omit<StatusSummarizerConfig, 'apiKey' | 'sendRawText' | 'active'>> & Pick<StatusSummarizerConfig, 'apiKey' | 'sendRawText'>
  private readonly activity = new Map<string, AgentActivity>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly lastEmit = new Map<string, number>()
  /** Agents with a model call currently awaiting a response — prevents a second
   *  concurrent (double-billed) call if one outlives the throttle window. */
  private readonly inflight = new Set<string>()
  /** Agents that have received at least one status — used to show an instant
   *  deterministic status on the FIRST update (so a slow router never leaves a
   *  node blank) without flickering basic→model on every later update. */
  private readonly emitted = new Set<string>()
  /** Last clause emitted per agent — dedupes redundant emits (e.g. fallback that
   *  equals the current status). */
  private readonly lastClause = new Map<string, string>()
  /** Visibility gate (webview status toggle). No model calls while false. */
  private active: boolean

  constructor(config: StatusSummarizerConfig, private readonly onStatus: (agentId: string, status: string, sessionId?: string) => void) {
    this.cfg = {
      enabled: config.enabled,
      apiKey: config.apiKey,
      model: config.model || DEFAULT_STATUS_MODEL,
      endpoint: config.endpoint || DEFAULT_STATUS_ENDPOINT,
      throttleMs: config.throttleMs ?? DEFAULT_STATUS_THROTTLE_MS,
      timeoutMs: config.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS,
      sendRawText: config.sendRawText ?? false,
      fetch: config.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
      now: config.now ?? (() => Date.now()),
    }
    this.active = config.active ?? true
  }

  /**
   * Toggle the visibility gate (driven by the webview's status toggle). When the
   * user has the status line OFF, we keep buffering activity (free) but make ZERO
   * model calls — so no credits are spent on statuses nobody is looking at.
   * Turning it back ON schedules a refresh for any agent with pending activity.
   */
  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    if (!active) {
      // Cancel any pending model calls immediately.
      for (const t of this.timers.values()) clearTimeout(t)
      this.timers.clear()
      return
    }
    // Re-enabled: flush agents that accumulated activity while hidden.
    for (const [id, a] of this.activity) if (a.dirty) this.schedule(id)
  }

  /** Feed one event. Cheap and synchronous; scheduling/model calls are deferred. */
  observe(event: AgentEvent): void {
    if (!this.cfg.enabled) return

    // Terminal events clear per-agent state so completed agents stop updating.
    if (event.type === 'agent_complete') {
      const name = typeof event.payload.name === 'string' ? event.payload.name : null
      if (name) this.clearAgent(name)
      return
    }

    const agentId = eventAgentId(event)
    if (!agentId) return

    const a = this.activity.get(agentId) ?? { items: [], dirty: false }
    if (event.sessionId) a.sessionId = event.sessionId
    let changed = false

    if (event.type === 'agent_spawn') {
      const task = typeof event.payload.task === 'string' ? event.payload.task : undefined
      if (task && task !== a.task) { a.task = task; changed = true }
    } else if (event.type === 'tool_call_start') {
      const tool = typeof event.payload.tool === 'string' ? event.payload.tool : ''
      const summary = typeof event.payload.args === 'string' ? event.payload.args : ''
      if (tool) {
        a.items.push({ tool, summary })
        if (a.items.length > ACTIVITY_WINDOW) a.items.shift()
        changed = true
      }
    } else if (event.type === 'message' && this.cfg.sendRawText) {
      const role = event.payload.role
      const content = typeof event.payload.content === 'string' ? event.payload.content : ''
      if ((role === 'assistant' || role === 'thinking') && content) {
        a.lastText = content.slice(0, 200)
        changed = true
      }
    }

    if (!changed) { this.activity.set(agentId, a); return }
    a.dirty = true
    this.activity.set(agentId, a)
    // Buffering above is free; only schedule an actual model call when the status
    // line is visible. While the toggle is off we accumulate but never call out.
    if (this.active) this.schedule(agentId)
  }

  /** Schedule a throttled generate for an agent if one isn't already pending. */
  private schedule(agentId: string): void {
    if (this.timers.has(agentId)) return
    const elapsed = this.cfg.now() - (this.lastEmit.get(agentId) ?? 0)
    const delay = Math.max(0, this.cfg.throttleMs - elapsed)
    const t = setTimeout(() => {
      this.timers.delete(agentId)
      void this.generateAndEmit(agentId)
    }, delay)
    // Don't keep the process alive just for a status refresh.
    if (typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref()
    this.timers.set(agentId, t)
  }

  /** Run generation for one agent and emit the result. Safe to call directly (tests). */
  async generateAndEmit(agentId: string): Promise<void> {
    if (!this.active || this.inflight.has(agentId)) return
    const a = this.activity.get(agentId)
    if (!a || !a.dirty) return
    a.dirty = false
    this.lastEmit.set(agentId, this.cfg.now())

    // Emit a clause only if still relevant, and skip no-op repeats.
    const emit = (clause: string): void => {
      if (!clause || !this.active || !this.activity.has(agentId)) return
      if (this.lastClause.get(agentId) === clause) { this.emitted.add(agentId); return }
      this.lastClause.set(agentId, clause)
      this.emitted.add(agentId)
      this.onStatus(agentId, clause, a.sessionId)
    }

    const basic = deterministicStatus(a) ?? ''

    // No key → deterministic is the whole story.
    if (!this.cfg.apiKey) { emit(basic); return }

    // First status for this agent: show the basic one immediately so a slow or
    // unreachable router never leaves the node blank while the first call is in
    // flight. On later updates we wait for the model and only fall back on failure,
    // so a reachable router doesn't flicker basic→model every cycle.
    if (!this.emitted.has(agentId)) emit(basic)

    this.inflight.add(agentId)
    let modelClause: string | null = null
    try {
      modelClause = await this.callModel(a)
    } finally {
      this.inflight.delete(agentId)
    }
    if (!this.active || !this.activity.has(agentId)) return
    // Model responded → use it; router unreachable/failed → fall back to basic.
    emit(modelClause || basic)
  }

  /** Call OpenRouter. Returns a normalized clause, or null on any failure. */
  private async callModel(activity: AgentActivity): Promise<string | null> {
    const body = buildRequestBody(this.cfg.model, activity, this.cfg.sendRawText ?? false)
    // Abort a slow/unreachable router so the deterministic fallback isn't blocked.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs)
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
    let resp: Response
    try {
      resp = await this.cfg.fetch(this.cfg.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.cfg.apiKey}`,
          'X-Title': 'Agent Fruitstand',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
    if (!resp.ok) return null
    let json: { choices?: Array<{ message?: { content?: string } }> }
    try { json = await resp.json() as typeof json } catch { return null }
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string') return null
    const clause = normalizeClause(content)
    return clause || null
  }

  private clearAgent(agentId: string): void {
    this.activity.delete(agentId)
    const t = this.timers.get(agentId)
    if (t) { clearTimeout(t); this.timers.delete(agentId) }
    this.lastEmit.delete(agentId)
    this.inflight.delete(agentId)
    this.emitted.delete(agentId)
    this.lastClause.delete(agentId)
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.activity.clear()
    this.lastEmit.clear()
    this.inflight.clear()
    this.emitted.clear()
    this.lastClause.clear()
  }
}
