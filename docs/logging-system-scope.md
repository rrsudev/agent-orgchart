# Logging & Persistence System — Scope

> Status: scoping / design proposal. No code written yet.
> Goal: capture the **maximum amount of non‑ephemeral, per‑tab (per‑session)** data
> into a single **local `study-storage/` folder** that a research participant can
> **zip and send** to researchers. Research tool, VS Code extension, <10 users, no
> cloud. See **Part 3** for the concrete design; the companion format spec that
> ships inside the folder is [`docs/study-storage-format.md`](./study-storage-format.md).

This document has three parts, matching the ask:

1. How logging and JSONLs work today, and how they are stored.
2. A complete inventory of the information available per JSONL file and where it lives.
3. A proposed design for the local, maximum‑fidelity `study-storage` capture folder.

---

## Part 1 — How logging & JSONLs work today

### 1.1 The app does not create logs — Claude Code / Codex do

Agent Flow is a **read‑only visualizer**. It never writes transcripts. The JSONL
files are session transcripts produced by the agent runtimes themselves:

| Runtime | Location on disk | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/projects/<encoded-project>/<session-uuid>.jsonl` | Project path is encoded by replacing every non‑alphanumeric char with `-` (`/Users/x/proj` → `-Users-x-proj`). Encoding is lossy, so the app re‑reads the `cwd` field to confirm containment. |
| **Claude subagents** | `~/.claude/projects/<...>/<session-uuid>/subagents/agent-*.jsonl` + `agent-*.meta.json` sidecar | One file per subagent, plus a metadata sidecar (agent type, description, spawn depth). |
| **Claude tool results (large)** | `~/.claude/projects/<...>/<session-uuid>/tool-results/<id>.txt` | Newer Claude Code externalizes big tool outputs to plain‑text files referenced from the JSONL. |
| **Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | Honors `CODEX_HOME`. Different record schema (`session_meta`, `turn_context`, `response_item`, `event_msg`, `compacted`). |

Observed file sizes in this repo's own project dir range from **~45 KB to ~2.4 MB**
per session — transcripts are large and grow append‑only during a session.

### 1.2 Two ingestion sources, one normalized model

Agent Flow ingests activity through **two parallel sources** that both emit the
same normalized `AgentEvent` envelope, then de‑dupes them:

- **Source A — Claude Code hooks** (zero latency, coarse names): a command hook
  fires `~/.claude/agent-flow/hook.js`, which discovers the live instance via
  `~/.claude/agent-flow/<hash>-<pid>.json` port files and HTTP‑POSTs the raw hook
  JSON to the in‑process `HookServer` (`extension/src/hook-server.ts`). Nine hook
  events are registered: `SessionStart PreToolUse PostToolUse PostToolUseFailure
  SubagentStart SubagentStop Notification Stop SessionEnd`.
- **Source B — transcript tailing** (rich, correctly named, file‑lagged):
  `SessionWatcher` (`extension/src/session-watcher.ts`) scans the project dirs,
  `fs.watch`‑tails each active `.jsonl` (+ a poll fallback), and feeds new lines to
  `TranscriptParser` (`extension/src/transcript-parser.ts`).

The merge/de‑dup happens in `extension/src/claude-runtime.ts`. Full narrative:
[`docs/claude-hooks-pipeline.md`](./claude-hooks-pipeline.md).

### 1.3 Everything downstream is **ephemeral** — there is no persistence today

This is the crux for the new system. The current storage story:

- The relay (`scripts/relay.ts`) holds sessions in an in‑memory `Map` and buffers
  **at most `MAX_EVENT_BUFFER = 5000` events per session, in memory only**. On a
  new SSE client it replays that buffer. **Nothing is written to disk.**
- Transport to the browser is **SSE** (`/events`, default port 3001) or VS Code
  `postMessage`. No websocket, no API, no database.
- The only things the app *writes* anywhere are: discovery/port files
  (`~/.claude/agent-flow/*.json`), Claude `settings.json` hook config, opt‑out
  aggregate telemetry (`~/.agent-flow/telemetry/events.jsonl`), and **client tab
  renames in browser `localStorage`** (`agent-orgchart:session-labels`).

So "a better logging system" is essentially **net‑new**: today the raw JSONLs are
the only durable record, and they live only on the machine that ran the agent.

### 1.4 "Tabs" == sessions

A tab in the UI is exactly one watched session (one `.jsonl` file).

- Backend model: `WatchedSession` in a `Map<string, WatchedSession>`
  (`session-watcher.ts`, `relay.ts`), one per file, with `started/ended/updated`
  lifecycle broadcasts.
- Frontend model: `use-vscode-bridge.ts` keeps `sessions`, `selectedSessionId`,
  a per‑session event buffer (`sessionEventsRef: Map<string, SimulationEvent[]>`)
  replayed on tab switch, and background‑activity dots.
- UI: `web/components/agent-visualizer/session-tabs.tsx`.
- The public tab identity is `SessionInfo { id, label, status, startTime, lastActivityTime }`.

Per‑tab logging therefore maps cleanly onto the existing per‑session watch/buffer
infrastructure — the new system should log **keyed by `sessionId`**.

---

## Part 2 — Information available per JSONL file, and where it is stored

There are two levels of data. The **raw transcript** (source of truth, richest,
runtime‑specific) and the **normalized `AgentEvent`** (what the app derives, lossy
but runtime‑agnostic). Both are candidates for the database.

### 2.1 Raw Claude Code transcript — per‑line record

Each line is one JSON object. Entry `type`s observed and their top‑level keys:

| `type` | Meaning | Key fields |
|---|---|---|
| `assistant` | model turn | `message`, `requestId`, `effort`, `parentUuid`, `uuid`, `timestamp`, `sessionId`, `cwd`, `gitBranch`, `version`, `userType`, `isSidechain`, `entrypoint` |
| `user` | user turn / tool result | `message`, `toolUseResult`, `promptId`, `promptSource`, `origin`, `permissionMode`, `parentUuid`, `uuid`, `timestamp`, + same context fields |
| `attachment` | pasted/attached content | `attachment`, + context fields |
| `mode` / `permission-mode` | mode changes | `mode` / `permissionMode`, `sessionId` |
| `ai-title` | generated session title | `aiTitle`, `sessionId` |
| `last-prompt` | last prompt pointer | `lastPrompt`, `leafUuid`, `sessionId` |
| `file-history-snapshot` | file state snapshot | `snapshot`, `messageId`, `isSnapshotUpdate` |
| `queue-operation` | queued prompt op | `operation`, `content`, `timestamp` |

**Common context fields on message entries** (extremely useful for a DB — these
are the natural columns/filters):

- `sessionId` (+ legacy `session_id`) — the tab key
- `uuid` / `parentUuid` — turn graph (lets you reconstruct the conversation tree)
- `timestamp` — ISO wall‑clock time (the raw JSONL has real timestamps; the app's
  `AgentEvent.time` is only *elapsed seconds*, so timestamps must come from raw)
- `cwd` — working directory (identifies the project)
- `gitBranch` — git branch at the time
- `version` — Claude Code version (e.g. `2.1.217`)
- `userType`, `isSidechain`, `entrypoint`, `origin`, `permissionMode`

**`message` object (assistant)** — the richest sub‑record:

- `id`, `role`, `type`, `model` (e.g. `claude-opus-4-8`)
- `stop_reason`, `stop_sequence`, `stop_details`, `diagnostics`
- `content[]` — blocks: `text`, `thinking`, `tool_use {name,id,input}`,
  `tool_result {tool_use_id, content}`
- **`usage`** — the token accounting, per turn:
  `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, `cache_creation.{ephemeral_1h,ephemeral_5m}`,
  `server_tool_use.{web_search_requests, web_fetch_requests}`, `service_tier`,
  `speed`, `inference_geo`, and a per‑`iterations` breakdown.

  > This is the single most valuable block for cost/analytics and is **not**
  > faithfully captured in the app's normalized events (the app *estimates* tokens
  > at ~4 chars/token). A real logging DB should store this verbatim.

**`message` object (user)**: `role`, `content` (string or blocks). Tool results
arrive as `toolUseResult` (structured object) on `user` entries.

### 2.2 Subagent files

- `.../subagents/agent-<id>.jsonl` — same line schema as the main transcript, but
  for one subagent's turns.
- `.../subagents/agent-<id>.meta.json` — sidecar, e.g.
  `{"agentType":"Explore","description":"...","toolUseId":"toolu_...","spawnDepth":1}`.
  This is the authoritative source for a subagent's friendly name and its parent
  linkage (`toolUseId` ties back to the `tool_use` in the parent transcript).

### 2.3 Externalized tool results

- `.../tool-results/<id>.txt` — plain text for large tool outputs referenced from
  the JSONL. Must be captured alongside the transcript or large results are lost.

### 2.4 Codex rollout files

`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` with record types `session_meta`,
`turn_context`, `response_item`, `event_msg`, `compacted`. Codex carries its own
**authoritative token counts** in the event stream (unlike Claude, where the app
estimates for the live view). Parser: `extension/src/codex-rollout-parser.ts`.

### 2.5 Normalized `AgentEvent` (the app's derived stream)

Defined in `extension/src/protocol.ts` (mirrored in `web/lib/bridge-types.ts`):

```ts
interface AgentEvent { time: number; type: AgentEventType; payload: Record<string, unknown>; sessionId?: string }
```

12 event types: `agent_spawn`, `agent_complete`, `agent_idle`, `message`,
`context_update`, `model_detected`, `tool_call_start`, `tool_call_end`,
`subagent_dispatch`, `subagent_return`, `permission_requested`, `error`.

Tab identity: `SessionInfo { id, label, status, startTime, lastActivityTime }`.

**Trade‑off:** `AgentEvent` is compact and runtime‑agnostic but lossy (elapsed
time not wall‑clock, estimated tokens, summarized tool args). The raw JSONL is
verbose and runtime‑specific but complete. See §3.2.

### 2.6 Where each thing is stored *today*

| Data | Location | Durability |
|---|---|---|
| Raw Claude transcript | `~/.claude/projects/<enc>/<uuid>.jsonl` | Persistent on local disk only |
| Subagent transcripts + meta | `.../<uuid>/subagents/` | Persistent, local only |
| Large tool outputs | `.../<uuid>/tool-results/*.txt` | Persistent, local only |
| Codex rollouts | `~/.codex/sessions/.../rollout-*.jsonl` | Persistent, local only |
| Normalized `AgentEvent`s | relay in‑memory buffer (≤5000/session) | **Ephemeral — lost on restart** |
| Tab labels | browser `localStorage` | Per‑browser only |
| Discovery/port files | `~/.claude/agent-flow/*.json` | Transient |
| Telemetry (aggregate) | `~/.agent-flow/telemetry/events.jsonl` | Local, opt‑out |

---

## Part 3 — Proposed system: a local `study-storage` capture folder

> **Revised direction.** This is a **research tool**, deployed as a VS Code
> extension to **<10 participants**, running entirely on each participant's
> machine. There is **no cloud, no auth, no public sharing**. The single most
> important heuristic is **richness and non‑ephemeral availability of stored
> data**. Sharing works by the participant **zipping one folder and sending it**
> to the researchers. This section supersedes the earlier cloud/Postgres design.

### 3.1 Requirements (restated for the research deployment)

1. **Maximum data.** Capture everything available, losslessly. When in doubt, keep it.
2. **Non‑ephemeral.** Everything survives restarts, tab closes, and crashes — written to disk immediately.
3. **Automatic.** No manual export step; capture happens as sessions run.
4. **Per‑tab.** Organized by session (one folder per session/tab).
5. **One easy‑to‑find, transferable folder** the participant can zip and send.
6. **Analysis‑ready** for researchers with standard tools (SQL, pandas), *and* fully reconstructable in the visualizer.

### 3.2 Shape of the solution

A single top‑level directory — call it **`study-storage/`** — that is:

- **Self‑contained.** Raw source data + a queryable index + a human‑readable
  README all in one tree. Nothing external is needed to interpret it.
- **Both raw and structured.** Raw JSONL bundles are the lossless source of truth;
  a single **SQLite database file** (`study.sqlite`) is the convenient queryable
  index over all of it. SQLite is the right "database of some kind" here: it *is* a
  real relational DB, but it's a **single file** that zips and emails trivially and
  opens in Python (`sqlite3`/pandas), R, or DB Browser for SQLite — no server.
- **Redundant on purpose.** The full raw JSON of every record is copied into the
  DB *and* kept as raw files, so a researcher who only opens `study.sqlite` still
  has everything, and a researcher who only has the raw files loses nothing either.

### 3.3 Location — inside the project repo

The study lives inside **one repo**, so the folder goes at the **workspace root**
for maximum findability — it shows up right in the VS Code file explorer next to
the code it describes:

```
<workspace-root>/study-storage/
```

- Overridable via a new setting `agentVisualizer.studyStoragePath` (relative paths
  resolve against the workspace root).
- Surface it in the extension UI anyway ("Reveal Study Folder" + "Package Study
  Data" commands) so participants never hunt for it.
- **Git hygiene:** the capturer auto‑adds `study-storage/` to the repo's
  `.gitignore` on first run. The data is full‑fidelity transcripts (large, and not
  source code); it should travel by **zip‑and‑send**, not by being committed. It
  stays perfectly findable in the file tree either way.
- Because storage is scoped to this one project, **backfill only needs this
  project's history** (§3.7) — no cross‑project scan.

### 3.4 Directory layout (per‑tab = per‑session)

The top level splits **live** capture from **backfilled** history into two sibling
folders (identical internal structure) so the two never intermingle:

```
study-storage/
  README.md                     # what this is + schema + "how to zip & send" (ships in the folder)
  MANIFEST.json                 # participant id, consent flag, tool version, schema version, machine info, capture window
  study.sqlite                  # the queryable index over ALL sessions, live + backfill (see §3.6)
  live/                         # sessions captured in real time after install
    sessions/
      <runtime>-<session-uuid>/  # one folder per tab
        session.json             # resolved session metadata (runtime, project, git branch, versions, timings, ai-title)
        transcript.jsonl         # VERBATIM copy of the raw main JSONL (byte-for-byte)
        hooks.jsonl              # raw hook payloads captured live (permission prompts, timing, failures — NOT in transcript)
        events.jsonl             # normalized AgentEvent stream (exactly what the visualizer rendered)
        environment.json         # OS/arch, node & CC/codex versions, env snapshot, model ids observed
        subagents/
          agent-<id>.jsonl       # verbatim subagent transcript
          agent-<id>.meta.json   # verbatim sidecar (agentType, description, toolUseId, spawnDepth)
        tool-results/
          <id>.txt               # verbatim externalized large tool outputs
        attachments/             # copies of any attachment payloads referenced by the transcript
  backfill/                     # historical sessions imported once at install (same internal layout)
    sessions/
      <runtime>-<session-uuid>/  # (hooks.jsonl absent — hooks are live-only; the rest is present)
        ...
```

Everything raw is copied **byte‑for‑byte** so nothing the runtimes write is ever
lost to a parsing gap. `live/` vs. `backfill/` keeps freshly‑captured data cleanly
separated from imported history; the SQLite index tags every session with a
`source` column (`live | backfill`) so analyses can include or exclude either.

> Note: `hooks.jsonl` and `events.jsonl` only exist under `live/` — both are
> in‑the‑moment signals that cannot be reconstructed from a historical transcript.
> Backfilled sessions carry the full raw transcript, subagents, and tool‑results;
> the `study.sqlite` index derives structured turns/tool‑calls/tokens uniformly
> for live and backfill.

### 3.5 What "maximum data" means — capture all four streams

The richest capture keeps the source of truth **and** both derived views **and**
the out‑of‑band signals that never appear in the transcript:

1. **Raw transcript bundle** (source of truth): main `.jsonl` + `subagents/**` +
   `subagents/*.meta.json` + `tool-results/*.txt` + attachments. Contains prompts,
   assistant text, thinking, tool_use/tool_result, **verbatim `message.usage`
   token accounting**, real `timestamp`s, `cwd`, `gitBranch`, versions,
   permission‑mode changes, ai‑title, queue ops, file‑history snapshots.
2. **Raw hook events** (`hooks.jsonl`): every hook payload POSTed to the
   `HookServer`, kept unmodified. These carry things the transcript does *not*
   surface cleanly — **permission prompts**, `PostToolUseFailure`, precise
   per‑hook wall‑clock timing, and session/subagent lifecycle edges.
3. **Normalized `AgentEvent` stream** (`events.jsonl`): exactly what the visualizer
   consumed, so a researcher can reproduce the rendered view without re‑parsing.
4. **Environment snapshot** (`environment.json`): OS/arch, Node version, Claude
   Code / Codex versions, `CODEX_HOME`, and the set of model ids observed.

### 3.6 SQLite index schema (`study.sqlite`)

One DB spanning all sessions. Structured columns for the common filters; a
`raw_json` TEXT column on every row so nothing is lost to schema drift.

- **`sessions`** — `id`, `source (live|backfill)`, `runtime`, `project_path (cwd)`,
  `git_branch`, `cc_version`, `ai_title`, `started_at`, `ended_at`, `status`,
  `machine_id`, `participant_id`, `folder_path`, `event_count`,
  `total_input_tokens`, `total_output_tokens`, `total_cache_read_tokens`,
  `total_cache_creation_tokens`.
- **`agents`** — `id`, `session_id`, `parent_agent_id`, `agent_type`,
  `description`, `spawn_depth`, `model`, `started_at`, `ended_at`.
- **`turns`** — `uuid`, `session_id`, `agent_id`, `parent_uuid`, `role`, `model`,
  `timestamp`, `stop_reason`, `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`, `text_content`,
  `thinking_content`, `raw_json`.
- **`tool_calls`** — `tool_use_id`, `session_id`, `agent_id`, `turn_uuid`,
  `tool_name`, `input_json`, `result_ref` (→ `tool-results/*.txt`), `result_text`,
  `is_error`, `token_cost`, `started_at`, `ended_at`, `files_touched_json`.
- **`hook_events`** — `id`, `session_id`, `hook_event_name`, `timestamp`,
  `payload_json`.
- **`events`** — `id`, `session_id`, `seq`, `time`, `type`, `payload_json`
  (the normalized `AgentEvent` stream).
- **`files`** — `session_id`, `path`, `operation` (read/edit/write), `turn_uuid`,
  `timestamp` (file‑attention / edit history, for research on where agents focus).

### 3.7 Automatic, per‑tab capture pipeline

Reuse the existing per‑session watch/tail infrastructure — the capturer is a new
**sink** alongside the SSE broadcast, not a rewrite:

```
SessionWatcher / relay  (already tails each session's JSONL, already receives hooks)
        │
        ├─► existing SSE → browser (unchanged)
        │
        └─► NEW: StudyStorage sink   (one writer per session/tab)
                 • mkdir sessions/<runtime>-<id>/ on first sight
                 • append new raw transcript bytes → transcript.jsonl (resumable via byte offset)
                 • append every hook payload → hooks.jsonl
                 • append every normalized AgentEvent → events.jsonl
                 • copy subagent files, meta sidecars, tool-results/*.txt as they appear
                 • upsert rows into study.sqlite (WAL mode, batched)
                 • on session end / inactivity: write session.json rollups + token totals
```

Design points:
- **Write‑through, immediately.** Flush to disk as data arrives (append‑only files
  + SQLite WAL). Nothing lives only in memory — the ephemeral 5000‑event buffer is
  no longer the record of truth.
- **Incremental & resumable.** Per‑session byte offset (mirrors the existing
  tailer's `lastSize`) so a restart resumes instead of duplicating. Live capture
  writes under `live/`.
- **Backfill importer (this project only).** A one‑shot command runs once at
  install and writes under `backfill/`. Because storage is per‑project, it only
  imports **this workspace's** history: Claude sessions from
  `~/.claude/projects/<encoded‑workspace>/`, plus any Codex rollouts under
  `~/.codex/sessions/**` whose `cwd` falls inside the workspace. A session already
  present under `live/` is skipped, so nothing is imported twice.
- **Crash‑safe.** Append‑only + SQLite WAL means a hard kill loses at most the last
  unflushed batch; the raw `.jsonl` copies are always complete up to the last line.

### 3.8 Transfer / "zip & send" workflow

- A command **"Agent Flow: Package Study Data"** produces
  `study-storage-<participant>-<date>.zip` from the folder.
- `README.md` inside the folder tells the participant exactly what to send and to
  whom, and tells the researcher how to load `study.sqlite` (a two‑line
  `sqlite3`/pandas snippet) and how to replay a session in the visualizer.
- Because it's just files, `scp`, a shared drive, or email all work; no
  infrastructure on the receiving end.

### 3.9 Privacy — informed‑consent, not anonymization ⚠️

Different posture from the shipped telemetry (which is aggregate‑only). Here the
folder contains **full transcripts** — prompts, thinking, file contents, shell
output, `cwd`, `gitBranch`, usernames in paths, possibly pasted secrets. That is
intentional (it's the research data), so the controls are about **consent and
custody**, not stripping data:

- **Explicit study consent** recorded in `MANIFEST.json` (`consent: true` + when),
  gated behind a first‑run dialog. Capture is off until consent is given.
- **Local‑only by default.** Nothing leaves the machine until the participant
  chooses to zip and send — no automatic upload anywhere.
- **Visible & inspectable.** Participant can open the folder, read it, and delete
  any session before sending.
- **Optional redaction hook** (off by default for max fidelity) if a study needs
  to scrub secret‑shaped strings before packaging.

### 3.10 Phasing (status)

1. ✅ **DONE — StudyStorage sink** (`extension/src/study-storage.ts`): raw bundle
   mirror + `hooks.jsonl` + `events.jsonl` per session, `MANIFEST.json`, folder
   `README.md`, auto `.gitignore`. Wired into `scripts/relay.ts` via
   `AGENT_FLOW_STUDY_STORAGE` / `AGENT_FLOW_STUDY_PARTICIPANT`.
2. ✅ **DONE — `study.sqlite` index + backfill** (`extension/src/study-index.ts`,
   built on `node:sqlite`, WAL, rebuild-from-scratch; backfill importer for this
   project's history into `backfill/`). Auto-built at relay startup/shutdown;
   rebuildable via `pnpm run study:index`.
3. ✅ **DONE — Extension host wiring + UX.** `StudyStorage` is wired into the VS
   Code Claude runtime (`session-watcher.ts` taps + `claude-runtime.ts` hook
   taps + backfill/index). Settings: `agentVisualizer.studyStorage.enabled`
   (off by default), `.path`, `.participantId`. First-run **consent dialog**
   (per-workspace). Commands: **Reveal Study Data Folder**, **Package Study Data
   (Zip)** (best-effort native zip + index rebuild, falls back to reveal).
   `onStartupFinished` activation so capture runs without opening the panel.
   Consent glue in `study-vscode.ts`.
4. **Optional redaction hook** before packaging (not yet built). (Codex raw
   capture is out of scope by decision.)

### 3.11 Decisions (resolved)

- **Folder location**: ✅ **per‑project**, at `<workspace-root>/study-storage/`,
  for maximum findability inside the repo. Auto‑gitignored.
- **SQLite index**: ✅ **yes** — raw JSONL (source of truth) + `study.sqlite`
  (queryable index) for analysis down the road.
- **Backfill**: ✅ **yes, all of this project's history**, imported into a separate
  `backfill/` subfolder (kept apart from live `live/` data), tagged `source` in
  the DB.

---

### Key source references

- Pipeline narrative: `docs/claude-hooks-pipeline.md`
- Transcript locations & watching: `extension/src/session-watcher.ts`, `scripts/relay.ts`
- Parsers: `extension/src/transcript-parser.ts`, `extension/src/codex-rollout-parser.ts`, `extension/src/fs-utils.ts`
- Types: `extension/src/protocol.ts` (mirror `web/lib/bridge-types.ts`)
- Tabs/sessions: `web/hooks/use-vscode-bridge.ts`, `web/components/agent-visualizer/session-tabs.tsx`
- In‑memory buffering (the thing to replace): `scripts/relay.ts` (`MAX_EVENT_BUFFER = 5000`)
