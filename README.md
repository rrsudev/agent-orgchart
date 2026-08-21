# Agent Fruitstand

**Beta.** A lightweight local companion that lays out your Claude Code agents as
they branch, work, and hand off — right inside your editor. Point it at a live
session and the run stops being a wall of scrolling text: you get an interactive
map of who spawned whom, which tools fired, and where the work is going.

This is a research build. It runs on your machine and keeps a local copy of the
sessions you run while it's open. Captured session data is **never uploaded
automatically** — you send it to the researchers yourself with the **Package
Study Data (Zip)** command.

The one exception is the optional **live status lines** under each agent
("guava is debugging server-side auth"). When this feature is on — it ships
**enabled** in the study build — a small amount of *activity metadata* is sent to
[OpenRouter](https://openrouter.ai) to phrase the status: tool names, truncated
argument summaries (which include the first ~80 characters of a shell command),
Grep/Glob patterns, and TodoWrite steps. Raw file contents and the agent's
thinking/assistant text are **not** sent unless you explicitly enable
`agentFlowStudy.statusSummaries.sendRawText`. This egress is disclosed in your
study consent; to disable it entirely, set
`agentFlowStudy.statusSummaries.enabled` to `false` (the status line then falls
back to an on-device, no-network summary).

---

## Install

Agent Fruitstand is distributed as a `.vsix` you sideload into VS Code (or a
compatible editor — Cursor, Windsurf, 1.85+).

- **From the editor:** Extensions view → `⋯` menu → **Install from VSIX…** → pick
  the `.vsix` file.
- **From the CLI:** `code --install-extension agent-flow-study-1.6.0.vsix`

## Use it

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run
   **Agent Fruitstand: Open Agent Fruitstand** — or press `Cmd+Alt+A` /
   `Ctrl+Alt+A`.
2. Start a Claude Code session in the same workspace. Agent Fruitstand
   auto-detects it and begins drawing.

Hooks are configured for you the first time you open the panel. To redo that by
hand, run **Agent Fruitstand: Configure Claude Code Hooks**.

Pan and zoom the canvas, click a node to inspect an agent, click a tool call to
see its payload, and use the timeline and transcript panels to replay what
happened.

## Where your data lives

Capture is **on by default**, on **every** way you run the tool, so no session is
lost. Everything stays **local and scoped to the workspace you're in**:

- **VS Code build:** each workspace is written to its own subfolder under a
  central home (`~/.agent-flow-study/<workspace>/`), kept out of your repos and
  preserved even if you uninstall.
- **Standalone / relay run:** capture lands in `<workspace>/study-storage/`
  (auto-added to `.gitignore`).

Each session folder holds a verbatim transcript, subagent transcripts, raw hook
payloads, the normalized event stream, and an environment snapshot. When you're
ready to hand data to the researchers, run **Agent Fruitstand: Package Study
Data (Zip)** and send the resulting archive. **Reveal Study Data Folder** opens
the capture location in your file explorer.

To pause capture, set `agentFlowStudy.studyStorage.enabled` to `false`.

## Commands

| Command | Description |
|---------|-------------|
| `Agent Fruitstand: Open Agent Fruitstand` | Open the visualizer panel |
| `Agent Fruitstand: Open Agent Fruitstand to Side` | Open in a side editor column |
| `Agent Fruitstand: Connect to Running Agent` | Manually connect to a session |
| `Agent Fruitstand: Configure Claude Code Hooks` | Set up hooks for live streaming |
| `Agent Fruitstand: Reveal Study Data Folder` | Open the local capture folder |
| `Agent Fruitstand: Package Study Data (Zip)` | Bundle captured data to send |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentFlowStudy.runtime` | `"auto"` | Which runtime(s) to watch: `"auto"`, `"claude"`, `"codex"` |
| `agentFlowStudy.autoOpen` | `false` | Auto-open when a session starts |
| `agentFlowStudy.studyStorage.enabled` | `true` | Capture local copies of sessions |
| `agentFlowStudy.studyStorage.path` | `""` | Override the capture folder |
| `agentFlowStudy.studyStorage.participantId` | `""` | Participant id recorded in the manifest |
| `agentFlowStudy.eventLogPath` | `""` | Tail a JSONL event log instead of live hooks |

## Requirements

- [Node.js](https://nodejs.org/) 20+
- Claude Code CLI
- A VS Code-compatible editor 1.85+

## Notes

Agent Fruitstand is a beta research tool, tuned for capture fidelity over
performance, and is not a production or general-purpose product. It builds on
open-source components distributed under the Apache 2.0 license — see
[LICENSE](LICENSE).
</content>
</invoke>
