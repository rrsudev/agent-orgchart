'use client'

/**
 * Container-measured layout system.
 *
 * The visualizer is a full-bleed canvas with floating glass panels anchored to
 * its corners. Those panels historically used fixed pixel widths/heights and
 * fixed corner offsets — fine in a wide browser tab, but in a narrow VS Code
 * webview (a docked editor column or the secondary side bar) they spilled past
 * the edges and stacked on the same corner, overlapping each other.
 *
 * Instead of keying off the viewport (`100vw`/`100vh`, which in a webview iframe
 * does not match the panel's real box), we measure the visualizer's own root
 * element with a ResizeObserver and expose it through context. Panels read
 * `useLayout()` and clamp their width/height to what actually fits and pick a
 * placement rail from the current size class — so the same components lay out
 * cleanly whether the surface is a 1600px browser tab or a 320px side bar.
 */

import {
  createContext, useContext, useLayoutEffect, useMemo, useState,
  type ReactNode, type RefObject,
} from 'react'

/** Uniform margin between a panel and the surface edge. */
export const GUTTER = 12
/** Y offset of the rail where top-anchored side panels begin — clears the top
 *  bar (which sits at top:16 and is ~34px tall). */
export const RAIL_TOP = 66
/** Reserve at the bottom so bottom-left/bottom-center chrome (legend launcher,
 *  session timer) never collides with a tall side panel. */
export const RAIL_BOTTOM = 60

/** Width below which side panels go near-full-width and top-side panels stack
 *  onto a single rail (typical for the VS Code side bar). */
const NARROW_MAX = 560
/** Width below which panels clamp but the two-rail (left/right) split still
 *  holds — a docked editor column. */
const COMPACT_MAX = 900

export type LayoutMode = 'wide' | 'compact' | 'narrow'

export interface LayoutInfo {
  /** Measured content width of the visualizer root, in px. */
  width: number
  /** Measured content height of the visualizer root, in px. */
  height: number
  mode: LayoutMode
  /** true for `compact` OR `narrow` — i.e. "not a roomy desktop tab". */
  compact: boolean
  /** true only for the tightest class (side-bar widths). */
  narrow: boolean
  /** Running inside a VS Code webview. */
  isVSCode: boolean
  /** Clamp a design width to what fits with a gutter on each side. */
  panelWidth: (design: number) => number
  /** Available height for a panel between a top and bottom reservation. */
  panelHeight: (reservedTop?: number, reservedBottom?: number) => number
}

/** Sensible fallback so panels rendered outside a provider (tests, isolated
 *  stories) still behave as if on a roomy surface. */
const DEFAULT: LayoutInfo = {
  width: 1440,
  height: 900,
  mode: 'wide',
  compact: false,
  narrow: false,
  isVSCode: false,
  panelWidth: (d) => d,
  panelHeight: (t = RAIL_TOP, b = GUTTER) => Math.max(160, 900 - t - b),
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

  const value = useMemo<LayoutInfo>(() => {
    // Before the observer reports (SSR / first tick), fall back to the window so
    // we never flash a collapsed layout.
    const width = size.width || (typeof window !== 'undefined' ? window.innerWidth : DEFAULT.width)
    const height = size.height || (typeof window !== 'undefined' ? window.innerHeight : DEFAULT.height)
    const mode: LayoutMode = width < NARROW_MAX ? 'narrow' : width < COMPACT_MAX ? 'compact' : 'wide'
    return {
      width,
      height,
      mode,
      compact: mode !== 'wide',
      narrow: mode === 'narrow',
      isVSCode,
      panelWidth: (design: number) => Math.max(140, Math.min(design, width - GUTTER * 2)),
      panelHeight: (reservedTop = RAIL_TOP, reservedBottom = GUTTER) =>
        Math.max(140, height - reservedTop - reservedBottom),
    }
  }, [size.width, size.height, isVSCode])

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}
