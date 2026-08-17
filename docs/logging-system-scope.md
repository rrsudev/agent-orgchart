# Logging & Persistence System

> **Status: implemented and shipping** (extension 1.3.0). This began as a scoping
> document; Parts 1–2 still describe the ingestion side accurately, and Part 3 —
> once a proposal — now documents **what was actually built**, corrected against
> the code and against real capture folders on disk.
>
> Goal, unchanged: capture the **maximum amount of non‑ephemeral, per‑tab
> (per‑session)** data into a single local capture folder that a research
> participant can **zip and send** to researchers. Research tool, VS Code
> extension, <10 users, no cloud.
>
> **Two things moved since the original proposal — if you read only one note, read
> this one:**
> - The capture folder is **no longer inside the project repo**. It lives at
>   `~/.agent-flow-study/<workspace>-<hash8>/`, one subfolder per workspace, so it
>   survives uninstalling the extension and never sits in a git working tree
>   (§3.3).
> - The override setting is **`agentFlowStudy.studyStorage.path`**, not
>   `agentVisualizer.studyStoragePath`.
>
> The companion format spec — a copy of which ships inside the folder as
> `README.md` — is [`docs/study-storage-format.md`](./study-storage-format.md).

This document has three parts:

1. How logging and JSONLs work, and how the runtimes store them.
2. A complete inventory of the information available per JSONL file and where it lives.
3. The local, maximum‑fidelity capture folder **as built**.

---

## Part 1 — How logging & JSONLs work today

### 1.1 The app does not create logs — Claude Code / Codex do

Agent Fruitstand is a **read‑only visualizer**. It never writes transcripts. The JSONL
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

Agent Fruitstand ingests activity through **two parallel sources** that both emit the
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

### 1.3 The transport is ephemeral; the capture layer is not

The distinction matters, because the two are often confused when reading this code.

**Transport — still ephemeral, by design.** Nothing here is a record:

- The relay (`scripts/relay.ts`) holds sessions in an in‑memory `Map` and buffers
  **at most `MAX_EVENT_BUFFER = 5000` events per session, in memory only**. On a
  new SSE client it replays that buffer. It writes nothing to disk.
- Transport to the browser is **SSE** (`/events`, default port 3001) or VS Code
  `postMessage`. No websocket, no API.
- The webview keeps its own per‑session event buffer and replays it on tab switch.

**Capture — durable, and the point of the study build.** In the VS Code extension,
`StudyStorage` (`extension/src/study-storage.ts`, wired up in
`extension/src/study-vscode.ts`) sits alongside that transport and writes every
stream to disk as it arrives. It is **on by default** in this build; consent is
handled at study enrollment rather than by an in‑editor prompt.

Writes are **synchronous appends** (`fs.appendFileSync`, `study-storage.ts:419`) —
one line per record, no buffering and no flush interval — so a crash or a force
quit loses at most the record being written. Files that are rewritten rather than
appended (`session.json` and the rollups) go through a temp‑file‑then‑rename so a
reader never sees a half‑written file (`study-storage.ts:352`).

Also written outside the capture folder, unchanged: discovery/port files
(`~/.claude/agent-flow/*.json`), the Claude `settings.json` hook config, opt‑out
aggregate telemetry (`~/.agent-flow/telemetry/events.jsonl`), and client‑side tab
renames in `localStorage` (`agent-orgchart:session-labels`).

The raw runtime JSONLs remain the source of truth; the capture folder's job is to
copy them somewhere that survives the session, plus record the signals that only
exist at runtime (§3.5).

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

### 3.3 Location — a capture home outside every repo

> **Changed from the original proposal.** The folder was going to live at the
> workspace root (`<workspace-root>/study-storage/`) for findability. It doesn't
> any more, for two reasons that only became obvious in use: participants work
> across more than one project, and a capture folder inside a git working tree is
> one `git clean` or one fresh clone away from being destroyed. It also grows —
> a `study.sqlite` of tens of megabytes inside the repo the participant is
> actively working in is a hazard, not a convenience.

Capture goes to a **single home directory, one subfolder per workspace**:

```
~/.agent-flow-study/<workspace-basename>-<hash8>/
```

- `STUDY_STORAGE_BASE = path.join(os.homedir(), '.agent-flow-study')`
  (`study-vscode.ts:36`); the per‑workspace subfolder key is the workspace
  basename plus a short hash of its full path, so two projects with the same
  folder name never collide.
- It is **outside every repo**, so it cannot be committed, cleaned, or lost with a
  reclone, and it **survives uninstalling the extension**.
- Overridable via **`agentFlowStudy.studyStorage.path`** (relative to the
  workspace). Setting it opts out of the per‑workspace subfolder — the configured
  path becomes the root directly (`study-vscode.ts:62-64`). If you point it back
  inside a repo, the capturer adds the folder to that repo's `.gitignore` on first
  run (`study-storage.ts:673`).
- Two commands surface it so participants never hunt for it:
  `Agent Fruitstand: Reveal Study Data Folder` and
  `Agent Fruitstand: Package Study Data (Zip)`.
- Because one home now holds **every** workspace, the zip command packages the
  whole home rather than the current workspace's subfolder — see §3.8.

**⚠️ Two entry points, two different defaults.** The VS Code extension is not the
only thing that writes capture data, and the other path never moved:

| Entry point | Default capture root |
|---|---|
| VS Code extension | `~/.agent-flow-study/<workspace>-<hash8>/` (`study-vscode.ts:36`) |
| Relay / standalone (`pnpm dev`, `npx agent-flow-app`) | **`<workspace>/study-storage/`** (`relay.ts:56-59`), env‑overridable via `AGENT_FLOW_STUDY_STORAGE` |

So a machine that has used both ends up with capture data in **both** places, and
the in‑repo one is gitignored, which makes it easy to miss. This repo currently
has exactly that: an active `study-storage/` at the workspace root *and*
`~/.agent-flow-study/agent-orgchart-<hash>/`. **When collecting participant data,
check both roots** — the zip command only packages the extension's home.

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

- **`Agent Fruitstand: Package Study Data (Zip)`** (`study-vscode.ts:110`) is the
  whole workflow. It flushes the live sessions, rebuilds `study.sqlite` so the
  index in the archive is current, then opens a save dialog defaulting to
  **`agent-flow-study-data.zip`** beside the capture home.
- It zips the **packaging root — the entire `~/.agent-flow-study` home**, not just
  the current workspace's subfolder, so a participant who worked across several
  projects ships all of them in one archive and nothing is silently left behind.
- If no platform compressor succeeds, it falls back to revealing the folder with
  instructions to compress it by hand — the command never fails silently.
- `README.md` inside the folder tells the participant what to send, and tells the
  researcher how to load `study.sqlite` and how to replay a session.
- Because it's just files, `scp`, a shared drive, or email all work; no
  infrastructure on the receiving end.

### 3.9 Privacy — informed‑consent, not anonymization ⚠️

Different posture from the shipped telemetry (which is aggregate‑only). Here the
folder contains **full transcripts** — prompts, thinking, file contents, shell
output, `cwd`, `gitBranch`, usernames in paths, possibly pasted secrets. That is
intentional (it's the research data), so the controls are about **consent and
custody**, not stripping data:

- **Nothing is redacted, truncated, or hashed.** There is no scrubbing pass in the
  capture path — searching `study-storage.ts` for redaction turns up nothing,
  because none exists. Prompts, model output, thinking, file contents, and command
  output land on disk verbatim. Treat a capture folder as equivalent to handing
  over the participant's terminal history for the period.
- **Consent is handled at study enrollment, not in the editor.** Capture is **on by
  default** in this build (`agentFlowStudy.studyStorage.enabled` defaults to
  `true`); installing the study build *is* the participant accepting recording.
  There is no first‑run dialog. `MANIFEST.json` records `consent: true` as a fact
  about the build, not as evidence of an in‑editor click — the consent record of
  record lives in the study's enrollment paperwork.
- **Local‑only.** Nothing leaves the machine until the participant chooses to zip
  and send — no automatic upload anywhere.
- **Visible & inspectable.** The participant can open the folder, read it, and
  delete any session folder before sending. The shipped `README.md` says so
  explicitly.
- **To pause capture** (rarely needed): set
  `agentFlowStudy.studyStorage.enabled: false`. See `study/vscode-settings.jsonc`
  for the participant‑facing settings file.
- The **participant id** (`agentFlowStudy.studyStorage.participantId`) is optional
  and tags `MANIFEST.json`; unset, it records `"anonymous"`. It only affects
  sessions captured after it is set, so it can be filled in later for bookkeeping.

### 3.10 Status

Everything below is built and shipping as of extension 1.3.0.

1. ✅ **StudyStorage sink** (`extension/src/study-storage.ts`): raw bundle mirror +
   `hooks.jsonl` + `events.jsonl` per session, `MANIFEST.json`, folder `README.md`,
   auto `.gitignore` when the root sits inside a repo. Also wired into
   `scripts/relay.ts` via `AGENT_FLOW_STUDY_STORAGE` /
   `AGENT_FLOW_STUDY_PARTICIPANT` for the non‑extension entry points.
2. ✅ **`study.sqlite` index + backfill** (`extension/src/study-index.ts`, built on
   `node:sqlite`, WAL, rebuild‑from‑scratch; backfill importer into `backfill/`).
   Rebuildable out of band via `pnpm run study:index`.
3. ✅ **Extension host wiring + UX.** Taps in `session-watcher.ts` (transcripts) and
   `claude-runtime.ts` (hooks). Settings: `agentFlowStudy.studyStorage.enabled`
   (**on** by default in the study build), `.path`, `.participantId`. Commands:
   **Reveal Study Data Folder**, **Package Study Data (Zip)**.
   `onStartupFinished` activation, so capture runs whether or not the participant
   ever opens the visualizer panel.
4. ✅ **Study‑session (work‑period) capture** — the participant clock, its lifecycle
   markers, and the per‑period event slice (§3.5, and "Study sessions" in the
   format spec).

**Not built, by decision:** any redaction or scrubbing pass (§3.9), and raw Codex
bundle capture (Codex sessions are indexed and their transcripts backfilled, but
the live raw‑bundle mirror is Claude‑only).

### 3.11 Decisions (resolved)

- **Folder location**: ✅ a **shared capture home outside every repo** —
  `~/.agent-flow-study/<workspace>-<hash8>/`, one subfolder per workspace.
  *(Reversed from the original per‑project decision — see the note in §3.3.)*
- **SQLite index**: ✅ **yes** — raw JSONL (source of truth) + `study.sqlite`
  (queryable index) for analysis down the road.
- **Backfill**: ✅ **yes, all of this project's history**, imported into a separate
  `backfill/` subfolder (kept apart from live `live/` data), tagged `source` in
  the DB.
- **Consent**: ✅ handled at **enrollment**, not by an in‑editor prompt; capture is
  on by default in the study build.

---

### Key source references

- Pipeline narrative: `docs/claude-hooks-pipeline.md`
- Transcript locations & watching: `extension/src/session-watcher.ts`, `scripts/relay.ts`
- Parsers: `extension/src/transcript-parser.ts`, `extension/src/codex-rollout-parser.ts`, `extension/src/fs-utils.ts`
- Types: `extension/src/protocol.ts` (mirror `web/lib/bridge-types.ts`)
- Tabs/sessions: `web/hooks/use-vscode-bridge.ts`, `web/components/agent-visualizer/session-tabs.tsx`
- In‑memory buffering (the thing to replace): `scripts/relay.ts` (`MAX_EVENT_BUFFER = 5000`)
