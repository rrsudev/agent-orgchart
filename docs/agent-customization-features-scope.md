# Scope — Agent customization: color, naming, drag

> **Implementation status (updated):**
> - **Feature 1 (color): IMPLEMENTED.** Card-fill wash with the 6-color
>   non-conflicting palette; persists in localStorage; set via a swatch row in
>   the agent right-click menu. (Chosen over the border/label-dot channel per
>   direction: "do the card fill with non-conflicting colours.")
> - **Feature 3 (drag): tool-follow IMPLEMENTED; pins NOT persisted (by
>   decision).** Dragging an agent now moves its tool cards (and discoveries) with
>   it. Unpin / pin-affordance / position persistence intentionally deferred.
> - **Feature 2 (naming): IMPLEMENTED.** Defaults: main agent/session uses
>   Claude's `ai-title` (else a word-boundary cleaned prompt); subagents show
>   `Type · description`; word-boundary truncation with a single `…` everywhere
>   (killed the `..`). Custom names via double-click a node or context-menu
>   "Rename", persisted in localStorage. Applies to canvas nodes + session tabs.
>   Extension: `constants.ts` (truncateWords/titleCase/formatSubagentDisplayName),
>   `transcript-parser.ts` (ai-title handling + word-boundary labels), `protocol.ts`
>   (subagent displayName + labelFromAiTitle), `subagent-watcher.ts`. Web:
>   `use-agent-names.ts` (new), name overlay in `draw-agents.ts`/`canvas.tsx`,
>   double-click rename in `use-canvas-interaction.ts`, wiring + rename input in
>   `index.tsx`. Tests: `extension/test/naming.test.ts` (9). Known limitation: an
>   `ai-title` already written before capture starts (pre-watch history) isn't
>   picked up live — the cleaned-prompt fallback is used until a new title arrives.
>
> Files touched (features 1 & 3): `web/lib/colors.ts` (palette + `washOverWhite`),
> `web/hooks/use-agent-colors.ts` (new, persistence), `web/hooks/use-agent-simulation.ts`
> (`updateAgentPosition` tool-follow), `web/components/agent-visualizer/canvas/draw-agents.ts`
> (card-fill tint), `canvas.tsx` (agentColors prop), `glass-context-menu.tsx` (custom node item),
> `agent-color-swatches.tsx` (new), `index.tsx` (wiring). Web typechecks + webview build pass.
>
> **Follow-up interface tweaks (done):**
> - Removed the token count from the top-right of the top bar (`top-bar.tsx`).
> - **Unified Chat + Messages + Transcript into one panel** (`message-feed-panel.tsx`)
>   with a Global / Active sub-tab toggle. **Global** is now the full session
>   transcript — every agent's messages AND tool calls merged chronologically,
>   searchable, with per-agent attribution — replacing the old slide-in Transcript
>   panel. **Active** is the selected agent's own thread (incl. tool calls).
>   Selecting a node auto-opens the Active thread. The panel is controlled by
>   `index.tsx`; the top-bar **Chat** button and the `c` key open/close it (Esc
>   closes). The old `chat-panel.tsx` and `session-transcript-panel.tsx` are no
>   longer used (orphaned; safe to delete).
> - Default names are now capped at **≤3 words** (word-count truncation in
>   `constants.ts` `truncateWords`; session label + subagent `Type · desc` both
>   respect the budget) so tabs and nodes don't overfill.
>
> Original scoping follows.

> Status: scoping / design proposal. No code written yet.
> Three requested features for the visualizer's agent nodes:
> 1. **Color-code agents** from a fixed ~6-color palette that fits the design
>    language and doesn't collide with existing color codes; colors persist.
> 2. **Better naming** — custom names for agents/subagents + cleaner defaults
>    (no raw-prompt-with-`...` and no meaningless id suffixes).
> 3. **Better drag** — move agents/subagents freely and have them stay.

All three live in `web/` (the visualizer), with a little plumbing in
`extension/src` for naming defaults. Investigation done against the current code.

---

## 0. Shared foundation (do this once, all three use it)

Two things every feature needs, and both already have a precedent in the code:

### 0.1 A stable per-agent identity key
Today an agent's map key **is its display name**: `handleAgentSpawn` sets
`id: name` (`web/hooks/simulation/handle-agent-events.ts:87`) and stores
`state.agents.set(name, agent)`. Consequences:
- Subagent names derive from the Task `description` (`resolveSubagentChildName`,
  `extension/src/constants.ts:196`) — **not stable or unique across runs**.
- In the parallel/multi-session view, ids are namespaced `sessionId␞name`
  (`use-vscode-bridge.ts:38-58`), so the *same* agent has a different key
  depending on view mode.

For customizations (color / custom name / pinned position) to persist and
re-attach correctly on replay, resume, and across views, we need a key that is
**stable for the life of a logical agent**, independent of its display name:
- Orchestrator → `"orchestrator"` (already stable).
- Subagent → its own id (the `agent-<id>` subagent filename / `.meta.json`
  `toolUseId`), not the description-derived display name.
- Namespace persisted entries by **session id** (matches the session-label
  precedent). Cross-run/per-project carryover is a later enhancement (needs a
  logical-agent identity); per-session is the right first cut.

This is a small, shared prerequisite — call it `stableAgentKey(agent)`.

### 0.2 A persistence layer (localStorage), mirroring session renames
The session-tab rename is the exact template
(`use-vscode-bridge.ts:146-197, 520-539`): a `Map<id, value>` serialized as JSON
under an `agent-orgchart:*` key, lazily read into a ref once, written on every
mutation, guarded with `try/catch` + `typeof window` (SSR), and **overlaid** on
top of bridge/simulation data so the user value always wins.

Proposal: one small hook (e.g. `useAgentCustomizations`) or an extension of
`use-vscode-bridge`, holding a per-session map of
`{ [stableAgentKey]: { color?, customName?, x?, y?, pinned? } }` under a key like
`agent-orgchart:agent-customizations`. All three features read/write it.

> Note on durability: localStorage matches existing precedent and is fine to
> scope against. In the VS Code webview, `webview.setState`/`workspaceState` is
> more durable across reloads — worth considering when wiring, but not a blocker.

### 0.3 A shared UI entry point already exists
Right-click on the canvas already opens a **context menu**
(`use-canvas-interaction.ts`, `handleMouseUp`/contextmenu). That's the natural
home for all three actions on a node: a color swatch row, "Rename", and
"Pin/Release". No new global UI surface required.

---

## 1. Color-coding agents

### 1.1 How color works today
An agent node's color is **purely a function of its state**
(`draw-agents.ts:363-365` → `getStateColor`, `colors.ts:269-279`):

| state | color |
|---|---|
| idle | accent blue `#0071e3` |
| thinking | purple `#5e5ce6` |
| tool_calling | amber `#a15c00` |
| complete | green `#248a3d` |
| error | red `#d70015` |
| waiting_permission | orange `#b45309` |
| paused | ink3 `#6e6e73` |

That one color string paints **only** the squircle's hairline **border**
(`draw-agents.ts:222-223`) and the **state badge** fill (`:318-319`). The card
fill is solid white (`:215`); the brand glyph is ink. Crucially, **state is also
encoded by the badge glyph *shape*** (`drawStateGlyph`, `:237-301`) — so color is
*redundant* for state, which is what makes an identity color safe to add.

### 1.2 The "does not conflict" decision
The six semantic hues (blue/purple/amber/green/red/orange) are **taken** for
status. So a user identity color must NOT reuse the state channel (border+badge)
as its only expression, or it collides. Recommendation:

**Put identity color on an orthogonal channel: a light wash of the node's card
fill (currently pure white), plus a small solid color dot on the name label.**
- The state border + badge + glyph stay exactly as-is → zero conflict with
  status semantics.
- The card-fill wash (identity hex over white at low alpha, ~8–12%) reads as
  "this agent's color" in the Apple soft-tint idiom, and is visually a different
  *role* from the saturated status border even if hues are near.
- The label dot gives a crisp, legible identity marker at a glance and in the
  side panels / tabs.

(Alternative considered — recolor the border/badge with the identity color: fewer
draw changes, and state stays legible via glyph shape, but it visually competes
with the status channel and fights the state cross-fade. Rejected for "does not
conflict.")

### 1.3 Palette (~6 colors)
Because identity renders as a low-alpha wash + a small dot on an **orthogonal
channel**, exact hue-separation from the status palette is not required for
legibility — distinctness *among the six* and fit with the Apple light theme is
what matters. Starting proposal (6-digit hex — required by the `getAgentColor`
lerp contract, `colors.ts:8-22`), chosen to sit in the gaps between the status
hues:

| name | hex | note |
|---|---|---|
| Teal | `#0d9488` | |
| Cyan | `#0e7490` | |
| Olive | `#6b8e23` | yellow-green, off the status green |
| Magenta | `#b5179e` | |
| Pink | `#d6336c` | |
| Slate | `#6b7280` | neutral "no strong hue" option |

Add these as named tokens in `web/lib/colors.ts` (e.g. an `AGENT_PALETTE` array)
and a `getAgentUserColor(key)` helper. **Validate the final six with the
`dataviz` skill's palette validator** (contrast, categorical distinctness, light
+ dark) before committing — that skill exists in this environment for exactly
this.

### 1.4 Data model & draw integration
- Keep color **off** the `Agent` schema (matches the existing convention that
  render-only visual state lives outside the model — see the module-level
  cross-fade map note at `draw-agents.ts:169-171`). Store it in the shared
  customization map (§0.2), read at draw time.
- Draw: in `drawNodeCard` (`draw-agents.ts:215`) replace the white fill with
  `washOver(userColor, white, α)` when a color is set; draw the label dot near
  `agent.name` render (`:332`). Feed the color from a lookup keyed by
  `stableAgentKey`.

### 1.5 UI & persistence
- Context-menu swatch row (§0.3): six swatches + a "clear" chip. Optional
  double-click cycles / a tiny popover.
- Persist via §0.2 keyed by `stableAgentKey`. "Clear" deletes the entry (falls
  back to state-only rendering).

### 1.6 Effort: **Small–Medium.** Palette + wash/dot draw + context-menu swatches
+ persistence. No schema change, no layout impact.

---

## 2. Better agent naming

### 2.1 What's wrong today
- **Orchestrator**: starts as literal `"orchestrator"`, then on the first user
  message is renamed to a **hard 40-char slice** of that message
  (`handle-message-events.ts:21-28`, `LABEL_LEN_NAME=40`) — frequently a
  mid-word cut, then a width-based `…` is *also* appended at draw
  (`draw-misc.ts:6-15`). Two stacked truncations.
- **Session tab label**: default `Session <8 hex>`, upgraded to the first user
  line cut at **14 chars with a literal `'..'`** (`truncateLabel`,
  `transcript-parser.ts:601`, `SESSION_LABEL_MAX=14`). The ugly `..` suffix.
- **Subagents**: the good path uses the Task `description`
  (`resolveSubagentChildName`, cap 30). But the **hook fallback** produces
  `general-purpose-ab75a`-style names (`hook-server.ts:279`) — the meaningless
  id suffix the request calls out.
- No custom names anywhere; `Agent` has a single mutable `name` field
  (`agent-types.ts:15-45`), no `customName`, and names aren't persisted.

### 2.2 Recommended default-naming conventions (the "report back")
Principles: prefer a **purpose-built title** over raw prompt text; truncate on
**word boundaries** with a single real ellipsis `…` (never mid-word, never
`..`); always keep the full text in `task`/tooltip so nothing is lost.

**Orchestrator / session name — priority order:**
1. **`aiTitle`** (Claude Code's own `ai-title` transcript entry) when present.
   This is the biggest win: it's a clean 3–8 word title (e.g. *"Design logging
   system with JSONL to database integration"*). It's already parsed in
   `study-index.ts:212` but **not surfaced to the live label path** — wiring the
   session-watcher/parser to read `ai-title` is the main task here.
2. **Cleaned first user prompt** — first sentence or first ~6 words / ~48 chars
   on a word boundary, system/markdown stripped (`extractUserMessageText`
   already strips system-injected content), `…` only if truncated.
3. **`Session <short-id>`** — final fallback.
   Session *tab* uses a shorter word-boundary form (~20 chars, `…`, drop the
   `..`).

**Subagents — priority order:**
1. **`<Type> · <short description>`** — Title-cased `agentType` + a word-boundary
   ~24-char slice of `description` (e.g. *"Explore · event data flow"*). Both
   fields are already available (transcript `description`/`subagent_type`;
   `.meta.json` `agentType`+`description`).
2. **Title-cased `agentType`** alone (e.g. *"General Purpose"*, *"Code
   Reviewer"*) when there's no description.
3. If neither: Title-cased type + a short ordinal (*"Explore 2"*) — **never** the
   `-ab75a` id suffix in the visible name (keep the id only as a tooltip /
   disambiguator). Fix the hook fallback at `hook-server.ts:279` accordingly.

**Global hygiene:** replace char-count hard slices with a shared
word-boundary truncator; use one real `…`; keep `..` out entirely.

### 2.3 Custom names
- Add a `customName` overlay in the shared customization map (§0.2), keyed by
  `stableAgentKey`; the overlay wins over the computed default (exactly like
  `withCustomLabel`, `use-vscode-bridge.ts:193-197`).
- UI: double-click the node label to edit inline (reuse the session-tab rename
  UX, `session-tabs.tsx:48-63,123-147`) and/or a "Rename" context-menu item.
- Keep `Agent.id`/map key stable; only the rendered label changes — safe because
  conversations/edges/tools are keyed by id, not name (confirmed).

### 2.4 Effort: **Medium.** Defaults split across extension (surface `aiTitle`;
fix subagent fallback; shared word-boundary truncator) and web (custom-name
overlay + inline edit). The `aiTitle` wiring is the highest-value, lowest-risk
piece and could ship first on its own.

---

## 3. Better drag

### 3.1 What already exists (≈80% done)
Dragging + pinning is implemented end-to-end:
- `Agent.pinned` (`agent-types.ts:29`), initialized `false` at spawn
  (`handle-agent-events.ts:93`).
- Mouse handlers hit-test an agent and drag it
  (`use-canvas-interaction.ts:78-176`; hit-test `hit-detection.ts:14-26`).
- On drag, `updateAgentPosition` (`use-agent-simulation.ts:357-369`) sets
  `pinned:true` and the live d3 node's `fx/fy`; the force tick **skips pinned
  nodes** (`:70`) and `syncForceSimulation` fixes `fx/fy` from `pinned`
  (`:96-97`). Screen→world via `use-canvas-camera.ts:177-186`.

### 3.2 Gaps to close
1. **No un-pin path.** `pinned` is only ever set true (drag) / false (spawn).
   Add "Release to layout" (context menu §0.3): set `pinned=false`, clear the d3
   node's `fx/fy`, `sim.alpha(0.3).restart()`.
2. **Pins/positions aren't persisted.** They live only in `frameRef`/React
   state; `restart()` and `seekToTime` (`use-agent-simulation.ts:315-399`)
   rebuild agents and **drop pins**. Persist `{x, y, pinned}` per
   `stableAgentKey` via §0.2, and re-apply on spawn/replay (set `x/y`, `pinned`,
   and the d3 `fx/fy`). This is what makes them "stay where placed" across
   reloads and replays.
3. **No visual pin affordance.** Add a small pin glyph in `drawAgents` when
   `pinned` (so users know it's held and can release it).
4. **(Optional) Tool/discovery nodes aren't draggable.** Only agents are
   hit-tested for drag; tool cards are placed deterministically by `findToolSlot`
   and have no pin fields. Lower priority; would need pin fields on
   `ToolCallNode` + wiring. Recommend deferring unless requested.

### 3.3 Effort: **Small** for the core polish (un-pin + persistence + affordance),
since the hard part (drag + fx/fy + tick guard) is already there. Tool-node
dragging is a separate Medium add-on.

---

## 4. Suggested sequencing

1. **Shared foundation (§0):** `stableAgentKey` + the `useAgentCustomizations`
   persistence hook + confirm the context-menu entry point. Unblocks all three.
2. **Drag polish (§3.2 items 1–3):** highest ratio of value to effort — the
   mechanism already works; add un-pin, persistence, and the pin icon.
3. **Naming defaults (§2.2):** surface `aiTitle`, fix the subagent hook
   fallback, add the shared word-boundary truncator (kills the `...`/`..`).
4. **Color (§1):** palette (validate via `dataviz`) + card-fill wash + label dot
   + swatch menu.
5. **Custom names (§2.3):** inline rename overlay.
6. *(Optional later)* per-project/logical-agent carryover; draggable tool nodes.

## 5. Decisions to confirm
- **Color channel:** card-fill wash + label dot (recommended) vs. recoloring the
  state border/badge. (Recommendation: wash + dot — no status conflict.)
- **Persistence granularity:** per-session (recommended first cut, matches
  session-label precedent) vs. per-project/logical-agent (needs stable logical
  identity; later).
- **Final 6-color palette values** (validate with the `dataviz` skill).
- **Scope of drag:** agents only (recommended) vs. also tool/discovery cards.

### File reference map
- Color draw: `web/components/agent-visualizer/canvas/draw-agents.ts:215,222-223,318-319,332,363-365`; palette `web/lib/colors.ts`.
- Naming (web): `web/hooks/simulation/handle-message-events.ts:21-28`; truncation `web/components/agent-visualizer/canvas/draw-misc.ts:6-15`; model `web/lib/agent-types.ts:15-45`.
- Naming (extension): `extension/src/constants.ts:196` (`resolveSubagentChildName`), `hook-server.ts:279` (fallback), `transcript-parser.ts:560-616` (`extractSessionLabel`/`truncateLabel`), `study-index.ts:212` (`aiTitle`).
- Drag/layout: `web/hooks/use-agent-simulation.ts:55-110,357-369`, `web/hooks/use-canvas-interaction.ts:78-203`, `web/hooks/use-canvas-camera.ts:177-186`, `web/components/agent-visualizer/canvas/hit-detection.ts:14-26`.
- Persistence precedent: `web/hooks/use-vscode-bridge.ts:146-197,520-539`; rename UI `web/components/agent-visualizer/session-tabs.tsx:48-63,123-147`.
