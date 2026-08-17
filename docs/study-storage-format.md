# `study-storage/` — data format & transfer spec

This is the on‑disk format for Agent Fruitstand's research capture. A copy of this file
(as `README.md`) ships **inside** the `study-storage/` folder so that whoever
receives a zipped copy can interpret it with no other context.

- **What it is:** a single, self‑contained folder holding the maximum‑fidelity
  record of every Claude Code / Codex session (each visualizer "tab") captured on
  a participant's machine.
- **How it's shared:** the participant zips the folder and sends it. No server, no
  account, no cloud. Everything needed to read the data is inside the zip.
- **Design heuristic:** richness and non‑ephemeral availability above all. When in
  doubt, more data is kept, raw, in more than one form.

Location: **`<project-root>/study-storage/`** — inside the study repo, so it's
visible in the editor's file tree (overridable via the
`agentVisualizer.studyStoragePath` setting). It is git‑ignored by default; it
travels by zip‑and‑send, not by being committed.

---

## Folder layout

Live capture and backfilled history are kept in two sibling folders with identical
internal structure, so they never intermingle:

```
study-storage/
  README.md                     # this document (shipped inside the folder)
  MANIFEST.json                 # participant + consent + tool/schema versions + machine + capture window
  study.sqlite                  # queryable index over ALL sessions, live + backfill (single-file SQLite DB)
  study-sessions.jsonl          # append-only marker log of EVERY study-session action (start/pause/resume/end/protocol)
  study-sessions/               # one folder per participant "work period" (see below)
    <NNN>-<id>/
      session.json              # timings, running duration, 15-min protocol status, tabs used
      events.jsonl              # the event-stream slice captured during this session's window
      lifecycle.jsonl           # this session's own start/pause/resume/end markers
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
        attachments/             # copies of attachment payloads referenced by the transcript
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

## The four captured streams (per session)

| File | Source | Why it's kept |
|---|---|---|
| `transcript.jsonl` | Claude/Codex raw transcript | Source of truth: prompts, responses, thinking, tool_use/result, **verbatim `message.usage` tokens**, real timestamps, `cwd`, `gitBranch`, versions, mode changes, ai‑title. |
| `hooks.jsonl` | Claude Code hook POSTs | Out‑of‑band signals not clean in the transcript: **permission prompts**, `PostToolUseFailure`, precise per‑hook timing, lifecycle edges. |
| `events.jsonl` | app's normalized `AgentEvent` | Reproduces the rendered visualization without re‑parsing. |
| `environment.json` | runtime host | OS/arch, Node version, Claude Code / Codex versions, `CODEX_HOME`, model ids observed. |

---

## `MANIFEST.json`

```jsonc
{
  "schemaVersion": 1,
  "tool": "agent-flow",
  "toolVersion": "0.8.1",
  "participantId": "P03",          // study-assigned, not PII
  "consent": true,
  "consentAt": "2026-08-10T12:00:00Z",
  "machineId": "sha256(...)[:16]", // stable, non-identifying
  "os": "darwin", "arch": "arm64",
  "captureStartedAt": "2026-08-10T12:00:00Z",
  "sessionCount": 12
}
```

## `session.json` (per session)

```jsonc
{
  "id": "447ffde1-...",
  "runtime": "claude",             // "claude" | "codex"
  "projectPath": "/Users/x/proj",  // from transcript `cwd`
  "gitBranch": "main",
  "ccVersion": "2.1.217",
  "aiTitle": "…",
  "startedAt": "…", "endedAt": "…", "status": "completed",
  "totals": {
    "inputTokens": 0, "outputTokens": 0,
    "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0,
    "toolCalls": 0, "subagents": 0, "turns": 0
  }
}
```

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

**Full fidelity for one session:** read the raw files under
`live/sessions/<runtime>-<id>/` (or `backfill/sessions/<runtime>-<id>/`) —
`transcript.jsonl` is the complete record; each line is one JSON object.
`study.sqlite` is derived from these and safe to regenerate.

**Replay in the visualizer:** point Agent Fruitstand at a session folder to reconstruct
the node‑graph from `transcript.jsonl` (+ `subagents/`, `tool-results/`).

---

## For participants — enabling & sending your data

**Enable capture (one time):** set `agentVisualizer.studyStorage.enabled` to `true`
in VS Code settings (and optionally `agentVisualizer.studyStorage.participantId`).
The first time Agent Fruitstand runs after that, it shows a consent dialog explaining
what is captured; capture only starts once you choose **Enable capture**. Consent
is remembered per workspace. Nothing is ever uploaded automatically.

**Send your data:**

1. In VS Code, run **"Agent Fruitstand: Package Study Data (Zip)"** from the Command
   Palette — it rebuilds the index and produces a `study-storage.zip`. (Or run
   **"Agent Fruitstand: Reveal Study Data Folder"** and compress it yourself.)
2. Send the zip to the researcher via the channel they gave you.

**Note:** this folder contains the full content of your agent sessions —
including your prompts, the model's output, file contents, and command output.
Review it before sending; you can delete any session folder you don't want to
share. Capture only runs after you consent, and nothing is uploaded anywhere
automatically.
