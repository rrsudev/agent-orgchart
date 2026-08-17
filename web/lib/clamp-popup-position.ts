import { CARD } from '@/lib/agent-types'

/** Fallback viewport dimensions for SSR / non-browser environments */
const SSR_VIEWPORT_W = 800
const SSR_VIEWPORT_H = 600

/**
 * The box a popup is allowed to occupy.
 *
 * Callers inside the visualizer pass the *measured* surface (see `useLayout`)
 * rather than letting the window fallback apply: inside a VS Code webview the
 * window is the whole iframe, which is not the box the popup is absolutely
 * positioned within. Clamping against it let popups slide under the top bar and
 * past the bottom dock — the popup looked "inside the viewport" while sitting
 * outside the panel it belongs to.
 */
export interface PopupBounds {
  /** Width of the positioning box. */
  width: number
  /** Height of the positioning box. */
  height: number
  /** Edge margin; defaults to the shared card margin. */
  margin?: number
  /** Space to keep clear at the top (fixed chrome such as the top bar). */
  insetTop?: number
  /** Space to keep clear at the bottom (the bottom dock). */
  insetBottom?: number
}

/**
 * Clamp a popup position so it stays within `bounds` — or, when no bounds are
 * given, within the window (kept so callers rendered outside a LayoutProvider
 * still behave sanely).
 */
export function clampPopupPosition(
  position: { x: number; y: number },
  popupWidth: number,
  popupHeight: number,
  offsetY = 20,
  bounds?: PopupBounds,
): { left: number; top: number } {
  const hasWindow = typeof window !== 'undefined'
  const boxW = bounds?.width ?? (hasWindow ? window.innerWidth : SSR_VIEWPORT_W)
  const boxH = bounds?.height ?? (hasWindow ? window.innerHeight : SSR_VIEWPORT_H)
  const margin = bounds?.margin ?? CARD.margin

  const minX = margin
  const minY = Math.max(margin, bounds?.insetTop ?? 0)
  // On a surface smaller than the popup the far edge lands *before* the near
  // edge. Flooring at the near edge keeps the popup's header (title + close
  // button) on screen instead of pushing it off the left/top.
  const maxX = Math.max(minX, boxW - popupWidth - margin)
  const maxY = Math.max(minY, boxH - popupHeight - (bounds?.insetBottom ?? margin))

  return {
    left: Math.min(Math.max(minX, position.x - popupWidth / 2), maxX),
    top: Math.min(Math.max(minY, position.y + offsetY), maxY),
  }
}
