# Claude Hooks → Interface Display Pipeline

How Agent Flow turns raw Claude Code activity into the live node-graph you see in
the visualizer. This document traces the full path — from the hooks Claude Code
fires, through ingestion, normalization, transport, and finally the React/canvas
render loop.

> Scope: this is the **Claude Code** path. Codex has a parallel runtime
> (`codex-*.ts`) that produces the same normalized `AgentEvent` stream from
> `~/.codex/sessions/**/rollout-*.jsonl`; it converges at the same display layer
> but is not covered here.

---

## 0. The pipeline at a glance

```
Claude Code
   │  (fires hook events + writes JSONL transcripts)
   │
   ├──► SOURCE A: Hooks ─────────────────────────────────────────┐
   │      settings.json command hook                             │
   │        → ~/.claude/agent-flow/hook.js  (forwarder, stdin)   │
   │        → HTTP POST 127.0.0.1:<random port>                  │
   │        → HookServer          (hook_event_name → AgentEvent) │
   │                                                             │
   └──► SOURCE B: Transcript files ──────────────────────────────┤
          ~/.claude/projects/<enc>/<session>.jsonl               │
            + <session>/subagents/*.jsonl                        │
          → SessionWatcher (tail) → TranscriptParser             │
            (JSONL blocks → AgentEvent)                          │
                                                                 ▼
                                              claude-runtime.ts (MERGE + de-dup)
                                                                 │
                                          normalized AgentEvent stream
                                                                 │
                          ┌──────────────────────┴───────────────────────┐
                          │ TRANSPORT (one of two)                        │
                          │  • VS Code webview:  panel.postMessage(...)   │
                          │  • Standalone/app:   SSE  /events  (relay)    │
                          └──────────────────────┬───────────────────────┘
                                                 │
                        window "message" ──► VSCodeBridge (browser singleton)
                                                 │
                                   useVSCodeBridge (buffer + per-session routing)
                                                 │
                                   useAgentSimulation (rAF consume queue)
                                                 │
                                   processEvent → per-type handlers
                                        (mutate agents / toolCalls / edges /
                                         particles / timeline / conversations)
                                                 │
                          d3-force layout + animate() per-frame visuals
                                                 │
                                   Canvas draw loop (reads frameRef @ 60fps)
                                        + React panels (throttled state @ ~4/s)
```

Two facts shape the whole design:

1. **There are two independent event sources** (live hooks and transcript
   tailing) that both emit the *same* `AgentEvent` type. They run
   simultaneously, and a merge layer de-duplicates them.
2. **Everything converges on one normalized envelope**, `AgentEvent`, defined in
   `extension/src/protocol.ts`. Nothing downstream of the merge layer knows or
   cares whether an event came from a hook or a transcript line.

---

## 1. Source A — Claude Code hooks

### 1.1 What gets configured, and where

Agent Flow registers **nine** Claude Code hook events. This happens in two
equivalent places:

- **VS Code extension:** `configureClaudeHooks()` in
  `extension/src/hooks-config.ts:75` writes to the global
  `~/.claude/settings.json`.
- **Standalone / `npx agent-flow-app`:** `configureHooks()` in
  `scripts/setup.js:161` does the identical thing (run automatically via
  `ensureSetup()` on every app launch, and via `pnpm run setup`).

The registered events (`hooks-config.ts:81`, `setup.js:166`):

```
SessionStart  PreToolUse  PostToolUse  PostToolUseFailure
SubagentStart SubagentStop Notification Stop  SessionEnd
```

> Note: `UserPromptSubmit` is **not** registered. User prompts reach the display
> only via the transcript parser (Source B), which reads user messages out of the
> JSONL.

Each event is a **command hook** (not an HTTP-url hook), of the shape
(`hooks-config.ts:79`):

```json
{ "hooks": [{ "type": "command",
              "command": "\"/abs/path/node\" \"/Users/you/.claude/agent-flow/hook.js\"",
              "timeout": 2 }] }
```

The merge into `settings.json` is idempotent: existing Agent Flow entries
(detected by the `agent-flow/hook.js` marker or a legacy `http://127.0.0.1:` url)
are filtered out and re-appended, so foreign hooks are preserved
(`hooks-config.ts:97-105`). A legacy migration (`migrateHttpHooks`,
`hooks-config.ts:123`) rewrites older direct-HTTP hooks into command hooks.

### 1.2 The forwarder script (`~/.claude/agent-flow/hook.js`)

A command hook can't POST to an HTTP server directly, and hard-coding a port in
`settings.json` would be racy across multiple VS Code windows. So Agent Flow
installs a tiny Node forwarder script and uses a **discovery-file** mechanism.
The script is generated in `discovery.ts:144` (`getHookScriptContent`) / mirrored
in `setup.js:44`, written atomically (temp + rename, mode `0o755`).

When Claude Code fires a hook, it pipes the hook JSON to the script's **stdin**.
The script (`discovery.ts:156-247`):

1. Parses `.cwd` from the payload.
2. Reads discovery files in `~/.claude/agent-flow/*.json` (excluding
   `workspaces.json`). Each is `{ port, pid, workspace }`, written by a live
   Agent Flow instance.
3. Removes dead instances (`process.kill(pid, 0)` check; skipped on Windows).
4. Finds workspaces that **contain** the `cwd` (equal or a parent dir), and
   picks the **longest match** (most specific), so `/project/sub` beats
   `/project`.
5. HTTP POSTs the raw stdin payload, unchanged, to `127.0.0.1:<port>` for every
   matching live instance.

It has a **hard self-kill timer** at `HOOK_TIMEOUT_S*1000 - HOOK_SAFETY_MARGIN_MS`
= `2000 - 500` = **1500ms** (`discovery.ts:165`), guaranteeing it exits well
before Claude Code's 2s kill deadline so it can never block the agent — even on a
stdin stall or HTTP hang.

**Discovery files** are written by the live process: `writeDiscoveryFile()` in
`discovery.ts:72` (extension) / `relay.ts:338` (app), named
`{sha256(workspace)[:16]}-{pid}.json`. This is the linchpin connecting the
forwarder's POST target to the process actually listening.

### 1.3 The HookServer — hooks become `AgentEvent`s

`extension/src/hook-server.ts` is the HTTP receiver. `start()` (`:66`) binds a
plain `http.Server` to `127.0.0.1` on **port 0** (OS-assigned random port); the
chosen port is read back and published in the discovery file. If the port is in
use by another instance it returns `HOOK_SERVER_NOT_STARTED (-1)` and skips — the
transcript watcher covers that session instead (`:108-119`).

It accepts any POST (URL path ignored), caps the body at 1 MB, validates that
`session_id` and `hook_event_name` are present, and **always replies `200` with an
empty body** — it observes, never blocks (`:96-101`). The raw hook contract it
consumes is the `HookPayload` interface (`:27-47`).

`handleHook` (`:148`) switches on `hook_event_name` and maps each to an
`AgentEvent`:

| Raw hook | → AgentEvent(s) | Notes |
|---|---|---|
| `SessionStart` | `agent_spawn` `{name: orchestrator, isMain, task}` | `:183` |
| `PreToolUse` | `tool_call_start` `{agent, tool, args, preview}` | auto-spawns session if unseen (`:203`) |
| `PostToolUse` | `tool_call_end` `{agent, tool, result, tokenCost, discovery?}` | `:219` |
| `PostToolUseFailure` | `tool_call_end` `{result: "[FAILED] …", tokenCost: 0}` | `:241` |
| `SubagentStart` | **no event** — only records `agent_id → name` | avoids duplicate node; parser owns the friendly name (`:257`) |
| `SubagentStop` | `subagent_return` + `agent_complete` | `:272` |
| `Notification` | `permission_requested` | only if `notification_type === 'permission_prompt'` (`:291`) |
| `Stop` | `agent_complete` `{name: orchestrator}` | `:305` |
| `SessionEnd` | `agent_complete` `{sessionEnd: true}` + clears session state | `:313` |

Per-session state (`startTime`, an `agent_id → friendly-name` map) lives in a
`Map` cleaned up on `SessionEnd`. `time` on each event is elapsed seconds since
that session's start. Agent-name resolution: an event with a known `agent_id`
maps to its subagent name (`${agentType}-${agentId.slice(-6)}`), otherwise
`orchestrator` (`:326`).

Events are fired through a `vscode.EventEmitter` exposed as `onEvent`.

---

## 2. Source B — transcript file tailing

Claude Code writes a JSONL transcript per session at
`~/.claude/projects/<encoded-workspace>/<sessionId>.jsonl` (the workspace path is
encoded by replacing every non-alphanumeric char with `-`), plus subagent
sub-files under `<sessionId>/subagents/*.jsonl`. Agent Flow tails these as a
second, richer source (and the sole source when the hook port is already owned).

### 2.1 SessionWatcher — discovery and tailing

`extension/src/session-watcher.ts`:

- **Discovery** (`scanForActiveSessions`): scans the workspace's project dir plus
  any subdirectory projects (verified by reading the `cwd` out of the first ~8KB
  of a JSONL, since the encoded dir name is lossy). A session is "active" if the
  newest mtime across its main JSONL and its `subagents/` files is within
  `ACTIVE_SESSION_AGE_S` (10 min). New files are caught instantly by `fs.watch`
  directory watchers, with a 1s scan interval as a fallback.
- **Watching one session** (`watchSession`): builds a `WatchedSession` state bag,
  **prescans** existing content to seed dedup sets *without re-emitting* old
  events, then starts tailing from EOF. It emits the orchestrator `agent_spawn`,
  an initial `context_update`, and "catch-up" messages from the **last user turn
  onward** (so you see the current turn, not full history). Tailing uses
  `fs.watch` plus a 3s poll fallback (macOS `fs.watch` can silently stop firing).
- **Inactivity → completion**: every activity bumps `lastActivityTime`; after
  `INACTIVITY_TIMEOUT_MS` (5 min) of silence it emits orchestrator
  `agent_complete` + an `ended` lifecycle. New content on a completed session
  re-emits `agent_spawn` + a `started` lifecycle (session resume).
- **Replay** (`replaySessionStart`): re-emits current state (orchestrator spawn,
  each spawned subagent's dispatch+spawn, `model_detected`s) so a freshly-attached
  webview is brought up to date.

### 2.2 TranscriptParser — JSONL blocks → `AgentEvent`s

`extension/src/transcript-parser.ts` `processTranscriptLine` is the core:

- `type: 'progress'` → inline subagent progress (see below).
- `user` / `assistant` entries are processed; others skipped.
- **Model detection**: when an assistant message's `model` changes, emit
  `model_detected`.
- **String content** (user text) → `message` `{role: 'user'}`, after filtering
  system-injected content (prefixes like `<system-reminder`, `<command-name`,
  `This session is being continued`, … in `SYSTEM_CONTENT_PREFIXES`).
- **Array content** iterates blocks:
  - `tool_use` → dedup by id → `handleToolUse`: records a `PendingToolCall`, and
    if the tool is `Task`/`Agent`, resolves the child name and emits a subagent
    spawn; then emits `tool_call_start` (with `args`, `preview`, structured
    `inputData`).
  - `tool_result` → `handleToolResult`: matches the pending call by
    `tool_use_id`, estimates `tokenCost`, emits `tool_call_end`
    (`+ discovery/isError/errorMessage`), and for subagent completions emits
    `subagent_return` + `agent_complete`.
  - `text` → `message` `{role: 'assistant'}`.
  - `thinking` → `message` `{role: 'thinking'}` (redacted thinking shows a
    "Thinking..." placeholder).
- After each line, emits a `context_update` (the 5-bucket breakdown).

### 2.3 Subagent detection

Subagents are detected **three ways**, coordinated to avoid duplicate nodes:

1. **`Task`/`Agent` tool_use** in the transcript → `emitSubagentSpawn` (the
   canonical paired `subagent_dispatch` + `agent_spawn`, `protocol.ts:125`).
2. **Inline progress** (`handleProgressEvent`): newer Claude Code embeds subagent
   transcript entries in the main JSONL as `type: 'progress'` /
   `agent_progress`, keyed by `parentToolUseID`. The parser re-wraps the inner
   entry and recursively feeds it back through `processTranscriptLine`, and marks
   the agent in `session.inlineProgressAgents` so the file watcher skips it.
3. **Separate subagent JSONL files** under `<sessionId>/subagents/*.jsonl`
   (`subagent-watcher.ts`): the friendly name comes from a `.meta.json` sidecar;
   spawn is emitted only if there's pending (unmatched) tool work and the name
   isn't already in `session.spawnedSubagents`.

The `spawnedSubagents` and `inlineProgressAgents` sets are the coordination
mechanism that prevents the three producers from double-spawning a subagent.

### 2.4 Supporting modules

- `permission-detection.ts` — heuristic fallback when hooks don't deliver a
  `Notification`: if a non-`Agent`/`Task` tool call stays pending ~5s with no
  recent file activity, emit `permission_requested`; clear with `agent_idle`.
- `tool-summarizer.ts` — per-tool short strings (`summarizeInput`), result
  normalization (`summarizeResult`), structured display data (`extractInputData`
  → `inputData`), file discovery objects (`buildDiscovery`), and an error
  heuristic (`detectError` → `isError`).
- `token-estimator.ts` — ~4 chars/token estimates feeding the 5-bucket
  `contextBreakdown` (`systemPrompt`, `userMessages`, `toolResults`, `reasoning`,
  `subagentResults`).
- `event-source.ts` (`JsonlEventSource`) — a **separate** replay/testing source
  that reads a JSONL where each line is *already* an `AgentEvent`. It does no
  hook/transcript translation.

---

## 3. The merge layer — `claude-runtime.ts`

`startClaudeRuntime()` starts both the HookServer and the SessionWatcher, then
routes their outputs to the panel — de-duplicating because the two sources name
subagents differently (hooks: `agent_type-id`; transcripts: `description`), so
letting both emit would create divergently-named duplicate nodes.

The hook → panel routing (`claude-runtime.ts:88-119`), for each hook event, asks
"does the watcher already own this session?" (`watcher.isSessionActive`):

- **Watcher owns it + orchestrator event** → apply `filterOrchestratorCompletion`,
  forward.
- **Watcher owns it + a subagent-lifecycle event** (`agent_spawn`,
  `subagent_dispatch`, `subagent_return`, `agent_complete`) → **drop** — the
  transcript parser owns these with correct names.
- **Otherwise** → pass through.

`filterOrchestratorCompletion` (`:43`) converts an orchestrator `agent_complete`
into `agent_idle` **unless** `payload.sessionEnd` is set — this prevents a
premature "completed" state during long API calls / extended thinking. It's also
applied to *all* watcher events via `wireWatcherToPanel(..., {transformEvent})`.

`wireWatcherToPanel` (`session-runtime.ts:67`) is the shared boilerplate: forward
`onEvent` to the panel, reflect `onSessionDetected` in the status bar, and
translate lifecycle events (`started`/`updated`/`ended`) into the corresponding
webview messages.

---

## 4. The normalized event model — `protocol.ts`

Everything past the merge is this one envelope (`protocol.ts:24`):

```ts
interface AgentEvent {
  time: number                      // elapsed seconds since session start
  type: AgentEventType
  payload: Record<string, unknown>
  sessionId?: string                // attached by the emitter
}
```

The 12 event types and their key payloads:

| Type | Payload | Meaning |
|---|---|---|
| `agent_spawn` | `{name, isMain?, parent?, task, model?}` | a node appears |
| `agent_complete` | `{name, sessionEnd?}` | node + its children finish |
| `agent_idle` | `{name}` | tool/permission cleared → back to thinking |
| `message` | `{agent, role: user\|assistant\|thinking, content}` | a message bubble / transcript line |
| `context_update` | `{agent, tokens, breakdown{…5 buckets}}` | token gauge update |
| `model_detected` | `{agent, model}` | model id (sets context-window size) |
| `tool_call_start` | `{agent, tool, args, preview, inputData?}` | tool card appears |
| `tool_call_end` | `{agent, tool, result, tokenCost, discovery?, isError?, errorMessage?}` | tool card resolves |
| `subagent_dispatch` | `{parent, child, task}` | parent→child particle |
| `subagent_return` | `{child, parent, summary}` | child→parent particle |
| `permission_requested` | `{agent, message, title?}` | node enters "waiting permission" |
| `error` | — | declared but not currently emitted |

Also defined here: `SessionInfo`, the Extension↔Webview message unions,
`VisualizerConfig`, the transcript block types, and the internal state bags
(`WatchedSession`, `SubagentState`, `PendingToolCall`).

---

## 5. Transport — extension/server → browser

Two transports, chosen by how the app is hosted. **Both converge on the same
`window` `message` handler in the browser**, which is the key unifying trick.

### 5.1 VS Code webview → `postMessage`

The extension host owns the stream and pushes each event to the webview:

```ts
// webview-provider.ts:118
sendEvent(event) { this.postMessage({ type: 'agent-event', event }) }
```

- **Production build:** the bundled `dist/webview/index.js` runs in the webview;
  `webview-entry.tsx` calls `vscodeBridge.configureWebviewApi(...)` so the bridge
  talks to the extension via the real VS Code API.
- **Dev mode:** the Next.js dev server loads in an `<iframe>`; an inner relay
  script bridges both directions with `postMessage`, buffering until the iframe
  posts `{type:'ready'}`. Handshake is `{type: '__vscode-bridge-init'}`.

On webview `ready`, the extension posts `reset` → optional `config` →
`session-list` **before** replaying events, so the webview has a session selected
to match incoming events against.

### 5.2 Standalone / dev → SSE

When not inside VS Code, the app connects to the relay via **Server-Sent Events**
(there is no websocket anywhere):

```ts
// use-vscode-bridge.ts:80
const es = new EventSource(relayPort ? `http://127.0.0.1:${relayPort}/events` : '/events')
es.onmessage = (e) => window.postMessage(JSON.parse(e.data), '*')   // re-inject
```

The relay (`scripts/relay.ts`, wrapped by `scripts/dev-relay.ts` for dev and
`app/src/server.ts` for the `npx` app) is what actually owns the HookServer and
SessionWatcher in the standalone path. It:

- Subscribes to `hookServer.onEvent` and broadcasts `{type:'agent-event', event}`
  as `data: <json>\n\n` to all SSE clients (`relay.ts:405`, `:82`).
- Buffers up to `MAX_EVENT_BUFFER` (5000) events **per session**, and on a new SSE
  connection sends the `session-list` then replays the most-recent active
  session's buffer as an `agent-event-batch` (`relay.ts:472-515`).
- Serves the `/events` SSE endpoint on `DEFAULT_RELAY_PORT` (3001). The
  HookServer's own random port (in the discovery file) is separate — the
  forwarder never talks to 3001.

Because SSE messages are re-posted via `window.postMessage`, they land in the
exact same handler the VS Code path uses.

---

## 6. Browser ingestion — `VSCodeBridge` and `useVSCodeBridge`

`web/lib/vscode-bridge.ts` is a browser singleton with one global `message`
listener. `handleMessage` switches on `data.type` and fans out to listener
arrays: `agent-event` / `agent-event-batch` → event listeners;
`session-list/started/ended/updated`, `config`, `connection-status`, `reset` →
their respective listeners; `__vscode-bridge-init` → marks VS Code mode and
replies `ready`.

`web/hooks/use-vscode-bridge.ts` subscribes to the bridge and does the
**per-session buffering and routing** (`:114-157`):

- Converts each `AgentEvent` → `SimulationEvent`.
- Always appends to `sessionEventsRef[sessionId]` (per-session history, replayed
  on tab switch).
- If the event's session is the **selected** one (checked via
  `selectedSessionIdRef`, a synchronously-updated ref so the rAF closure never
  sees a stale filter), push to `pendingEventsRef` — the queue the simulation
  drains. Otherwise flag the session as having background activity.
- Handles session lifecycle: auto-selects the most-recently-active session, marks
  resumed/ended sessions, and exposes `flushSessionEvents` for tab switching.

---

## 7. Simulation — events mutate visual state

`web/hooks/use-agent-simulation.ts` owns the visual state. Two state channels:

- **`frameRef`** — the 60fps source of truth, written every animation frame, **no
  React render**. The canvas reads this directly.
- **React `state`** — committed only on structural change, throttled to ~4/sec
  (`UI_THROTTLE_MS`). The side panels read this.

Inside the `requestAnimationFrame` loop it snapshots and clears the pending queue
(surviving React StrictMode double-invocation), filters by session, and threads
each event through `processEvent`.

`web/hooks/simulation/process-event.ts` clones every collection from the previous
state into a mutable working set, switches on `event.type` to the matching
handler, and returns a new `SimulationState` — using `mapsEqual` to preserve
object identity for unchanged maps (avoids needless React re-render cascades).

The handlers mutate the four kinds of visual state:

- **Agents** (`handle-agent-events.ts`): `agent_spawn` creates a node positioned
  around its parent by finding the largest angular gap between siblings, with
  `opacity:0, scale:0.3` so it can fade in, a parent-child edge, a timeline entry,
  and an empty conversation; then schedules a d3-force resync. `agent_complete`
  marks the node + children complete and closes running tool calls.
  `permission_requested`/`agent_idle`/`model_detected` flip agent state/model.
- **Tool calls** (`handle-tool-events.ts`): `tool_call_start` dedups against a
  running same-agent+tool within `TOOL_DEDUP_WINDOW_S` (guards the
  hook-vs-watcher race), creates a `ToolCallNode`, a tool edge, an outward
  `tool_call` particle, a timeline block, file-attention tracking, and a
  conversation line. `tool_call_end` resolves the node (complete/error), snaps the
  outgoing particle and adds an inbound `tool_return` particle, and adds
  `tokenCost` to the agent.
- **Messages** (`handle-message-events.ts`): `message` renames the main agent to
  its first user message for readability, pushes a (deduped, capped)
  `messageBubbles` entry, and appends to `conversations`. `context_update` writes
  the token gauge + breakdown.
- **Subagents** (`handle-subagent-events.ts`): `subagent_dispatch`/`_return` push
  the parent↔child traffic particles along the existing edge. (The subagent
  *node* itself is created by `handleAgentSpawn`.)

---

## 8. Layout, animation, and render

- **d3-force layout** (`use-agent-simulation.ts`): charge/center/collide/link
  forces position agent nodes; the `tick` writes only x/y into `frameRef` (no
  render). `syncForceSimulation` rebuilds nodes/links when structure changes.
- **Per-frame visuals** (`simulation/animate.ts` `computeNextFrame`): fades/scales
  agents in, fades out completed subagents, ages tool cards and fades them out
  after their display window, advances particle progress and drops finished ones,
  prunes expired message bubbles, and garbage-collects faded nodes and orphaned
  edges. `snap-visual-state.ts` is the analytic equivalent used when seeking.
- **Canvas** (`components/agent-visualizer/canvas.tsx`): its own rAF loop reads
  `frameRef.current` each frame and draws layers in order — edges, tool-call
  cards, discoveries, agent nodes (with Claude/OpenAI brand glyph and a
  context-usage ring), message bubbles anchored to agents, then dispatch/return/
  tool traffic particles.
- **React panels** (message feed, timeline, file-attention, transcript, top bar)
  read the throttled React state instead, so heavy UI work stays off the 60fps
  path.

Net effect: **agents** and **tool calls** are persistent nodes in the
`SimulationState` maps; **messages** are ephemeral bubbles on the agent node plus
feed/transcript entries; **subagents** are agent nodes joined by parent-child
edges with animated dispatch/return traffic.

---

## 9. Design decisions worth remembering

- **Two sources, one model, explicit de-dup.** Hooks give zero-latency events but
  coarse names; transcripts give rich, correctly-named data but are file-tailed.
  `claude-runtime.ts` drops the overlapping hook events per active session.
- **Discovery files, not ports in settings.** Keeps `settings.json` stable across
  restarts and multiple windows; the forwarder finds live instances at
  invocation time and cleans up dead ones.
- **The forwarder can never block Claude Code.** Hard 1.5s self-kill vs. Claude
  Code's 2s hook timeout; the HookServer always returns an empty 200.
- **SSE re-injected as `postMessage`** unifies the standalone and VS Code
  transports at a single browser message boundary.
- **`frameRef` vs. React state** separates the 60fps canvas from throttled UI
  re-renders.
- **Orchestrator completion is downgraded to idle** unless it's a true session
  end, so long API calls don't flash "done."

---

## 10. File reference map

**Ingestion (Source A):** `scripts/setup.js`, `extension/src/hooks-config.ts`,
`extension/src/discovery.ts`, `extension/src/hook-server.ts`,
`extension/src/constants.ts`

**Ingestion (Source B):** `extension/src/session-watcher.ts`,
`extension/src/transcript-parser.ts`, `extension/src/subagent-watcher.ts`,
`extension/src/permission-detection.ts`, `extension/src/tool-summarizer.ts`,
`extension/src/token-estimator.ts`, `extension/src/event-source.ts`

**Merge + model:** `extension/src/claude-runtime.ts`,
`extension/src/session-runtime.ts`, `extension/src/protocol.ts`

**Transport:** `extension/src/webview-provider.ts`, `extension/src/extension.ts`,
`scripts/relay.ts`, `scripts/dev-relay.ts`, `app/src/server.ts`,
`app/src/static.ts`, `web/webview-entry.tsx`, `web/app-entry.tsx`

**Browser bridge:** `web/lib/vscode-bridge.ts`, `web/lib/bridge-types.ts`,
`web/hooks/use-vscode-bridge.ts`

**Simulation + render:** `web/hooks/use-agent-simulation.ts`,
`web/hooks/simulation/process-event.ts`, `web/hooks/simulation/handle-*.ts`,
`web/hooks/simulation/animate.ts`, `web/hooks/simulation/snap-visual-state.ts`,
`web/components/agent-visualizer/index.tsx`,
`web/components/agent-visualizer/canvas.tsx`,
`web/components/agent-visualizer/canvas/draw-*.ts`
