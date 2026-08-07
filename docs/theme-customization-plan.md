# Theme Customization Plan — LLM Agent Visualizer (`web/`)

A concrete, phased plan for making the app's visual theme easy to customize —
recolor the accent, swap presets, add a runtime switcher, and (optionally) tune
fonts, glow, and corner radius — without breaking the Canvas 2D rendering or the
React/DOM overlay.

All paths are relative to `/Users/rrsu/agent-orgchart/`. Line numbers reflect the
files as read during planning and may drift as the code changes.

---

## 1. Current state and why theming is hard today

The app is a full-screen "holographic HUD": a Canvas 2D scene (`web/components/agent-visualizer/canvas/draw-*.ts`, `background-layer.ts`, `bloom-renderer.ts`) with a React/DOM overlay of glass panels (`web/components/agent-visualizer/*.tsx`). It is hard-coded dark-only.

There are **two parallel token systems**, and the one that actually drives the look is the raw one.

### 1a. The real design system: `COLORS` in `web/lib/colors.ts`

`web/lib/colors.ts:11-218` defines a single large `COLORS` object of **hard-coded literal color strings** — hex (`#66ccff`), full `rgba(...)`, partial rgba bases for runtime alpha (`'rgba(10, 15, 30,'`, lines 124-131), gradients, and box-shadow strings. Alongside it: `ROLE_COLORS` (222-226), `getStateColor()` (230-240), `getDiscoveryTypeColor()` (242-249), `withAlpha()` (252-254), and `contextSegments()` (257-265).

This object is imported by **31 files** — both layers consume it directly:

- **DOM layer**: `~19` `.tsx` components apply it via inline `style={{}}` (e.g. `web/components/agent-visualizer/shared-ui.tsx:31`, `139-147`).
- **Canvas layer**: the `draw-*.ts` modules assign it straight onto the 2D context each frame, e.g. `web/components/agent-visualizer/canvas/draw-agents.ts:74` (`ctx.fillStyle = COLORS.cardBgDark`), `:105`, `:225`; `web/components/agent-visualizer/background-layer.ts:50,73,109`.

Why that makes customization hard:

1. **The canvas cannot read CSS variables.** `ctx.fillStyle`/`strokeStyle` need a concrete color *string* every frame. There is no `var(--x)` resolution in the Canvas 2D API, so any theming for the canvas must resolve to plain strings in JS. This is the central constraint of the whole effort.
2. **A hidden hex-string contract.** Draw code appends a 2-digit hex alpha directly to color strings — `color + '25'`, `color + '60'`, `color + '90'` in `draw-agents.ts:197,229,245`, and `COLORS.holoBase + alphaHex(alpha)` in `background-layer.ts:73`. This **requires 6-digit hex** for those specific tokens; you cannot swap them to `rgb()`/`oklch()` or named colors without breaking string concatenation. Similarly, `withAlpha()` (`colors.ts:252`) depends on the "partial rgba base" convention (`colors.ts:124-131`).
3. **Literals are scattered inside values, not derived.** The accent (`#66ccff` / "rgb(100,200,255)") is re-encoded dozens of times across `COLORS` — as hex, as `rgba(100,200,255,a)` at many alphas, and again as raw literals in `web/app/globals.css:129-195` (glass card, inputs, scrollbars). There is **no single accent variable**; recoloring means editing many values that all *mean* "the accent."
4. **No toggle, no presets, dark-only.** `web/app/layout.tsx:33-34` hard-codes `<html className="dark">` and `body ... bg-[#0a0a1a]`. There is no `next-themes`, no state, no way to pick a theme at runtime. `COLORS` is `as const` (`colors.ts:218`) — a frozen compile-time singleton with no swap point.

### 1b. The dormant system: shadcn / Tailwind v4 OKLCH tokens in `globals.css`

`web/app/globals.css:6-116` defines a full shadcn palette: `:root` (light) and `.dark` OKLCH variables wired through `@theme inline`. These power only Tailwind utility classes like `bg-background`/`text-foreground` (`:118-125`). Because the app draws almost everything from `COLORS` and inline styles instead of these utilities, **this layer is largely inert** — editing `--primary` etc. changes almost nothing visible. It is a stock scaffold (note `generator: 'v0.app'` in `layout.tsx:6`) that was never reconciled with the real palette.

### 1c. Non-color tokens

- **Geometry / animation / glow**: `web/lib/canvas-constants.ts` — glow blur/padding in `AGENT_DRAW` (`:196-239`), `TOOL_DRAW` (`:285-304`), `SPAWN_FX`/`COMPLETE_FX`/`PARTICLE_DRAW` (`:354-387`); numeric `borderRadius` per shape (e.g. `TOOL_DRAW.borderRadius` `:287`, `BUBBLE_DRAW.borderRadius` `:349`).
- **Z-index / timing**: `web/lib/agent-types.ts:194-215` (`Z`, `TIMING`).
- **Fonts**: `--font-sans`/`--font-mono` reference `'Geist'`/`'Geist Mono'` (`globals.css:78-79`) but **no font is ever loaded** — there is no `next/font` import anywhere (`layout.tsx` never imports a font; the only reference is `className="font-sans"` at `:34`). So text falls back to system fonts, and the canvas hard-codes `'…px monospace'` in every draw call (e.g. `draw-cost.ts:61,186,192`; `draw-bubbles.ts:38`; `draw-discoveries.ts:66,72`).

---

## 2. Recommended target architecture

**Make `COLORS` a runtime-swappable theme object that is the single source of truth for both layers, and mirror only its top-level *seed* tokens into CSS variables for the handful of DOM styles written in `globals.css`.**

### The core tension and the verdict

- The **DOM layer** *could* be themed purely with CSS variables (cheap, no re-render, instant switch).
- The **Canvas layer** *cannot* — it needs concrete strings per frame. Options are (a) keep a JS theme object, or (b) read computed CSS-variable values back into JS via `getComputedStyle(document.documentElement).getPropertyValue(...)`.

**Recommendation: a JS theme object is the primary source of truth; CSS variables are a thin projection of it.** Reasons:

1. The codebase already routes ~all rendering through the `COLORS` **JS object**, consumed identically by both layers. Keeping JS authoritative means the canvas needs *zero* new indirection, and DOM inline styles keep working unchanged.
2. Reading CSS vars into JS every frame (`getComputedStyle`) is comparatively expensive and forces string parsing (OKLCH → canvas-usable string) — the wrong direction given the hex-concat contract in §1a.2. Canvas wants hex/rgba it can concatenate; CSS-first would fight that.
3. A JS object gives type safety (`as const` today), supports **named presets**, and can drive a `<meta>`/localStorage switcher with a single state value.

So: **JS object → (on theme change) write a small set of CSS custom properties for the DOM-only CSS in `globals.css`.** Not every one of the ~150 `COLORS` keys needs a CSS var — only the ~8 literals hard-coded in `globals.css:127-195` (glass bg/border/highlight, input bg/border/text, scrollbar thumb).

### Shape of the target

Introduce a `Theme` type = the current `COLORS` shape, and a set of **preset objects** keyed by name:

```
web/lib/themes.ts
  export type Theme = typeof holoCyan            // structural shape (all keys)
  export const holoCyan: Theme = { ...current COLORS... }
  export const holoGreen: Theme = { ... }
  export const holoAmber: Theme = { ... }
  export const THEMES = { holoCyan, holoGreen, holoAmber } as const
  export type ThemeName = keyof typeof THEMES
```

Keep `web/lib/colors.ts` as the **helpers + active-theme accessor** module so the 31 importers barely change. Two migration styles, in increasing effort:

- **Phase-1 (fast, low-risk)**: keep `export const COLORS` but make it point at the active preset chosen at module load (from `localStorage`/URL). No consumer changes. Switching requires reload. This already delivers presets + easy recolor.
- **Phase-2 (runtime switch)**: replace the frozen `COLORS` singleton with a live accessor so both layers read whatever the current theme is without a reload (details in §3b).

Because the draw code relies on the **hex-string / partial-rgba conventions**, every preset must honor the same encoding per key (6-digit hex where alpha is concatenated; `'rgba(r,g,b,'` partial bases for `withAlpha`). Document this in `themes.ts` so preset authors don't break `draw-agents.ts:197` etc.

---

## 3. Phased, incremental steps

### Phase 0 — Derive the accent (prep, no behavior change)

Before presets, reduce duplication so a preset is small to write.

- In `web/lib/colors.ts`, introduce local seed constants at the top: `const ACCENT_RGB = '100, 200, 255'`, `const ACCENT_HEX = '#66ccff'`, plus the amber/green/purple/red seeds. Rebuild the many `rgba(100, 200, 255, x)` / `#66ccff` literals (lines 44-217) as template strings off those seeds (e.g. `holoBg10: \`rgba(${ACCENT_RGB}, 0.1)\``).
- **Effort**: M (mechanical but touches ~120 lines). **Risk**: Low-Med — value drift if a literal is mistyped. **Test**: snapshot the app before/after; the rendered output must be pixel-identical (no theme has changed yet). Verify the hex-concat tokens (`holoBase`, `textPrimary`, state colors) stay 6-digit hex.

### Phase 3a — Quick win: swappable `COLORS` + named presets (load-time switch)

Goal: a user can pick a preset (or hand-edit one accent block) and get a fully recolored app on reload.

1. Create `web/lib/themes.ts` with `Theme`, the current palette as `holoCyan`, and 1-2 alternates (`holoGreen`, `holoAmber`) built by swapping only the seed constants from Phase 0. Add `THEMES` map + `ThemeName`.
2. In `web/lib/colors.ts`, resolve the active preset once at module load:
   - read `localStorage['agent-viz-theme']` and/or a `?theme=` URL param (guard `typeof window`), fall back to `holoCyan`.
   - `export const COLORS = THEMES[activeName]` and keep `ROLE_COLORS`, `getStateColor`, `withAlpha`, etc. deriving from it. **All 31 importers keep working untouched.**
3. Mirror the DOM-only literals: in `globals.css:127-195`, replace hard-coded `rgba(100,200,255,…)` / `#aaeeff` with `var(--glass-bg)`, `var(--glass-border)`, `var(--accent-rgb)`, etc., and set those vars once in `layout.tsx` (or a tiny client init) from the active theme.
4. Add the key to the localStorage-keys section in `web/lib/canvas-constants.ts:44-46` (next to `SOUND_PREF_KEY`).

- **Effort**: M. **Risk**: Low — default preset reproduces today's look exactly; switching is opt-in. **Test**: load `?theme=holoGreen`; confirm both canvas (agent nodes, edges, particles, background hex grid, bubbles, cost pills) and DOM panels (glass cards, inputs, scrollbars, session tabs) recolor consistently; confirm default is unchanged.

### Phase 3b — Runtime theme switcher (no reload)

Goal: a control-bar dropdown that swaps themes live for both layers.

1. **Make the active theme mutable.** Replace the frozen `export const COLORS` with a live object the renderer reads each frame. Lowest-churn approach: keep the name `COLORS` but back it with a mutable module-level `let active: Theme` and a `setTheme(name)` that reassigns fields. Two viable implementations:
   - **(a) Mutate in place**: `Object.assign(COLORS, THEMES[name])` — preserves the existing import identity so no consumer changes; canvas picks up new values on the next `requestAnimationFrame` automatically (the loop already reads `COLORS.*` fresh each frame — see `draw-agents.ts`). Simplest.
   - **(b) Proxy/getter accessor** `getColors()` — cleaner but requires touching all 31 importers. Not worth it; prefer (a).
2. **State + persistence**: add a `useTheme` hook (React state + `localStorage` + `document.documentElement` CSS-var writes) high in the tree, e.g. in `web/components/agent-visualizer/index.tsx` (already imports `COLORS`). On change: call `setTheme()` (drives canvas) **and** update the CSS vars from §3a.3 (drives DOM CSS in `globals.css`). Inline-style DOM (`shared-ui.tsx` etc.) picks up new values on React re-render triggered by the state change.
3. **UI**: add a theme selector to `web/components/agent-visualizer/control-bar.tsx` or `top-bar.tsx` (both already import `COLORS`), styled with the existing toggle tokens (`COLORS.toggleActive/Inactive/Border`).
4. **Force a canvas repaint** on switch if the loop can idle — trigger one frame after `setTheme` so a paused scene updates immediately.

- **Effort**: M-L. **Risk**: Med — must ensure (i) inline-style components re-render on switch (React state dependency), (ii) any cached canvas layers invalidate. Check `web/components/agent-visualizer/canvas/render-cache.ts` and `bloom-renderer.ts` for cached color state that must be cleared on theme change. **Test**: switch live while a scenario plays; verify no stale colors in cached/bloom layers, DOM and canvas stay in sync, and the choice persists across reload.

### Phase 3c — (Optional) reconcile the dormant shadcn OKLCH layer

Only worth doing if you plan to adopt shadcn components or a true light mode.

- **Cheap**: leave `globals.css:6-116` as-is; it's harmless. Document that it is NOT the app palette to prevent future confusion.
- **Fuller**: make the shadcn `--primary`/`--accent`/`--background`/`--border` (and `.dark`) **derive from the active theme's seeds** so utility-class usage matches the HUD. Since the app is dark-only, either delete the light `:root` block or make Phase 3b able to write both. A genuine **light theme** is a large effort: canvas backgrounds (`COLORS.void`, `hexGrid`, glow-on-dark assumptions in `bloom-renderer.ts`) and glassmorphism are designed for dark; a light preset needs its own hand-tuned canvas colors, not just inverted DOM tokens.
- **Effort**: S (document) → L (real light mode). **Risk**: Low → High. **Test**: if adding light mode, full visual QA of canvas *and* DOM in both modes; watch bloom/glow legibility on light backgrounds.

### Phase 3d — (Optional) themable fonts, type scale, glow, radius

1. **Fonts (fix the dead declaration)**: actually load the fonts with `next/font`. In `web/app/layout.tsx`, import `Geist`/`Geist_Mono` from `next/font/google` (or `next/font/local`), apply their `.variable` classes on `<html>`, and point `--font-sans`/`--font-mono` (`globals.css:78-79`) at the injected variables. For the **canvas**, the `'…px monospace'` strings are hard-coded in every draw call (`draw-cost.ts:61,186,192,219,236,261`; `draw-bubbles.ts:38`; `draw-discoveries.ts:66,72`, etc.). Introduce `CANVAS_FONT.mono` / `CANVAS_FONT.baseSizes` in `web/lib/canvas-constants.ts` and replace the literals so both DOM and canvas share one family. Note: to use a custom canvas font you must ensure it's loaded (`document.fonts.ready`) before first paint or text reflows.
2. **Type scale**: centralize the tiny sizes (`BUBBLE_DRAW`, `CONTEXT_BAR.fontSize`, `TOOL_DRAW.fontSize`, `STATS_OVERLAY.fontSize` in `canvas-constants.ts`) behind a single `scale` multiplier so users can bump legibility.
3. **Glow intensity**: expose a `glowScale` multiplier applied to shadow-blur / glow-padding tokens — `AGENT_DRAW.shadowBlur/glowPadding` (`:203-207`), `CONTEXT_RING.glowBlur` (`:268`), `TOOL_DRAW.errorGlow*` (`:296-297`), `SPAWN_FX/COMPLETE_FX/PARTICLE_DRAW` — plus the CSS `box-shadow` blur in `globals.css:135-137,176` and the box-shadow tokens in `colors.ts:113,117`. Also check `bloom-renderer.ts` for a global bloom strength knob.
4. **Corner radius**: the DOM uses shadcn `--radius` (`globals.css:31`) but the canvas hard-codes per-shape radii (`TOOL_DRAW.borderRadius:287`, `BUBBLE_DRAW.borderRadius:349`, `CONTEXT_BAR.borderRadius:249`, glass-card `border-radius:8px` at `globals.css:133`). Introduce a single `RADIUS` base in `canvas-constants.ts` and derive these + wire `globals.css` to `--radius` for one knob.

- **Effort**: Fonts S-M; scale/glow/radius M. **Risk**: Med — canvas font loading timing and layout math that assumes current pixel metrics (`getDiscoveryCardDimensions` in `canvas-constants.ts:171`, hit-detection char widths `HIT_DETECTION:419`). **Test**: verify text isn't clipped in bubbles/tool cards after font/scale changes; verify hit-testing still lines up with rendered card sizes.

---

## 4. Effort / risk summary

| Phase | What | Effort | Risk | Primary test focus |
|-------|------|--------|------|--------------------|
| 0 | Derive accent from seed constants in `colors.ts` | M | Low-Med | Pixel-identical before/after; hex-concat tokens stay 6-digit hex |
| 3a | Presets + load-time swap + CSS-var mirror | M | Low | `?theme=` recolors both layers; default unchanged |
| 3b | Runtime switcher (no reload) | M-L | Med | Live switch sync DOM↔canvas; clear render/bloom caches; persistence |
| 3c | Reconcile shadcn / real light mode | S→L | Low→High | Full canvas+DOM QA in both modes; glow legibility on light |
| 3d | Fonts + type scale + glow + radius knobs | S→M | Med | No text clipping; hit-testing matches sizes; font load timing |

**Cross-cutting tests every phase must run**: (1) canvas scene — agent nodes, state colors (`getStateColor`), edges/particles, background hex grid (`background-layer.ts`), message bubbles, tool cards, cost pills/panel, discovery cards, spawn/complete effects, bloom; (2) DOM panels — glass cards, inputs/placeholders/focus (`globals.css:158-177`), custom scrollbars (`:180-195`), session tabs, control/top bars, transcript & message-feed panels, detail popups; (3) since the app is dark-only, "light vs dark" testing applies **only if** Phase 3c real light mode is attempted — otherwise verify dark stays dark and `layout.tsx:33-34` isn't regressed.

---

## 5. Minimal recipe — recolor the accent (cyan → green or orange)

Fastest path with **no architecture change**, for a user who just wants a different accent. Edit two files. Keep every token's *encoding* the same (6-digit hex where alpha is concatenated; keep the `rgba(r, g, b,` partial-base format for the canvas bases).

The accent today is cyan `#66ccff` ≈ `rgb(100, 200, 255)`. Pick a replacement, e.g. **green** `#66ff99` ≈ `rgb(100, 255, 150)`, or **orange** `#ff9944` ≈ `rgb(255, 150, 70)`.

### A. `web/lib/colors.ts`

Replace the cyan hex and the `100, 200, 255` rgb triple everywhere they encode the accent:

1. Primary hologram + states that reuse the accent: `holoBase` (:17), `idle`/`thinking` (:22-23), `message` (:34), `contextUser` (:38), `discoveryFile`/`filePathActive` (:79,204). Set these to your new hex.
2. Text tints derived from the accent hex: `textDim` (:46, `#66ccff90`), `textMuted` (:47, `#66ccff50`), plus `assistantLabel` (:165), `filePathInactive` (:205), `todoPending` (:208), `panelLabel`/`panelLabelDim`/`scrollBtnText` (:214-216). Swap the hex, keep the trailing alpha digits.
3. All `rgba(100, 200, 255, x)` accent tokens — glass/holo/panel/toggle/tab/play/scrubber/bar groups: `glassBorder`/`glassHighlight` (:51-52), `holoBg03..holoBorder12` (:55-61), `panelSeparator` (:65), `toggle*` (:68-70), `tab*` (:85-88), `playBtn*` (:110-113), `scrubber*`/`reviewBtnBorder` (:116-118), `barFillMain` (:153), `scrollbarThumb` (:217). Replace `100, 200, 255` with your new rgb triple; keep each alpha.
4. Canvas partial-rgba base that uses the accent: `toolCardSelectedBase` (:130) and `cardBgSelectedHolo` (:138). Keep the `rgba(r, g, b,` / trailing-comma shape.

Leave the semantic non-accent colors alone unless you want them themed too: `tool_calling`/amber, `complete`/green, `error`/red, `dispatch`/purple and their derived groups (context, role bubbles, diff, live indicator).

Tip: after Phase 0 this whole section collapses to editing **one** `ACCENT_RGB` + `ACCENT_HEX` pair.

### B. `web/app/globals.css`

The glass CSS hard-codes the accent independently — update it to match:

- `.glass-card` border `rgba(100, 200, 255, 0.15)` (:132) and inset highlight `rgba(100, 200, 255, 0.08)` (:137).
- `.glass-card::before` gradient stop `rgba(100, 200, 255, 0.15)` (:150).
- Inputs: background `rgba(100, 200, 255, 0.05)` (:161), border `rgba(100, 200, 255, 0.15)` (:162), text `#aaeeff` (:164), placeholder `rgba(102, 204, 255, 0.3)` (:169), focus border/glow `rgba(102, 204, 255, …)` (:174,176).
- Scrollbar thumb `rgba(100, 200, 255, 0.15)` and hover `0.25` (:189,194).

### C. (Optional) background

If you want the void/grid to shift too, adjust `void` (:13) and `hexGrid` (:14) in `colors.ts` — but the dark base usually reads fine with any accent, so leave them for a first recolor.

**Verify**: reload and check both a live/mock scenario on the canvas (nodes, edges, bubbles, cost pills glow in the new accent) and the DOM panels (glass borders, input focus ring, scrollbars). The two must match — because they are edited independently in A and B, a mismatch here is the #1 thing to catch, and is exactly what Phase 3a's CSS-var mirror eliminates permanently.
