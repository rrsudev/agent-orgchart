'use client'

/**
 * Container-measured layout system.
 *
 * The visualizer is a full-bleed canvas with floating glass panels anchored to
 * its edges. Those panels historically used fixed pixel widths/heights and fixed
 * corner offsets — fine in a wide browser tab, but in a narrow VS Code webview
 * (a docked editor column or the secondary side bar) they spilled past the edges
 * and stacked on the same corner, overlapping each other.
 *
 * Two things make the layout hold at any size:
 *
 *  1. We measure the visualizer's own root element with a ResizeObserver rather
 *     than keying off the viewport (`100vw`/`100vh`, which inside a webview
 *     iframe does not match the panel's real box). Panels read `useLayout()` and
 *     clamp width/height to what actually fits.
 *
 *  2. The two pieces of fixed chrome — the top bar and the bottom dock — report
 *     their measured heights back into the context. Everything else positions
 *     against `railTop` / `railBottom` instead of magic numbers, so the rails
 *     stay correct when the chrome wraps to two rows on a narrow surface.
 *
 * Size classes drive placement, not just clamping: on a `narrow` surface the
 * left and right rails collapse into one, so callers keep at most one side panel
 * open (see `sideBySide`).
 */

import {
  createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode, type RefObject,
} from 'react'

/** Uniform margin between a panel and the surface edge (and between panels). */
export const GUTTER = 12

/** Fallback chrome heights, used only until the real elements report in. They
 *  match the resting height of each bar so the first paint doesn't jump. */
const TOP_BAR_FALLBACK = 40
const BOTTOM_DOCK_FALLBACK = 44

/** Width below which side panels go near-full-width and the left/right rails
 *  collapse into one (typical for the VS Code side bar). */
const NARROW_MAX = 560
/** Width below which panels clamp but the two-rail split still holds — a docked
 *  editor column. */
const COMPACT_MAX = 900
/** Height below which a full-height side panel would swallow the surface, so
 *  panels cap themselves more aggressively and the legend stays collapsed. */
const SHORT_MAX = 560

export type LayoutMode = 'wide' | 'compact' | 'narrow'

/** The two fixed-chrome slots that own the top and bottom edges. */
export type ChromeSlot = 'top' | 'bottom'

export interface LayoutInfo {
  /** Measured content width of the visualizer root, in px. */
  width: number
  /** Measured content height of the visualizer root, in px. */
  height: number
  mode: LayoutMode
  /** true for `compact` OR `narrow` — i.e. "not a roomy desktop tab". */
  compact: boolean
  /** true only for the tightest width class (side-bar widths). */
  narrow: boolean
  /** true when the surface is too short for tall panels (a bottom-docked panel). */
  short: boolean
  /** Whether the left and right rails can both be occupied at once. */
  sideBySide: boolean
  /** Running inside a VS Code webview. */
  isVSCode: boolean
  /** Uniform edge margin, tightened on narrow surfaces. */
  gutter: number
  /** Y of the first free pixel below the top bar — panels anchor here. */
  railTop: number
  /** Height reserved at the bottom by the dock — panels stop above it. */
  railBottom: number
  /** Clamp a design width to what fits with a gutter on each side. */
  panelWidth: (design: number) => number
  /** Available height for a panel between the two rails (extra reservations
   *  are subtracted on top of the measured chrome). */
  panelHeight: (extraTop?: number, extraBottom?: number) => number
  /** Ref callback for a fixed-chrome element so its height feeds the rails. */
  registerChrome: (slot: ChromeSlot) => (el: HTMLElement | null) => void
}

/** Sensible fallback so panels rendered outside a provider (tests, isolated
 *  stories) still behave as if on a roomy surface. */
const DEFAULT: LayoutInfo = {
  width: 1440,
  height: 900,
  mode: 'wide',
  compact: false,
  narrow: false,
  short: false,
  sideBySide: true,
  isVSCode: false,
  gutter: GUTTER,
  railTop: GUTTER + TOP_BAR_FALLBACK + GUTTER,
  railBottom: BOTTOM_DOCK_FALLBACK + GUTTER,
  panelWidth: (d) => d,
  panelHeight: (t = 0, b = 0) =>
    Math.max(160, 900 - (GUTTER + TOP_BAR_FALLBACK + GUTTER) - (BOTTOM_DOCK_FALLBACK + GUTTER) - t - b),
  registerChrome: () => () => {},
}

const LayoutContext = createContext<LayoutInfo | null>(null)

export function useLayout(): LayoutInfo {
  return useContext(LayoutContext) ?? DEFAULT
}

interface LayoutProviderProps {
  /** Ref to the visualizer root element that panels are positioned within. */
  containerRef: RefObject<HTMLElement | null>
  isVSCode: boolean
  children: ReactNode
}

export function LayoutProvider({ containerRef, isVSCode, children }: LayoutProviderProps) {
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [chrome, setChrome] = useState<{ top: number; bottom: number }>({
    top: TOP_BAR_FALLBACK,
    bottom: BOTTOM_DOCK_FALLBACK,
  })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Seed synchronously so the first painted frame is already correct.
    setSize({ width: el.clientWidth, height: el.clientHeight })
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setSize({ width: Math.round(r.width), height: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  // ── Chrome measurement ────────────────────────────────────────────────────
  // Each fixed bar hands us its element; we watch it and publish its height.
  //
  // Two things keep this from feeding back on itself. Heights are rounded and
  // compared before `setChrome`, so a bar that re-renders at the same height
  // publishes nothing. And the ref callbacks are created ONCE per slot: a fresh
  // callback identity on every render would make React detach and re-attach the
  // ref each time — and since the bars read this context, each re-attach would
  // publish a height, re-render the bar, and hand React another new callback.
  const observersRef = useRef<Map<ChromeSlot, ResizeObserver>>(new Map())
  const chromeRefs = useMemo(() => {
    const make = (slot: ChromeSlot) => (el: HTMLElement | null) => {
      observersRef.current.get(slot)?.disconnect()
      observersRef.current.delete(slot)
      if (!el || typeof ResizeObserver === 'undefined') {
        const fallback = slot === 'top' ? TOP_BAR_FALLBACK : BOTTOM_DOCK_FALLBACK
        setChrome(prev => (prev[slot] === fallback ? prev : { ...prev, [slot]: fallback }))
        return
      }
      const publish = (h: number) => {
        const next = Math.round(h)
        setChrome(prev => (prev[slot] === next ? prev : { ...prev, [slot]: next }))
      }
      publish(el.offsetHeight)
      const ro = new ResizeObserver(() => publish(el.offsetHeight))
      ro.observe(el)
      observersRef.current.set(slot, ro)
    }
    return { top: make('top'), bottom: make('bottom') }
  }, [])
  const registerChrome = useCallback((slot: ChromeSlot) => chromeRefs[slot], [chromeRefs])

  useLayoutEffect(() => {
    const observers = observersRef.current
    return () => { for (const ro of observers.values()) ro.disconnect() }
  }, [])

  const value = useMemo<LayoutInfo>(() => {
    // Before the observer reports (SSR / first tick), fall back to the window so
    // we never flash a collapsed layout.
    const width = size.width || (typeof window !== 'undefined' ? window.innerWidth : DEFAULT.width)
    const height = size.height || (typeof window !== 'undefined' ? window.innerHeight : DEFAULT.height)
    const mode: LayoutMode = width < NARROW_MAX ? 'narrow' : width < COMPACT_MAX ? 'compact' : 'wide'
    const narrow = mode === 'narrow'
    const gutter = narrow ? 8 : GUTTER
    const railTop = gutter + chrome.top + gutter
    const railBottom = chrome.bottom + gutter
    return {
      width,
      height,
      mode,
      compact: mode !== 'wide',
      narrow,
      short: height < SHORT_MAX,
      sideBySide: !narrow,
      isVSCode,
      gutter,
      railTop,
      railBottom,
      panelWidth: (design: number) => Math.max(140, Math.min(design, width - gutter * 2)),
      panelHeight: (extraTop = 0, extraBottom = 0) =>
        Math.max(120, height - railTop - railBottom - extraTop - extraBottom),
      registerChrome,
    }
  }, [size.width, size.height, chrome.top, chrome.bottom, isVSCode, registerChrome])

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}
