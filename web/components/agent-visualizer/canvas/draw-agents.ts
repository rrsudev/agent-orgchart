import { Agent, NODE, ANIM, AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor, contextSegments, washOverWhite } from '@/lib/colors'
import {
  AGENT_DRAW, CONTEXT_BAR, STATS_OVERLAY, NODE_DRAW, CANVAS_FONT, PREFERS_REDUCED_MOTION,
} from '@/lib/canvas-constants'
import { formatTokens } from '@/lib/utils'
import { wrapTextLines, drawSquircle, CLAUDE_SPARK_D, OPENAI_LOGO_D, OPENAI_LOGO_VIEWBOX } from './draw-misc'

let _claudeSparkPath: Path2D | null = null
export function getClaudeSparkPath() {
  if (!_claudeSparkPath) _claudeSparkPath = new Path2D(CLAUDE_SPARK_D)
  return _claudeSparkPath
}

let _openaiLogoPath: Path2D | null = null
function getOpenAILogoPath() {
  if (!_openaiLogoPath) _openaiLogoPath = new Path2D(OPENAI_LOGO_D)
  return _openaiLogoPath
}

export function drawClaudeSpark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  const scale = (r * AGENT_DRAW.sparkScale) / AGENT_DRAW.sparkViewBox
  ctx.scale(scale, scale)
  ctx.translate(-AGENT_DRAW.sparkViewBox, -AGENT_DRAW.sparkViewBox + 1)
  ctx.fillStyle = color
  ctx.fill(getClaudeSparkPath())
  ctx.restore()
}

export function drawOpenAILogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  // Target diameter matches the Claude spark: (r * sparkScale) total.
  const scale = (r * AGENT_DRAW.sparkScale) / OPENAI_LOGO_VIEWBOX
  ctx.scale(scale, scale)
  ctx.translate(-OPENAI_LOGO_VIEWBOX / 2, -OPENAI_LOGO_VIEWBOX / 2)
  ctx.fillStyle = color
  ctx.fill(getOpenAILogoPath())
  ctx.restore()
}

/** Pick the brand logo for the agent's runtime. Defaults to Claude. */
export function drawAgentBrand(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, color: string,
  runtime: Agent['runtime'],
) {
  if (runtime === 'codex') drawOpenAILogo(ctx, cx, cy, r, color)
  else drawClaudeSpark(ctx, cx, cy, r, color)
}

export function drawContextComposition(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
  /** Push the bar down (e.g. to clear a goal subtitle drawn under the node). */
  extraYOffset = 0,
  /** Show the "X / Y tokens" numeric readout (toggleable). */
  showCount = true,
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const barWidth = Math.max(CONTEXT_BAR.minWidth, radius * CONTEXT_BAR.widthMultiplier)
  const barHeight = CONTEXT_BAR.barHeight
  const barX = agent.x - barWidth / 2
  const barY = agent.y + radius + CONTEXT_BAR.yOffset + extraYOffset

  // Background
  ctx.fillStyle = COLORS.cardBgDark
  ctx.beginPath()
  ctx.roundRect(barX - 2, barY - 2, barWidth + 4, barHeight + 14, CONTEXT_BAR.borderRadius)
  ctx.fill()

  // Label — tabular metric, keep monospace. Toggleable ("token count").
  if (showCount) {
    ctx.fillStyle = COLORS.textMuted
    ctx.font = `${CONTEXT_BAR.fontSize}px ${CANVAS_FONT.mono}`
    ctx.textAlign = 'center'
    ctx.fillText(`${formatTokens(total)} / ${formatTokens(agent.tokensMax)} tokens`, agent.x, barY + barHeight + CONTEXT_BAR.labelPadding)
  }

  // Segments
  const segments = contextSegments(bd)

  let x = barX
  const maxWidth = barWidth * (total / agent.tokensMax)

  for (const seg of segments) {
    if (seg.value <= 0) continue
    const segWidth = (seg.value / total) * maxWidth
    ctx.fillStyle = seg.color
    ctx.fillRect(x, barY, segWidth, barHeight)
    x += segWidth
  }

  // Remaining capacity
  if (x < barX + barWidth) {
    ctx.fillStyle = COLORS.holoBg05
    ctx.fillRect(x, barY, barX + barWidth - x, barHeight)
  }

  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 0.5
  ctx.strokeRect(barX, barY, barWidth, barHeight)
}

// ─── State color cross-fade ──────────────────────────────────────────────────
// State changes cross-fade smoothly rather than snapping. Held in a module map
// (not on the Agent type) so the data schema is untouched. Result stays 6-digit
// hex so the `color + 'xx'` concat contract elsewhere still holds.
const agentColorRgb = new Map<string, [number, number, number]>()
let lastColorTime = 0

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}
function getAgentColor(id: string, target: string, dt: number): string {
  const [tr, tg, tb] = hexToRgb(target)
  const cur = agentColorRgb.get(id)
  if (!cur || PREFERS_REDUCED_MOTION) {
    agentColorRgb.set(id, [tr, tg, tb])
    return target
  }
  const t = Math.min(1, dt * NODE_DRAW.colorLerpSpeed)
  const next: [number, number, number] = [
    cur[0] + (tr - cur[0]) * t,
    cur[1] + (tg - cur[1]) * t,
    cur[2] + (tb - cur[2]) * t,
  ]
  agentColorRgb.set(id, next)
  return rgbToHex(next[0], next[1], next[2])
}

// ─── Node form: flat squircle card + state badge ─────────────────────────────

function drawNodeCard(
  ctx: CanvasRenderingContext2D,
  agent: Agent, half: number, color: string, cardFill: string,
  isHovered: boolean, isSelected: boolean, isWaiting: boolean, time: number,
) {
  const emphasis = isHovered || isSelected
  const radius = half * NODE_DRAW.cornerScale

  // Single soft elevation shadow behind a solid card. Fill is white by default,
  // or a soft wash of the user's identity color when one is assigned.
  ctx.save()
  ctx.shadowColor = emphasis ? NODE_DRAW.shadowColorEmphasis : NODE_DRAW.shadowColor
  ctx.shadowBlur = emphasis ? NODE_DRAW.shadowBlurEmphasis : NODE_DRAW.shadowBlur
  ctx.shadowOffsetY = NODE_DRAW.shadowOffsetY
  drawSquircle(ctx, agent.x, agent.y, half, radius)
  ctx.fillStyle = cardFill
  ctx.fill()
  ctx.restore()

  // Hairline border in the (cross-fading) state color. Shape also carries
  // meaning: complete = dashed, waiting = animated dashed, error = heavier.
  drawSquircle(ctx, agent.x, agent.y, half, radius)
  ctx.strokeStyle = color
  ctx.lineWidth = (agent.state === 'error' || emphasis) ? NODE_DRAW.borderWidthEmphasis : NODE_DRAW.borderWidth
  if (agent.state === 'complete') {
    ctx.setLineDash([5, 4])
  } else if (isWaiting) {
    ctx.setLineDash([6, 4])
    ctx.lineDashOffset = PREFERS_REDUCED_MOTION ? 0 : -time * AGENT_DRAW.waitingDashSpeed
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
}

/** Uniform, SF-Symbols-style white line glyph encoding the state (so state is
 *  never conveyed by color alone). */
function drawStateGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, state: AgentState, time: number) {
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = Math.max(1, s * 0.34)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (state) {
    case 'complete': {
      ctx.beginPath()
      ctx.moveTo(cx - s * 0.55, cy + s * 0.02)
      ctx.lineTo(cx - s * 0.1, cy + s * 0.45)
      ctx.lineTo(cx + s * 0.6, cy - s * 0.45)
      ctx.stroke()
      break
    }
    case 'error': {
      ctx.beginPath()
      ctx.moveTo(cx, cy - s * 0.6)
      ctx.lineTo(cx, cy + s * 0.15)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy + s * 0.55, Math.max(0.8, s * 0.16), 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'waiting_permission': {
      // Lock: rounded body + shackle arc
      ctx.beginPath()
      ctx.roundRect(cx - s * 0.5, cy - s * 0.05, s, s * 0.68, s * 0.16)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy - s * 0.05, s * 0.32, Math.PI, 0)
      ctx.stroke()
      break
    }
    case 'tool_calling': {
      // Activity spinner — 3/4 arc, rotates unless reduced motion
      const a = PREFERS_REDUCED_MOTION ? -Math.PI / 2 : time * 3
      ctx.beginPath()
      ctx.arc(cx, cy, s * 0.62, a, a + Math.PI * 1.5)
      ctx.stroke()
      break
    }
    case 'thinking': {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath()
        ctx.arc(cx + i * s * 0.5, cy, Math.max(0.8, s * 0.16), 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'paused': {
      ctx.fillRect(cx - s * 0.45, cy - s * 0.5, s * 0.3, s)
      ctx.fillRect(cx + s * 0.15, cy - s * 0.5, s * 0.3, s)
      break
    }
    default: { // idle — ready dot
      ctx.beginPath()
      ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawStateBadge(
  ctx: CanvasRenderingContext2D,
  agent: Agent, radius: number, half: number, color: string, time: number,
) {
  const br = radius * NODE_DRAW.badgeScale
  const bx = agent.x + half * 0.72
  const by = agent.y - half * 0.72

  // White separator ring so the badge reads cleanly against the card/scene.
  ctx.beginPath()
  ctx.arc(bx, by, br + 1.5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  drawStateGlyph(ctx, bx, by, br * 0.55, agent.state, time)
}

/**
 * Draw the node's name + optional goal subtitle beneath it, each word-wrapped to
 * up to two lines so several words are legible at a glance (the full, untruncated
 * task still lives in the detail card). Returns the absolute Y of the bottom of
 * the label block, so the caller can push the token bar below it.
 */
function drawAgentLabel(ctx: CanvasRenderingContext2D, agent: Agent, half: number, isHovered: boolean, name: string, subtitle?: string, showSubtitle = false): number {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  // Generous widths, still well inside the ~200px inter-node spacing. The goal
  // gets a wider box + smaller type so several words fit across its two lines.
  const nameMaxW = half * 5
  const goalMaxW = half * 7
  const nameLineH = 14
  const goalLineH = 10.5
  let y = agent.y + half + AGENT_DRAW.labelYOffset

  // Primary name — up to 2 lines. Type carries hierarchy through weight + size.
  ctx.fillStyle = isHovered ? COLORS.textPrimary : COLORS.textDim
  ctx.font = `600 12px ${CANVAS_FONT.sans}`
  for (const line of wrapTextLines(ctx, name, nameMaxW, 2)) {
    ctx.fillText(line, agent.x, y)
    y += nameLineH
  }

  // Optional goal subtitle — dim, smaller, up to 2 lines (main-agent nodes only).
  // Off by default (the hover tooltip is the usual way to read the goal); shown
  // inline only when the user toggles sublabels on.
  if (subtitle && showSubtitle) {
    y += AGENT_DRAW.subtitleGap
    ctx.fillStyle = COLORS.textMuted
    ctx.font = `500 8.5px ${CANVAS_FONT.sans}`
    for (const line of wrapTextLines(ctx, subtitle, goalMaxW, 2)) {
      ctx.fillText(line, agent.x, y)
      y += goalLineH
    }
  }

  return y
}

function drawStatsOverlay(ctx: CanvasRenderingContext2D, agent: Agent, radius: number) {
  const sy = agent.y - radius - STATS_OVERLAY.yOffset
  ctx.fillStyle = COLORS.cardBgDark
  ctx.beginPath()
  ctx.roundRect(agent.x - STATS_OVERLAY.boxWidth / 2, sy, STATS_OVERLAY.boxWidth, STATS_OVERLAY.boxHeight, STATS_OVERLAY.borderRadius)
  ctx.fill()
  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 0.5
  ctx.stroke()
  ctx.fillStyle = COLORS.textMuted
  ctx.font = `${STATS_OVERLAY.fontSize}px ${CANVAS_FONT.mono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`${agent.toolCalls} tools · ${agent.timeAlive.toFixed(1)}s`, agent.x, sy + STATS_OVERLAY.textPaddingY)
}

export function drawAgents(
  ctx: CanvasRenderingContext2D,
  agents: Map<string, Agent>,
  selectedAgentId: string | null,
  hoveredAgentId: string | null,
  showStats: boolean,
  time: number,
  agentColors?: Map<string, string>,
  agentNames?: Map<string, string>,
  agentSubtitles?: Map<string, string>,
  showTokens = true,
  showSubtitles = false,
) {
  const dt = Math.min(0.1, Math.max(0, time - lastColorTime))
  lastColorTime = time

  for (const [id, agent] of agents) {
    const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const color = getAgentColor(id, getStateColor(agent.state), dt)
    // User identity color → soft card-fill wash (orthogonal to the state color).
    const userColor = agentColors?.get(id)
    const label = agentNames?.get(id) ?? agent.name
    const subtitle = agentSubtitles?.get(id)
    const cardFill = userColor ? washOverWhite(userColor, 0.18) : '#ffffff'
    const isHovered = id === hoveredAgentId
    const isSelected = id === selectedAgentId
    const isWaiting = agent.state === 'waiting_permission'

    // Subtle breathing only (no HUD scanlines/orbits/ripples); off under reduced motion.
    const breathe = PREFERS_REDUCED_MOTION
      ? 1
      : isWaiting
      ? Math.sin(time * AGENT_DRAW.waitingBreatheSpeed) * AGENT_DRAW.waitingBreatheAmp + 1
      : agent.state === 'thinking'
      ? Math.sin(time * ANIM.breathe.thinkingSpeed) * ANIM.breathe.thinkingAmp + 1
      : agent.state === 'idle' ? Math.sin(time * ANIM.breathe.idleSpeed) * ANIM.breathe.idleAmp + 1 : 1

    const half = radius * NODE_DRAW.halfScale * breathe * agent.scale

    ctx.save()
    ctx.globalAlpha = agent.opacity

    drawNodeCard(ctx, agent, half, color, cardFill, isHovered, isSelected, isWaiting, time)
    drawAgentBrand(ctx, agent.x, agent.y, half * 2.2, COLORS.textPrimary, agent.runtime)
    drawStateBadge(ctx, agent, radius, half, color, time)
    const labelBottom = drawAgentLabel(ctx, agent, half, isHovered, label, subtitle, showSubtitles)

    // Token/context bar — user-toggleable (showTokens). The context ring was
    // removed; the bar is the only token readout now. When off, nothing is drawn.
    if (showTokens && (agent.state !== 'complete' || agent.opacity > 0.5)) {
      // Push the bar below the (multi-line, variable-height) label so it never
      // overlaps a wrapped name/goal.
      const barBaseY = agent.y + radius + CONTEXT_BAR.yOffset
      const reserve = Math.max(0, labelBottom + AGENT_DRAW.labelBarGap - barBaseY)
      drawContextComposition(ctx, agent, radius, reserve, true)
    }

    if (showStats && agent.state !== 'complete') {
      drawStatsOverlay(ctx, agent, radius)
    }

    ctx.restore()
  }
}
