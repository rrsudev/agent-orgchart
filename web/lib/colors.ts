/**
 * Light, minimalist, Apple-inspired color palette.
 *
 * Design language: Apple Human Interface Guidelines — clarity, deference, depth.
 * Light mode is the default and primary theme. Depth comes from soft shadows,
 * hairline borders and layering — NOT from luminance/glow.
 *
 * ── Encoding contract (do not break) ─────────────────────────────────────────
 * Both the Canvas 2D layer and the React/DOM overlay read from this one object.
 * The canvas cannot read CSS variables, so every color is a concrete JS string.
 *
 *  1. Any token consumed by hex-alpha concatenation (`color + '90'`, `+ '25'`,
 *     `+ alphaHex(a)`) MUST stay a 6-digit hex string. That covers every state,
 *     accent, role, discovery, edge/particle color plus `holoBase/Bright/Hot`,
 *     `textPrimary`, and the semantic hexes below. Never make these `rgb()`,
 *     `oklch()`, named colors, or 8-digit hex.
 *  2. Tokens consumed by `withAlpha()` (the "canvas … Base" keys) MUST keep the
 *     partial-rgba shape `'rgba(r, g, b,'` — trailing comma, no closing paren.
 *     Replace the numbers, never the format.
 *  3. Tokens used only as a direct color (never concatenated) may bake alpha as
 *     8-digit hex or `rgba(...)`.
 *
 * Extracted from agent-types.ts; re-exported there for backward compatibility.
 */

import type { AgentState, ContextBreakdown } from './agent-types'

// ─── Seed constants ──────────────────────────────────────────────────────────
// The whole palette derives from these. Recolor the app by editing the seeds:
// each family has a 6-digit HEX (for hex-alpha concat) and an RGB triple (for
// rgba() literals). Swap a pair and both layers move together.

/** Apple system blue — the single accent, used sparingly. */
const ACCENT_HEX = '#0071e3'
const ACCENT_RGB = '0, 113, 227'
/** complete / success. */
const GREEN_HEX = '#248a3d'
const GREEN_RGB = '36, 138, 61'
/** tool_calling / expensive — darkened so it is legible on white. */
const AMBER_HEX = '#a15c00'
const AMBER_RGB = '161, 92, 0'
/** error. */
const RED_HEX = '#d70015'
const RED_RGB = '215, 0, 21'
/** thinking / reasoning / dispatch. */
const PURPLE_HEX = '#5e5ce6'
const PURPLE_RGB = '94, 92, 230'
/** waiting_permission — legible orange. */
const ORANGE_HEX = '#b45309'

// Apple label hierarchy (neutral — never tint body text with the accent).
// Secondary/tertiary are nudged slightly darker than Apple's #6e6e73/#86868b so
// they clear WCAG AA (≥4.5:1) on white at the 12px floor, while keeping a clear
// three-step hierarchy.
const INK = '#1d1d1f' // primary label   (~16:1)
const INK2 = '#5c5c60' // secondary label (~5.4:1)
const INK3 = '#6e6e73' // tertiary label  (~4.6:1)
const HAIRLINE = '0, 0, 0' // rgb triple for hairline borders / dividers

// ─── Apple Light Palette ─────────────────────────────────────────────────────
export const COLORS = {
  // Surfaces — layered near-whites (Apple's signature light grays)
  void: '#f5f5f7',
  hexGrid: '#d2d2d7',

  // Primary accent ramp. `holoBright`/`holoHot` render as DOM text / canvas
  // flashes, so they must read on white — accent blue, not a bright tint.
  holoBase: ACCENT_HEX,
  holoBright: ACCENT_HEX,
  holoHot: ACCENT_HEX,

  // Agent States (6-digit hex — flow into `getStateColor` and hex-alpha concat)
  idle: ACCENT_HEX,
  thinking: PURPLE_HEX,
  tool_calling: AMBER_HEX,
  complete: GREEN_HEX,
  error: RED_HEX,
  paused: INK3,
  waiting_permission: ORANGE_HEX,

  // Edge/Particle Colors
  dispatch: PURPLE_HEX,
  return: GREEN_HEX,
  tool: AMBER_HEX,
  message: ACCENT_HEX,

  // Context breakdown colors
  contextSystem: '#8e8e93',     // neutral gray — fixed overhead
  contextUser: ACCENT_HEX,      // blue — user input
  contextToolResults: AMBER_HEX, // amber — expensive!
  contextReasoning: PURPLE_HEX,  // purple — agent thinking
  contextSubagent: GREEN_HEX,    // green — child agent results

  // UI Chrome
  nodeInterior: 'rgba(255, 255, 255, 0.9)',
  textPrimary: INK,
  textDim: INK2,
  textMuted: INK3,

  // Glass card — near-opaque, very light gray material (Apple/Notion) + hairline
  glassBg: 'rgba(247, 247, 249, 0.94)',
  glassBorder: `rgba(${HAIRLINE}, 0.12)`,
  glassHighlight: 'rgba(255, 255, 255, 0.8)',

  // Accent-tinted subtle fills; neutral hairline borders
  holoBg03: `rgba(${ACCENT_RGB}, 0.04)`,
  holoBg05: `rgba(${ACCENT_RGB}, 0.06)`,
  holoBg10: `rgba(${ACCENT_RGB}, 0.1)`,
  holoBorder06: `rgba(${HAIRLINE}, 0.06)`,
  holoBorder08: `rgba(${HAIRLINE}, 0.08)`,
  holoBorder10: `rgba(${HAIRLINE}, 0.1)`,
  holoBorder12: `rgba(${HAIRLINE}, 0.12)`,

  // Panel chrome
  panelBg: 'rgba(247, 247, 249, 0.96)',
  panelSeparator: `rgba(${HAIRLINE}, 0.06)`,

  // Toggle button states
  toggleActive: `rgba(${ACCENT_RGB}, 0.14)`,
  toggleInactive: `rgba(${HAIRLINE}, 0.04)`,
  toggleBorder: `rgba(${HAIRLINE}, 0.1)`,

  // Live indicator
  liveDot: '#ff3b30',
  liveText: RED_HEX,
  liveResumeBg: `rgba(${RED_RGB}, 0.1)`,
  liveResumeBorder: `rgba(${RED_RGB}, 0.3)`,

  // Discovery type colors
  discoveryFile: ACCENT_HEX,
  discoveryPattern: PURPLE_HEX,
  discoveryFinding: GREEN_HEX,
  discoveryCode: AMBER_HEX,

  // Session tab states
  tabSelectedBg: `rgba(${ACCENT_RGB}, 0.12)`,
  tabInactiveBg: `rgba(${HAIRLINE}, 0.03)`,
  tabSelectedBorder: `rgba(${ACCENT_RGB}, 0.5)`,
  tabInactiveBorder: `rgba(${HAIRLINE}, 0.08)`,
  tabClose: INK3,

  // Role colors (message bubbles) — tint behind dark, legible role text
  roleAssistantBg: `rgba(${ACCENT_RGB}, 0.1)`,
  roleAssistantBgSelected: `rgba(${ACCENT_RGB}, 0.18)`,
  roleAssistantText: '#0058b0',
  roleThinkingBg: `rgba(${PURPLE_RGB}, 0.1)`,
  roleThinkingBgSelected: `rgba(${PURPLE_RGB}, 0.18)`,
  roleThinkingText: '#4b49c4',
  roleUserBg: `rgba(${AMBER_RGB}, 0.1)`,
  roleUserBgSelected: `rgba(${AMBER_RGB}, 0.18)`,
  roleUserText: '#8a5000',

  // Result/success
  resultBg: `rgba(${GREEN_RGB}, 0.06)`,
  resultBorder: `rgba(${GREEN_RGB}, 0.14)`,

  // Unread indicator
  unreadDot: '#ff3b30',

  // Play button
  playBtnBg: `rgba(${ACCENT_RGB}, 0.1)`,
  playBtnActiveBg: `rgba(${ACCENT_RGB}, 0.18)`,
  playBtnBorder: `rgba(${ACCENT_RGB}, 0.4)`,
  playBtnGlow: `0 1px 3px rgba(${HAIRLINE}, 0.1)`,

  // Scrubber
  scrubberFill: `linear-gradient(90deg, rgba(${ACCENT_RGB},0.5), rgba(${ACCENT_RGB},0.85))`,
  scrubberHeadGlow: `0 1px 4px rgba(${HAIRLINE}, 0.18)`,
  reviewBtnBorder: `rgba(${ACCENT_RGB}, 0.35)`,

  // Canvas drawing — bubble base colors (partial rgba, alpha appended at draw time)
  bubbleThinkingBase: `rgba(${PURPLE_RGB},`,
  bubbleUserBase: `rgba(${AMBER_RGB},`,
  bubbleAssistantBase: `rgba(${ACCENT_RGB},`,

  // Canvas drawing — tool card backgrounds (partial rgba, alpha appended at draw time)
  toolCardErrorBase: `rgba(${RED_RGB},`,
  toolCardSelectedBase: `rgba(${ACCENT_RGB},`,
  toolCardBase: 'rgba(255, 255, 255,',

  // Canvas drawing — agent/tool card backgrounds
  cardBgDark: 'rgba(255, 255, 255, 0.92)',
  cardBg: 'rgba(255, 255, 255, 0.7)',
  cardBgSelected: 'rgba(255, 255, 255, 0.96)',
  cardBgError: `rgba(255, 238, 238, 0.92)`,
  cardBgSelectedHolo: `rgba(${ACCENT_RGB}, 0.14)`,
  cardBgFaintOverlay: 'rgba(0, 0, 0, 0.01)',

  // Active tool indicator (detail card)
  toolIndicatorBg: `rgba(${AMBER_RGB}, 0.1)`,
  toolIndicatorBorder: `rgba(${AMBER_RGB}, 0.22)`,
  toolIndicatorText: AMBER_HEX,


  // ─── Transcript / message feed colors ───────────────────────────────────────

  // User messages
  userMsgBg: `rgba(${AMBER_RGB}, 0.06)`,
  userMsgBorder: `rgba(${AMBER_RGB}, 0.14)`,
  userLabel: '#a15c00aa',
  userText: '#8a5000',

  // Assistant messages
  assistantLabel: '#0071e3aa',
  assistantText: INK,

  // Thinking messages
  thinkingBgExpanded: `rgba(${PURPLE_RGB}, 0.06)`,
  thinkingBgCollapsed: `rgba(${PURPLE_RGB}, 0.03)`,
  thinkingBorder: `rgba(${PURPLE_RGB}, 0.1)`,
  thinkingLabel: '#5e5ce6aa',
  thinkingArrow: '#5e5ce688',
  thinkingPreview: PURPLE_HEX,
  thinkingTextExpanded: '#5e5ce6cc',
  thinkingBorderLeft: `rgba(${PURPLE_RGB}, 0.2)`,

  // Tool call messages
  toolCallBg: `rgba(${AMBER_RGB}, 0.05)`,
  toolCallBorder: `rgba(${AMBER_RGB}, 0.12)`,

  // Tool result messages
  bashResultBg: `rgba(${HAIRLINE}, 0.04)`,
  toolResultBg: `rgba(${GREEN_RGB}, 0.05)`,
  bashResultBorder: `rgba(${AMBER_RGB}, 0.12)`,
  toolResultBorder: `rgba(${GREEN_RGB}, 0.12)`,
  bashResultText: '#3a3a3c',
  toolResultText: '#1a6e30',
  textFaint: INK3,

  // Search highlight
  searchHighlightBg: 'rgba(255, 214, 10, 0.55)',

  // ─── Diff / code block colors ───────────────────────────────────────────────

  codeBlockBg: `rgba(${HAIRLINE}, 0.04)`,
  diffRemoved: RED_HEX,
  diffRemovedBg: `rgba(${RED_RGB},0.08)`,
  diffAdded: GREEN_HEX,
  diffAddedBg: `rgba(${GREEN_RGB},0.08)`,

  // ─── Tool content colors ────────────────────────────────────────────────────

  filePathActive: ACCENT_HEX,
  filePathInactive: '#0071e3aa',
  todoCompleted: GREEN_HEX,
  todoCompletedText: '#248a3daa',
  todoPending: INK2,
  contentDim: '#3a3a3c',
  searchIcon: INK3,

  // ─── Panel header / chrome text ─────────────────────────────────────────────

  panelLabel: INK2,
  panelLabelDim: INK3,
  scrollBtnText: ACCENT_HEX,
  scrollbarThumb: `rgba(${HAIRLINE}, 0.18)`,
} as const

// ─── Role Colors (message feed & bubbles) ───────────────────────────────────

export const ROLE_COLORS: Record<string, { bg: string; bgSelected: string; text: string; label: string }> = {
  assistant: { bg: COLORS.roleAssistantBg, bgSelected: COLORS.roleAssistantBgSelected, text: COLORS.roleAssistantText, label: 'CLAUDE' },
  thinking:  { bg: COLORS.roleThinkingBg,  bgSelected: COLORS.roleThinkingBgSelected,  text: COLORS.roleThinkingText,  label: 'THINKING' },
  user:      { bg: COLORS.roleUserBg,       bgSelected: COLORS.roleUserBgSelected,       text: COLORS.roleUserText,       label: 'USER' },
} as const

// ─── Color Helper Functions ──────────────────────────────────────────────────

export function getStateColor(state: AgentState): string {
  switch (state) {
    case 'idle': return COLORS.idle
    case 'thinking': return COLORS.thinking
    case 'tool_calling': return COLORS.tool_calling
    case 'complete': return COLORS.complete
    case 'error': return COLORS.error
    case 'paused': return COLORS.paused
    case 'waiting_permission': return COLORS.waiting_permission
  }
}

export function getDiscoveryTypeColor(type: string): string {
  switch (type) {
    case 'file': return COLORS.discoveryFile
    case 'pattern': return COLORS.discoveryPattern
    case 'finding': return COLORS.discoveryFinding
    default: return COLORS.discoveryCode
  }
}

/** Safely combine a partial rgba base (e.g. 'rgba(10, 15, 30,') with an alpha value */
export function withAlpha(rgbaBase: string, alpha: number): string {
  return `${rgbaBase} ${alpha})`
}

// ─── Agent identity palette (user color-coding) ──────────────────────────────
// Six calm hues deliberately chosen to sit in the gaps between the semantic
// status colors (blue/purple/amber/green/red/orange). They are applied as a
// soft WASH of the node's (otherwise white) card fill — an identity channel that
// is orthogonal to the state color carried by the border/badge/glyph, so it
// never conflicts with the existing status semantics. 6-digit hex is required by
// the card-fill blend (`washOverWhite`).
export const AGENT_PALETTE: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Cyan', hex: '#0e7490' },
  { name: 'Olive', hex: '#6b8e23' },
  { name: 'Magenta', hex: '#b5179e' },
  { name: 'Pink', hex: '#d6336c' },
  { name: 'Slate', hex: '#6b7280' },
] as const

/** Blend a 6-digit hex toward white and return a solid 6-digit hex.
 *  `amount` 0 → white, 1 → the hex. Used to tint the white node card fill into a
 *  soft identity wash without touching alpha compositing / the card shadow. */
export function washOverWhite(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const mix = (c: number) => Math.round(255 + (c - 255) * amount)
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')
}

/** Build the context-breakdown color segments for a given breakdown. */
export function contextSegments(bd: ContextBreakdown) {
  return [
    { value: bd.systemPrompt, color: COLORS.contextSystem },
    { value: bd.userMessages, color: COLORS.contextUser },
    { value: bd.toolResults, color: COLORS.contextToolResults },
    { value: bd.reasoning, color: COLORS.contextReasoning },
    { value: bd.subagentResults, color: COLORS.contextSubagent },
  ]
}
