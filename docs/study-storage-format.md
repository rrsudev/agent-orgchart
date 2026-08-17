# `study-storage/` — data format & transfer spec

This is the on‑disk format for Agent Fruitstand's research capture. A shorter
participant‑facing `README.md` ships **inside** the capture folder (generated from
`README_TEMPLATE` in `extension/src/study-storage.ts`) so that whoever receives a
zipped copy can orient with no other context; this file is the full spec.

- **What it is:** a single, self‑contained folder holding the maximum‑fidelity
  record of every Claude Code / Codex session (each visualizer "tab") captured on
  a participant's machine.
- **How it's shared:** the participant zips the folder and sends it. No server, no
  account, no cloud. Everything needed to read the data is inside the zip.
- **Design heuristic:** richness and non‑ephemeral availability above all. When in
  doubt, more data is kept, raw, in more than one form.

Location: **`~/.agent-flow-study/<workspace-basename>-<hash8>/`** — one subfolder
per workspace, under a single capture home in the participant's home directory.
It sits **outside every repo**, so it can't be committed, `git clean`ed, or lost
to a reclone, and it survives uninstalling the extension. Overridable via the
`agentFlowStudy.studyStorage.path` setting (relative to the workspace); setting it
opts out of the per‑workspace subfolder and uses that path as the root directly,
and if that path lands inside a repo the capturer adds it to `.gitignore` on first
run. Data travels by zip‑and‑send.

> **Check both roots when collecting.** The relay / standalone entry points
> (`pnpm dev`, `npx agent-flow-app`) still default to `<workspace>/study-storage/`
> instead, so a machine that has used both ends up with capture data in two
> places. The in‑repo one is gitignored and easy to miss, and the zip command only
> packages the extension's home.

---

## Folder layout

Live capture and backfilled history are kept in two sibling folders with identical
internal structure, so they never intermingle:

```
~/.agent-flow-study/<workspace>-<hash8>/
  README.md                     # short participant-facing orientation
  MANIFEST.json                 # participant + consent + tool/schema versions + machine + capture window
  study.sqlite                  # queryable index over live + backfill sessions (single-file SQLite DB)
  capture-errors.log            # plaintext log of any capture failure (see "When capture fails")
  study-sessions.jsonl          # append-only marker log of EVERY study-session action (start/pause/resume/end/protocol)
  interactions.jsonl            # append-only log of UI interactions (renames, session resume)
  study-sessions/               # one folder per participant "work period" (see below)
    <NNN>-<id>/
      session.json              # timings, running duration, 15-min protocol status, tabs used
      events.jsonl              # the event-stream slice captured during this session's window
      lifecycle.jsonl           # this session's own start/pause/resume/end markers
      interactions.jsonl        # interactions during this window (only if any occurred)
  live/                         # sessions captured in real time after install
    sessions/
      <runtime>-<session-uuid>/  # ONE folder per tab/session
        session.json             # resolved session metadata + rollups (token totals, timings)
        transcript.jsonl         # verbatim copy of the runtime's main transcript JSONL
        hooks.jsonl              # raw Claude Code hook payloads (permission prompts, failures, timing)
        events.jsonl             # normalized AgentEvent stream (what the visualizer rendered)
        environment.json         # OS/arch, Node & runtime versions, model ids observed
        subagents/
          agent-<id>.jsonl       # verbatim subagent transcript
          agent-<id>.meta.json   # verbatim sidecar: agentType, description, toolUseId, spawnDepth
        tool-results/
          <id>.txt               # verbatim externalized large tool outputs
  backfill/                     # this project's history, imported once at startup
    sessions/
      claude-<session-uuid>/     # transcript + subagents + tool-results only
        transcript.jsonl
        subagents/ …
        tool-results/ …
        session.json             # source: "backfill"
        environment.json
```

Everything under a session folder is copied **byte‑for‑byte** from what the
runtime wrote, so no parsing gap can ever lose data. `study.sqlite` is a
*convenience index* built from these files — the files remain the source of truth.
Backfilled sessions contain the full raw transcript, subagents, and tool‑results,
but **no `hooks.jsonl` or `events.jsonl`** — both are live-only signals that
cannot be reconstructed from a historical transcript. The `study.sqlite` index
derives structured turns / tool-calls / tokens uniformly for live and backfill.

---

## The captured streams (per session)

| File | Source | Why it's kept |
|---|---|---|
| `transcript.jsonl` | Claude/Codex raw transcript | Source of truth: prompts, responses, thinking, tool_use/result, **verbatim `message.usage` tokens**, real timestamps, `cwd`, `gitBranch`, versions, mode changes, ai‑title. |
| `hooks.jsonl` | Claude Code hook POSTs | Out‑of‑band signals not clean in the transcript: **permission prompts**, `PostToolUseFailure`, precise per‑hook timing, lifecycle edges. |
| `events.jsonl` | app's normalized `AgentEvent` | Reproduces the rendered visualization without re‑parsing. |
| `environment.json` | runtime host | OS/arch/release, Node version, tool version, runtime, and the literal `CODEX_HOME` if set. No other environment variables. |

> **Codex is not captured symmetrically.** In the VS Code build the Codex runtime
> is never handed the capture sink, so a Codex session produces no folder at all;
> backfill is Claude‑only. Only the relay path can produce a `codex-<id>/` folder,
> and even then it holds `events.jsonl` + metadata — never a rollout mirror.

> **One hook payload limit worth knowing:** a hook POST larger than 32 MB is
> rejected outright by the hook server, so it never reaches `hooks.jsonl`. The
> underlying tool call still appears in `transcript.jsonl`.

---

## `MANIFEST.json`

```jsonc
{
  "schemaVersion": 1,
  "tool": "agent-flow",             // internal id, unchanged by the Fruitstand rebrand
  "toolVersion": "1.3.0",
  "participantId": "P03",           // study-assigned, not PII; "anonymous" when unset
  "workspacePath": "/Users/x/proj", // absolute path of the captured workspace
  "consent": true,                  // see the note below — a constant, not a click
  "machineId": "sha256(hostname)[:16]",
  "os": "darwin", "arch": "arm64",
  "captureStartedAt": "2026-08-10T12:00:00Z",  // preserved across rewrites
  "sessionCount": 12                // sessions seen by the CURRENT host process
}
```

> `consent: true` is a hardcoded literal, not a record of an in‑editor click —
> consent for this build is collected at study enrollment. There is no `consentAt`
> field. And `sessionCount` counts sessions registered by the running process, so
> it can be lower than the number of folders on disk after a restart; count the
> folders if you need the true total.

## `session.json` (per session)

```jsonc
{
  "id": "447ffde1-...",
  "source": "live",                // "live" | "backfill"
  "runtime": "claude",             // "claude" | "codex"
  "projectPath": "/Users/x/proj",  // from transcript `cwd`
  "startedAt": "…",
  "endedAt": "…",                  // null while the session is still active
  "status": "completed",           // "active" | "completed"
  "schemaVersion": 1
}
```

> Deliberately thin. Rollups (token totals, turn/tool counts) and derived metadata
> (`gitBranch`, Claude Code version, ai‑title) are **not** written here — they are
> columns in `study.sqlite`, computed from the transcript. If you need them without
> SQLite, parse `transcript.jsonl`.

## `environment.json` (per session)

```jsonc
{
  "os": "darwin", "arch": "arm64", "release": "25.5.0",
  "nodeVersion": "v22.14.0",
  "toolVersion": "1.3.0",
  "runtime": "claude",
  "codexHome": null,               // literal value of CODEX_HOME, when set
  "capturedAt": "…"
}
```

> No other environment variables are captured, and neither the Claude Code version
> nor the observed model ids appear here despite older drafts of this spec saying
> so. Backfilled sessions get a smaller set: `{ os, arch, nodeVersion, toolVersion,
> runtime, importedAt, note }`.

## `interactions.jsonl` (top level, and teed per study session)

Discrete UI actions that are not agent activity — currently the three that change
how a participant labels or returns to their work:

```jsonc
{ "capturedAt": "…", "kind": "agent-rename",   // "agent-rename" | "session-rename" | "session-resume"
  "at": "…", "agentId": "…", "sessionId": "…", "studySessionId": "…",
  "previous": "Apple", "next": "auth refactor" }
```

Renames are recorded only when the label actually changed. `previous`/`next` hold
the literal text the participant typed, untruncated. Because each record carries
both `sessionId` and `studySessionId`, a rename joins to both a tab and a work
period.

---

## Study sessions (participant work periods)

Distinct from the per-tab folders above, the tool also records the participant's
**timed study sessions** — the "work period" they start, pause, resume, and end
from the UI (the study protocol asks for ≥15 minutes of active time per session).
The session clock only advances while running; pausing does not accrue time.

- **`study-sessions.jsonl`** (top level) — an append-only, chronological marker
  log of *every* action, so a session boundary is never ambiguous. Each line:
  `{ capturedAt, action, studySessionId, sessionNumber, at, elapsedMs, reason?, agentSessionIds?, protocolMinimumMs? }`
  where `action` ∈ `started | paused | resumed | ended | protocol-reached`.
- **`study-sessions/<NNN>-<id>/`** — one folder per session (`NNN` = zero-padded
  session number):
  - `session.json` — `{ studySessionId, sessionNumber, participantId, startedAt,
    endedAt, status (active|paused|ended), endReason, accumulatedRunningMs,
    protocolMinimumMs, protocolReachedAt, protocolSatisfied, agentSessionIds[],
    eventCount }`.
  - `events.jsonl` — the slice of the normalized event stream captured while this
    session was active (the same events also live in the per-tab folders).
  - `lifecycle.jsonl` — this session's own subset of the marker log.

This is an **additional** view, not a replacement: the per-tab `live/` folders
keep capturing continuously, so a participant's actions *beyond* a session's
official end (they may keep working past the allotted time) remain fully
recoverable there, while the marker log pins exactly when each session ran.

---

## `study.sqlite` schema

Built by `extension/src/study-index.ts` using Node's built-in `node:sqlite`
(Node ≥ 22.5). It is a **derived index** rebuilt from scratch on each run — the
raw JSONL files remain the source of truth. `turns.raw_json` and the
`payload_json` columns carry the verbatim source so nothing is lost to schema
drift. When the same session id appears in both `live/` and `backfill/`, the
`live/` copy wins.

- **`sessions`** — `id` (PK), `source` (`live`|`backfill`), `runtime`,
  `project_path`, `git_branch`, `cc_version`, `ai_title`, `started_at`,
  `ended_at`, `status`, `folder_path`, `turn_count`, `tool_call_count`,
  `subagent_count`, `total_input_tokens`, `total_output_tokens`,
  `total_cache_read_tokens`, `total_cache_creation_tokens`.
- **`agents`** — PK (`session_id`, `id`); `parent_agent_id`, `agent_type`,
  `description`, `spawn_depth`, `model`. `id` is `orchestrator` or `agent-<id>`.
- **`turns`** — PK (`session_id`, `uuid`); `agent_id`, `parent_uuid`, `role`,
  `model`, `timestamp`, `stop_reason`, `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`, `text_content`,
  `thinking_content`, `raw_json`.
- **`tool_calls`** — PK (`session_id`, `tool_use_id`); `agent_id`, `turn_uuid`,
  `tool_name`, `input_json`, `result_text`, `is_error`, `started_at`, `ended_at`.
- **`hook_events`** — `session_id`, `seq`, `hook_event_name`, `timestamp`, `payload_json`.
- **`events`** — `session_id`, `seq`, `time`, `type`, `payload_json`.
- **`files`** — `session_id`, `path`, `operation` (`read`|`edit`|`write`),
  `agent_id`, `turn_uuid`, `timestamp` (derived from file-tool calls).

Indexes: `session_id` across the big tables, plus `turns.timestamp` and
`tool_calls.tool_name` for common analyses.

**When it's built:** automatically at relay startup and shutdown (best-effort;
skipped silently on Node < 22.5). Rebuild anytime with
`pnpm run study:index [path/to/study-storage]` — safe to re-run, and the command
researchers use after unzipping.

---

## When capture fails

Capture is best‑effort and never interrupts the participant's work, so failures are
recorded rather than raised:

- **`capture-errors.log`** (top level) — plaintext, one line per failure:
  `<ISO timestamp> [<context>] <stack or message>`. An empty or absent file means
  nothing failed. **Check this first** when a session looks short or a stream is
  missing.
- The extension also surfaces a status‑bar item and a one‑time toast on the first
  failure, so a participant can report it.

Two things that look like corruption but are normal: a `*.tmp` file left in a
session folder (an interrupted mirror — the real file beside it is still intact,
since mirroring writes to a temp file and renames), and a `session.json` still
reading `"status": "active"` (the host was killed before the session finalized).

---

## For researchers — loading the data

**Everything at once (Python):**

```python
import sqlite3, pandas as pd
db = sqlite3.connect("study-storage/study.sqlite")
sessions = pd.read_sql("SELECT * FROM sessions", db)
turns    = pd.read_sql("SELECT * FROM turns", db)
tools    = pd.read_sql("SELECT * FROM tool_calls", db)
# token cost per session:
pd.read_sql("SELECT session_id, SUM(input_tokens+output_tokens) tok "
            "FROM turns GROUP BY session_id", db)
```

To separate real‑time from historical data, filter on `source`
(`WHERE source = 'live'` or `'backfill'`).

Three caveats about the index:

- It is **rebuilt from scratch**, not written during capture — it reflects the
  files as of the last build (extension start/stop, or the packaging command).
  Rebuild any time with `pnpm run study:index`.
- It requires **Node ≥ 22.5** (`node:sqlite`). On an older Node it is silently
  skipped, and `study.sqlite` may be absent or stale. The JSONL files are
  unaffected — they remain the source of truth.
- It indexes `live/` and `backfill/` only. The **study‑session folders,
  `study-sessions.jsonl`, and `interactions.jsonl` are not in the database** —
  read those as JSONL.

**Full fidelity for one session:** read the raw files under
`live/sessions/<runtime>-<id>/` (or `backfill/sessions/<runtime>-<id>/`) —
`transcript.jsonl` is the complete record; each line is one JSON object.
`study.sqlite` is derived from these and safe to regenerate.

**Replay:** the visualizer can replay a *study session* (a participant work
period) from its own in‑browser recording, reached from the session archive in the
UI. There is **no** "open this capture folder and replay it" path — pointing the
extension at a `live/sessions/<id>/` folder is not implemented. To reconstruct a
session from captured files, parse `transcript.jsonl` directly or query
`study.sqlite`.

---

## For participants — capture settings & sending your data

**Capture is already on.** `agentFlowStudy.studyStorage.enabled` defaults to
`true` in the study build; installing the build is what you agreed to at
enrollment, and there is no in‑editor consent prompt. Nothing is ever uploaded
automatically — the only way data leaves your machine is you sending the zip.

Optional, in VS Code **User** settings so it applies to every project you record:

- `agentFlowStudy.studyStorage.participantId` — tags your data with your study id.
  It only tags sessions captured *after* you set it, so it can be filled in later.
- To pause capture (rarely needed): `agentFlowStudy.studyStorage.enabled: false`.
  This is read **once at startup**, so reload the window after changing it.

See `study/vscode-settings.jsonc` in the repo for a copy‑pasteable version.

**Send your data:**

1. Run **"Agent Fruitstand: Package Study Data (Zip)"** from the Command Palette.
   It flushes the current sessions, rebuilds the index, and offers to save
   `agent-flow-study-data.zip`. This archives **every** workspace you have
   recorded, not just the current one.
2. Send the zip to the researcher via the channel they gave you.

> **"Reveal Study Data Folder" shows less than the zip contains.** Reveal opens
> the *current workspace's* folder; the zip packages the whole
> `~/.agent-flow-study/` home. If you compress by hand from Reveal, you will send
> one workspace's data.

**Before you send:** this folder contains the full content of your agent sessions —
your prompts, the model's output, file contents, and command output, verbatim and
unredacted. Review it, and delete any session folder you don't want to share.
