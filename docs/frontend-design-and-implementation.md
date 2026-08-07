# Front-End Design & Implementation

_A map of the `agent-orgchart` web front end: its design language and how designs are turned into UI. All paths are relative to the repo root; the front end lives entirely in `web/`._

## Overview

The front end is a single full-screen **"LLM Agent Visualizer"** — a real-time, canvas-rendered holographic graph of agent execution. The same React app builds three ways:

- **Next.js App Router** for standalone/dev (`web/app/layout.tsx`, `web/app/page.tsx`).
- **Vite library build → VS Code webview** (`web/vite.config.webview.ts`, shared factory in `web/vite.config.shared.ts:11-63`, entry `web/webview-entry.tsx`).
- **Vite standalone app** with an SSE/relay bridge (`web/vite.config.app.ts`, entry `web/app-entry.tsx`).

Stack: **React 19.2 + Next.js 16.1 + TypeScript 5.7** (`web/package.json:12-33`), strict mode (`web/tsconfig.json:15`), path alias `@/* → ./*`. Scaffold originated from Vercel **v0.app** (`web/app/layout.tsx:6`).

---

## Design language — "holographic mission-control HUD"

The aesthetic is a **dark, dense, cyberpunk/holographic HUD**: near-black void background, a subtle hex grid, drifting depth particles for parallax, and everything glowing cyan with additive **bloom**. UI chrome is **glassmorphism** — translucent dark cards with `backdrop-blur(20px)`, thin cyan hairline borders, a top highlight gradient, and custom 4px cyan scrollbars (`web/app/globals.css:127-195`).

### Color system — two layers, one real

**(a) Dormant shadcn / Tailwind v4 token layer.** `web/app/globals.css:6-116` defines the full standard shadcn neutral token set in **OKLCH** for `:root` (light) and `.dark` — `--background`, `--foreground`, `--card`, `--primary`, `--destructive`, `--border`, `--ring`, `--chart-*`, `--sidebar-*` — wired into Tailwind via `@theme inline`. Base color is `neutral` (`web/components.json:9`). In practice the app hard-codes `.dark` on `<html>` and paints the body `#0a0a1a` (`web/app/layout.tsx:31-34`); most components ignore these tokens.

**(b) The real palette — `web/lib/colors.ts:11-218`.** The `COLORS` object is the true design system. Cyan-on-near-black:

- Background/void: `void #050510`, `hexGrid #0d0d1f` (`colors.ts:13-14`).
- Hologram cyan ramp: `holoBase #66ccff`, `holoBright #aaeeff`, `holoHot #ffffff` (`colors.ts:17-19`).
- **Semantic state colors** (`colors.ts:22-28`, resolved via `getStateColor()` `colors.ts:230-240`): idle/thinking cyan, tool_calling amber `#ffbb44`, complete green `#66ffaa`, error red `#ff5566`, paused gray, waiting_permission orange.
- **Edge/particle semantics** (`colors.ts:31-34`): dispatch purple, return green, tool amber, message cyan.
- **Context-breakdown** (`colors.ts:37-41`), **role/message-bubble** (`colors.ts:92-100`, `ROLE_COLORS` `colors.ts:222-226`), **diff** colors (`colors.ts:197-200`).
- Dozens of pre-computed rgba-with-alpha tokens; helper `withAlpha()` (`colors.ts:252-254`).

Semantic coding is used heavily and consistently: **amber = tool / expensive, green = complete / success, purple = thinking / reasoning, red = error.**

### Typography

- Declared families: `--font-sans: 'Geist'`, `--font-mono: 'Geist Mono'` (`globals.css:78-79`) — **but Geist is never loaded** (no `@font-face` / `next/font` / font files), so it falls back to system UI fonts.
- **Monospace dominates in practice** — 60+ `font-mono` usages in DOM panels; all canvas text is drawn in `monospace`.
- **Tiny, dense scale:** `text-[9px]` and `text-[10px]` dominate the DOM; canvas fonts run 5.5–11px. Weights are mostly normal with occasional `font-semibold`.

### Spacing, radius, shadows, borders

- Radius: shadcn scale, base `--radius: 0.625rem` (`globals.css:31,104-107`); components use tight pill padding (`px-1.5/2/2.5`, `py-0.5/1`).
- Borders: universal 1px translucent-cyan hairlines; global `* { @apply border-border }` (`globals.css:118-124`).
- **Shadows = glow, not drop shadows.** Glass card box-shadow + inset highlight (`globals.css:135-137`), progress-bar glow (`shared-ui.tsx:147`), plus a full **bloom post-processing pass** (`web/components/agent-visualizer/bloom-renderer.ts`).
- **Z-index scale** centralized in `web/lib/agent-types.ts:194-202` (info 10 → sidePanel 40 → controlBar/chatPanel 50 → transcriptPanel 60 → detailCard 100 → contextMenu 200).
- Canvas geometry/animation/glow are fully tokenized in `web/lib/canvas-constants.ts` (`FORCE`, `CAMERA`, `TOOL_SLOT`, `SPAWN_FX`, `PERF_OVERLAY`, etc.).

### Theming mechanism

Effectively **dark-only**. Light + dark shadcn token sets exist but `<html className="dark">` is hard-coded (`layout.tsx:33`) with no `next-themes`, no `prefers-color-scheme` switch, no toggle. The real "theme" is the static `COLORS` object; there is no alternate palette. User-facing visual prefs are minimal (sound on/off in localStorage; `?perf`/`?stress` debug overlays).

---

## How designs are implemented

### Styling approach

- **Tailwind CSS v4**, CSS-first (no `tailwind.config.js`): `@import 'tailwindcss'` (`globals.css:1`), PostCSS plugin `@tailwindcss/postcss`, Vite path uses `@tailwindcss/vite`. `@theme inline` maps tokens to utilities.
- **Two idioms coexist:** Tailwind utility classes for layout/spacing, and a hand-rolled "glass" CSS system + inline `style={{}}` pulling from `COLORS` for the holographic visuals.
- `tw-animate-css` for animation utilities. **No `cn()`/clsx/tailwind-merge** — `web/lib/utils.ts` holds domain formatters, not class helpers.

### Component architecture

- **Feature-based, single feature.** Everything under `web/components/agent-visualizer/`. Root orchestrator `index.tsx` (425 lines) composes ~15 panel/overlay components (`index.tsx:8-26`).
- **No third-party UI library.** shadcn is configured (`web/components.json`, "new-york", neutral, Lucide) but there is **no `components/ui` directory** and no shadcn/Radix/MUI primitives in the tree. Primitives are hand-built.
- **Two-layer rendering:**
  - **Canvas layer** — one `<canvas>` with an imperative `requestAnimationFrame` engine (`canvas.tsx:170-333`). All drawing is factored into pure functions in `canvas/` (`draw-agents.ts`, `draw-edges.ts`, `draw-particles.ts`, `draw-tool-calls.ts`, `draw-discoveries.ts`, `draw-cost.ts`, `draw-effects.ts`, `hit-detection.ts`, `render-cache.ts`), plus `background-layer.ts` and `bloom-renderer.ts`.
  - **React/DOM overlay** — glass panels absolutely positioned over the canvas: `top-bar.tsx`, `control-bar.tsx`, `message-feed-panel.tsx`, `agent-detail-card.tsx`, `chat-panel.tsx`, `session-transcript-panel.tsx`, `timeline-panel.tsx`, `file-attention-panel.tsx`, `tool-detail-popup.tsx`, `discovery-detail-popup.tsx`, `glass-context-menu.tsx`, `session-tabs.tsx` (composed in `index.tsx:259-424`).

### State & data flow

- **No Redux/Zustand** — React hooks + refs. Custom hooks in `web/hooks/`:
  - `use-agent-simulation.ts` owns the sim; **d3-force** does graph layout only (`use-agent-simulation.ts:55-59`). Exposes a mutable `frameRef` plus React state.
  - `use-vscode-bridge.ts` (inbound events), `use-selection-state.ts`, `use-keyboard-shortcuts.ts`, `use-audio-effects.ts`, `use-canvas-camera.ts`, `use-canvas-interaction.ts`.
  - Event pipeline in `web/hooks/simulation/` (`process-event.ts`, `handle-agent-events.ts`, `animate.ts`).
- **Perf pattern:** the canvas reads sim data from a **ref every frame** (`canvas.tsx:91,178-189`) so the rAF loop never depends on React re-renders. Panels take normal props/state.

### Reusable primitives

All in `web/components/agent-visualizer/shared-ui.tsx` and `glass-card.tsx`:

- `GlassCard` (`glass-card.tsx`) — core visual container; delays unmount by `TIMING.glassAnimMs` for fade/scale exit transitions.
- `SlidingPanel` (`shared-ui.tsx:109-129`) — slide-in/out wrapper.
- `DetailPopup` (`shared-ui.tsx:72-89`) — position-clamped floating card.
- `PanelHeader` (`shared-ui.tsx:47-59`), `CloseButton` (`shared-ui.tsx:26-36`), `ProgressBar` (`shared-ui.tsx:139-152`).
- `stopPropagationHandlers` (`shared-ui.tsx:13-17`) — keeps panel clicks/drags off the canvas.
- `GlassContextMenu` (`glass-context-menu.tsx`) — right-click menu.

### Icons, animation, visualization

- **Icons:** no icon library — emoji glyphs as icons (e.g. `CloseButton` "✕") plus a few hand-inlined SVGs (`top-bar.tsx:13-29`).
- **Animation:** no Framer Motion / GSAP. CSS transitions driven by React state toggles for DOM; the imperative rAF engine (delta-time physics, particle systems, camera inertia, bloom) for canvas.
- **Visualization:** no charting lib. The org chart is a **custom Canvas 2D renderer**; d3-force provides layout only; all pixels drawn by `canvas/draw-*.ts`. Color source of truth is `web/lib/colors.ts`; numeric constants in `web/lib/canvas-constants.ts`.

---

## Adding a new UI component (convention)

Follow the overlay-panel pattern used by every existing panel:

1. Create a kebab-case file in `web/components/agent-visualizer/`.
2. Start with `'use client'`; named-export a function component with a typed `interface XProps`.
3. Pull colors from `COLORS` (`web/lib/colors.ts`) via inline `style`; use Tailwind classes for layout.
4. Wrap floating content in a shared primitive (`GlassCard` / `SlidingPanel` / `DetailPopup`) and use `PanelHeader`.
5. If it sits over the canvas, spread `stopPropagationHandlers` on the root.
6. Use centralized constants for timing/z-index (`TIMING`, `Z` from `web/lib/agent-types.ts`).
7. `memo` expensive sub-parts and down-sample where relevant (see `EventMarkers` in `control-bar.tsx:45-70`).

---

## Key file reference

| Concern | File |
| --- | --- |
| Root component | `web/components/agent-visualizer/index.tsx` |
| Canvas engine | `web/components/agent-visualizer/canvas.tsx` |
| Draw modules | `web/components/agent-visualizer/canvas/*.ts` |
| Visual primitives | `web/components/agent-visualizer/shared-ui.tsx`, `glass-card.tsx` |
| Bloom / background | `web/components/agent-visualizer/bloom-renderer.ts`, `background-layer.ts` |
| Real color palette | `web/lib/colors.ts` |
| Canvas geometry/anim tokens | `web/lib/canvas-constants.ts` |
| Z-index / timing / anim | `web/lib/agent-types.ts` |
| shadcn/Tailwind tokens + glass CSS | `web/app/globals.css` |
| Hard-coded dark theme + body bg | `web/app/layout.tsx` |
| shadcn config | `web/components.json` |
| Simulation / state | `web/hooks/use-agent-simulation.ts`, `web/hooks/simulation/*` |
| Build configs | `web/next.config.mjs`, `web/vite.config.*.ts`, `web/postcss.config.mjs` |
