# Changelog

## 1.7.0

- **Data collection is fully local, and richer.** The extension captures your Claude Code hooks, prompts/transcripts, usage metrics, and interactions to the local capture home only — nothing is uploaded anywhere. Share it with the researchers whenever you like via the panel's **Study data → Package (zip)** button.
- **Live status lines are on by default and stay on-device.** Each agent shows a short "[verb-ing] [what]" status derived from its recent activity, computed locally with no network calls. (A model-generated variant only runs if you explicitly configure an OpenRouter key; this build ships without one.)
- **Auto-fit now frames the graph clear of both side rails.** The keep-out insets were wired to the wrong sides, so opening the file/legend panel or selecting an agent would auto-frame the graph *under* the panel that just opened. Selecting a node or opening any panel now reserves the correct column, and the Legend reserves space too.
- **Completed sub-agents stay on the map.** A finished sub-agent now settles to a dimmed, full-size node (dashed border + state badge) instead of fading out and being removed, so the org chart keeps every branch after a child returns — including when you switch into a session tab or scrub the timeline. Sub-agent call-sign numbering is now stable across live viewing and replay.
- **More reliable study-data export.**
  - Re-packaging to an existing zip now overwrites it cleanly. Previously on Linux the archiver *added into* the existing file, so a session you deleted for redaction could still ship in a re-made zip.
  - Windows zipping now handles capture paths containing `[` `]` and other glob characters.
  - If the derived SQLite index can't be rebuilt on the host, the stale/partial index is stripped from the zip so it never ships misleading data (the raw JSONL remains the source of truth).

## 1.6.0

- **Locate and export your study data from the panel.** A new **Study data** menu in the top bar (folds into the overflow menu on narrow widths) reveals the local capture folder or packages it into a zip to send to the researchers — the same actions as the command palette, now one click away.
- **Packaging no longer interrupts capture.** "Package Study Data (Zip)" used to end and mislabel the in-progress session (marking still-running sessions "completed" and truncating the study-session slice) because it flushed via the shutdown path. It now flushes non-destructively, so you can package data mid-study and keep working with the capture intact.
- **Safer transcript rendering.** Links in rendered message/prompt text are now restricted to `http`/`https`/`mailto`; anything else (e.g. a `javascript:`/`data:` URL echoed from a page or file an agent read) renders as plain text instead of a live link.
- **Packaging hardening.** The zip step no longer ships a stale SQLite index when it can't be rebuilt on the host's Node (raw JSONL stays the source of truth), and Windows zipping no longer breaks on capture paths containing quotes or other special characters.
- **Accurate privacy disclosure.** The README now spells out the optional OpenRouter status-line egress (activity metadata, including truncated command text) and how to disable it, instead of implying nothing ever leaves the machine.

## 1.5.0

- **Live agent status lines.** Each agent now carries a short, glanceable status under its name — "guava is debugging server-side auth", "apple is writing checkout tests" — that updates as the agent works. Statuses are generated from the agent's recent activity by a small, fast model via OpenRouter (default `google/gemini-2.5-flash-lite`), with a deterministic, on-device fallback ("editing draw-agents.ts", "searching the code") when the model is off or unreachable. Output is standardized to a very short "[verb-ing] [what]" format.
  - **Opt-in and privacy-scoped.** Off unless enabled (or a key is baked into a study build). When on, only metadata about activity (tool names, truncated arg summaries, file basenames, todo steps) is sent — never raw code or thinking text, unless `sendRawText` is explicitly set. Configure via the `agentFlowStudy.statusSummaries.*` settings.
  - **No wasted credits.** Generation is gated on the on-screen toggle: while the status line is hidden, activity is buffered locally and no model calls are made. Calls are throttled per agent and de-duplicated so a slow response can't double-bill.
- **Subagent nodes now carry a stable, neutral call-sign.** Subagent labels used to be derived from the task and squeezed into a ~3-word budget with a trailing ellipsis ("Explore · map the…"). Subagents now get a value-neutral call-sign with a fixed role — "Guava · Subagent" — matching the non-prescriptive call-sign scheme used for sessions; the internal agent type and the full task description move to the hover tooltip and the detail card. The label is set at the event source, so every surface (canvas node, detail card, message feed, timeline) shows the same name, and a manual rename still overrides it.
  - Call-signs come from a dedicated food-word pool (distinct from the session pool, and free of colour words so they never clash with a subagent's identity colour), assigned per session in spawn order so sibling subagents stay distinct and legible.
- **Interface tidy-ups.** The top-bar "Chat" toggle is now a **Full text** toggle: off keeps the canvas quiet and the conversation feed compact (short bubbles); on reveals the world-space message pop-ups and full message text. Chat is still opened from the collapsed feed pill, by selecting a node, or the `c` shortcut. A **Status** toggle shows/hides the status lines; the per-node token bar moved to the right-click menu. Side panels are now opaque and the graph auto-fits clear of them, so node labels no longer bleed under the panels.

## 1.3.0

- **Interface rebuilt for real editor sizes.** The panel was authored for a wide browser tab and broke down when docked: at a side-bar width the session tabs printed on top of the right-hand controls, the session-clock pill overhung both screen edges (clipping its own digits), and the floating panels stacked on the same corner. Every one of those was reproducible at 360px, 520px, and 760px; none of them remain at any width from 320px up.
  - **Measured layout.** The top bar and bottom dock report their real heights, and every panel positions against those instead of hardcoded offsets (`top: 66`, `window.innerHeight`, and a fixed bottom-left corner were each in use). Panels now live in left/right rails that own placement and width, so a crowded column shrinks its panels — each scrolling internally — rather than letting them overlap.
  - **Adaptive chrome.** Top-bar controls shed decoration, then labels, then fold into an overflow menu; nothing is ever dropped, only relocated. Session tabs compress toward a floor before the strip scrolls, and the controls yield space to them first, so tabs stay usable with six sessions open on a docked column. The selected tab keeps more of its name than its neighbours.
  - **One bottom dock.** The legend launcher, the study clock, and the replay scrubber were three independently positioned bars that could sit on top of each other; they now share one row with real slots. Fixes the replay scrubber running up to 95px past the right edge on mid-width windows.
  - **Consistent controls.** All chrome resolves to two heights and one type scale, with inline SVG glyphs replacing emoji (which rendered at unpredictable sizes and carried their own color). The Global/Tab switch in the conversation panel is a single segmented control that holds its geometry instead of resizing as you switch.
  - Accessibility: keyboard operability and accessible names added to controls that were mouse-only (file rows, the collapsed conversation pill, the close affordance on tabs); scrubber is now an ARIA slider with arrow-key seeking.
- **Removed the "New agent" composer.** The command-builder panel and its templates are gone from the interface.
- Housekeeping: dropped three panels that were unreferenced since the conversation panels were merged, and fixed the workspace filter in the root `build:extension` / `dev:extension` scripts, which had been broken by the extension's package rename.

## 1.1.0

- **Rebrand to Agent Fruitstand** — all user-facing product text (panel, commands, web app title, setup/CLI output, docs) now reads "Agent Fruitstand". Internal identifiers are intentionally unchanged (command IDs, configuration keys under `agentFlowStudy.*`, and the `~/.agent-flow-study` capture folder) so existing participant settings, keybindings, hook configs, and already-captured session data keep working.

## 0.9.1

- Fix: Claude Code session discovery on Windows — workspace-to-project-dir matching is now case-insensitive on win32 (#57, part of #4)
  - VS Code reports drive letters lowercase (`c:\...`) while Claude Code encodes them uppercase (`C--...`), so the encoded-directory lookup, the subfolder-session prefix check, and the cwd containment check could all silently miss — no sessions appeared at all
  - The workspace project dir is now resolved to its actual on-disk casing at startup, and all path comparisons are case-folded on Windows (matching the Codex-side fix from 0.9.0)

## 0.9.0

- **New model support — Claude Fable 5 / Mythos 5, Sonnet 5, Opus 4.8, GPT-5.x Codex** (#57)
  - Context window sizing: `fable`/`mythos` family recognized as 1M context (previously fell back to 200k, showing the gauge 5× overfull); `gpt-*` family recognized as 400k as the fallback when Codex doesn't report its own authoritative window. Sonnet 5 / Opus 4.8 already matched the existing family patterns
  - Cost display: per-model-family blended $/M rates (Fable/Mythos $10/$50, Opus $5/$25, Sonnet $3/$15, Haiku $1/$5, GPT-5.x Codex $1.75/$14) replace the single Sonnet-class rate that was applied to every agent. Agents now carry the detected model ID, and the cost pill, summary panel, and per-tool breakdown all use the owning agent's rate
- **Codex session discovery fixes** — addresses reports of Codex sessions not appearing
  - Windows: workspace/cwd matching is now case-insensitive on win32 (VS Code reports `c:\...`, Codex writes `C:\...` — sessions never matched)
  - Large `session_meta`: the first-line reader now grows up to 1MB instead of a fixed 64KB — newer Codex versions embed full base instructions and AGENTS.md content, which silently broke cwd extraction and skipped the session
  - Silent cwd mismatch: when recent Codex sessions exist but none ran in the current workspace, a warning now says so (the most common cause: launching `npx agent-flow-app` from a different directory than the Codex session). Warnings are visible without `--verbose`
- Fix: assistant messages in Codex sessions were labeled "CLAUDE" in the transcript panels and canvas bubbles — the label now follows the session runtime ("CODEX") (#49)

## 0.8.1

- **Opt-out anonymous usage telemetry** — Agent Flow now tracks whether people come back after day 1 so we can tell whether it's actually useful. Only aggregate session metadata is sent, never prompts, file paths, or code
  - What's sent: session count, duration, event count, OS/arch, Agent Flow version, distinct Claude/Codex model IDs observed during each session, which runtimes were watched (`claude`, `codex`, or `claude,codex`), and error class names on crashes
  - What's NEVER sent: prompts, tool calls, tool responses, file paths, repo names, user name/email/hostname, environment variables, error messages or stack traces
  - Turn off: `export AGENT_FLOW_TELEMETRY=false` or `export DO_NOT_TRACK=1`. Disabled installs write nothing to disk — no `~/.agent-flow/` state file, no telemetry dir
  - Only the published `npx agent-flow-app` binary emits. `pnpm run dev` stays silent so contributor iterations don't land in the data
  - Inspect the exact payload locally: `cat ~/.agent-flow/telemetry/events.jsonl`
- Remove `@vercel/analytics` — conflicts with the first-party-only commitment in the privacy doc

## 0.8.0

- **Codex runtime support** — available in all three entry points: VS Code extension, `pnpm run dev`, and `npx agent-flow-app`. Agent Flow now watches Codex rollouts at `~/.codex/sessions/**/rollout-*.jsonl` alongside Claude Code sessions
  - New `agentVisualizer.runtime` setting (VS Code only): `"auto"` (default, watches both), `"claude"`, or `"codex"`
  - `AGENT_FLOW_RUNTIME` environment variable (`claude` / `codex` / `auto`) gives the same opt-out in `pnpm run dev` and `npx agent-flow-app`
  - Respects `CODEX_HOME` for non-default installs
  - Parses all five Codex rollout record types (`session_meta`, `turn_context`, `response_item`, `event_msg`, `compacted`) — surfaces tool calls (`exec_command`, `apply_patch`, `write_stdin`, `update_plan`), reasoning, web searches
  - Uses Codex's own authoritative token counts (`event_msg.token_count.info.last_token_usage.input_tokens` and `model_context_window`) instead of estimating
  - Handles auto-compaction via the `compacted` event — context gauge resets cleanly instead of staying frozen
  - Filters Codex's IDE-context wrapper (`# Context from my IDE setup:` + `## My request for Codex:`) and pure injections (AGENTS.md, environment_context, turn_aborted) from user messages
- Refactor: new `AgentSessionWatcher` interface and shared watcher→panel wiring (`session-runtime.ts`) replaces per-runtime duplication. The Codex watcher is vscode-free so it works in the relay/CLI without modification
- Parser unit test suite with real-shape rollout fixture — run via `pnpm test`

## 0.7.0

- **Opus 4.7 support** (#43)
  - Context window sizing now uses family-based pattern matching, so new Opus/Sonnet releases (4.7, future 4.x / 5.x) pick up their 1M context without a code change
  - Redacted thinking blocks (Opus 4.7 returns thinking as an encrypted signature by default) now show a "Thinking..." placeholder bubble instead of being silently dropped
- Fix: Windows hook deduplication — `isAgentFlowHook` now normalizes path separators before matching, so old entries are correctly replaced on re-registration (prevents settings.json from accumulating duplicates) (#42)
- Fix: respect `CLAUDE_CODE_DISABLE_1M_CONTEXT` env var and setting — context gauge caps to 200k when set (#39)
- Fix: relay path encoding for non-ASCII workspace paths (CJK, Cyrillic, accented Latin) (#38)
- Fix: duplicate subagent nodes from hook server and transcript parser race (#34)
- Fix: duplicate React key warning on session switch (#33)
- Fix: web app SSE connection failure in standalone dev mode (#32)

## 0.6.2

- Fix: session detection for workspace paths containing underscores or other special characters (#18, #19)

## 0.6.1

- npx support — `npx agent-flow-app` starts the visualizer without cloning the repo
- Internal refactor: shared relay module and build config

## 0.6.0

- Standalone web app — run Agent Flow in the browser without VS Code (`pnpm run dev`)
- pnpm workspace monorepo setup
- VS Code debug and dev configuration
- Fix: event loss from React strict mode double-invocation
- Fix: SSE relay security hardening (localhost-only binding, restricted CORS, bounded event buffer)

## 0.5.0

- Fix: heavy performance degradation during long sessions with many agents (#20)
  - Decouple canvas rendering from React state — canvas reads from a ref at 60fps, React re-renders only on data changes
  - Virtualize transcript and message feed panels for constant render cost regardless of message count
  - Replace timeline panel DOM with canvas rendering
  - Fix tool call cleanup leak that caused unbounded object growth after ~5000 events
  - Fix event log cap causing mass event replay in mock/stress mode
  - Cap simulation loop at 60fps to reduce CPU/GPU usage
- Add stress test scenarios for profiling (`?stress=light|medium|heavy|extreme`)
- Add performance overlay for debugging (`?perf`)
- Fix passive event listener warning when panning canvas
- File attention panel: show agent count instead of full name list

## 0.4.7

- Fix: reset button in review mode no longer breaks the extension
  - Active agents are preserved across reset; only completed state and visual history are cleared
  - Event log is trimmed to retain agent_spawn events so review mode seeking works correctly

## 0.4.6

- Updated README: clarified automatic hook configuration behavior
- Updated description and tagline

## 0.4.5

- Initial public release
- Real-time visualization of Claude Code agent execution flows
- Auto-detection of Claude Code sessions via transcript watching
- Claude Code hooks integration for live event streaming
- Multi-session support with session tabs
- Interactive canvas with agent nodes, tool calls, and particles
- Timeline, file attention, and transcript panels
- JSONL event log file watching
