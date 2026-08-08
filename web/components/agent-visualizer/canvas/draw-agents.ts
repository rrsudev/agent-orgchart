import { Agent, NODE, ANIM, AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor, contextSegments } from '@/lib/colors'
import {
  AGENT_DRAW, CONTEXT_BAR, CONTEXT_RING, STATS_OVERLAY, NODE_DRAW, CANVAS_FONT, PREFERS_REDUCED_MOTION,
} from '@/lib/canvas-constants'
import { formatTokens } from '@/lib/utils'
import { truncateText, drawSquircle, CLAUDE_SPARK_D, OPENAI_LOGO_D, OPENAI_LOGO_VIEWBOX } from './draw-misc'

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
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const barWidth = Math.max(CONTEXT_BAR.minWidth, radius * CONTEXT_BAR.widthMultiplier)
  const barHeight = CONTEXT_BAR.barHeight
  const barX = agent.x - barWidth / 2
  const barY = agent.y + radius + CONTEXT_BAR.yOffset

  // Background
  ctx.fillStyle = COLORS.cardBgDark
  ctx.beginPath()
  ctx.roundRect(barX - 2, barY - 2, barWidth + 4, barHeight + 14, CONTEXT_BAR.borderRadius)
  ctx.fill()

  // Label — tabular metric, keep monospace
  ctx.fillStyle = COLORS.textMuted
  ctx.font = `${CONTEXT_BAR.fontSize}px ${CANVAS_FONT.mono}`
  ctx.textAlign = 'center'
  ctx.fillText(`${formatTokens(total)} / ${formatTokens(agent.tokensMax)} tokens`, agent.x, barY + barHeight + CONTEXT_BAR.labelPadding)

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

export function drawContextRing(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
  time: number,
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const usage = total / agent.tokensMax
  const ringR = radius + CONTEXT_RING.ringOffset
  const ringW = CONTEXT_RING.ringWidth
  const startAngle = -Math.PI / 2

  // Background ring (empty capacity)
  ctx.beginPath()
  ctx.arc(agent.x, agent.y, ringR, 0, Math.PI * 2)
  ctx.strokeStyle = COLORS.holoBorder06
  ctx.lineWidth = ringW
  ctx.stroke()

  // Filled segments
  const segments = contextSegments(bd)

  let currentAngle = startAngle
  for (const seg of segments) {
    if (seg.value <= 0) continue
    const sweep = (seg.value / agent.tokensMax) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, ringR, currentAngle, currentAngle + sweep)
    ctx.strokeStyle = seg.color
    ctx.lineWidth = ringW
    ctx.stroke()
    currentAngle += sweep
  }

  // Subtle warning at high usage (no luminance glow — a slightly heavier ring)
  if (usage > CONTEXT_RING.warningThreshold) {
    const warningColor = usage > CONTEXT_RING.criticalThreshold ? COLORS.error : COLORS.tool
    const pulse = PREFERS_REDUCED_MOTION ? 0 : Math.sin(time * (usage > CONTEXT_RING.criticalThreshold ? 6 : 3))
    const intensity = (usage > CONTEXT_RING.criticalThreshold ? 0.4 : 0.22) + pulse * 0.1

    ctx.save()
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, ringR + CONTEXT_RING.glowPadding, 0, Math.PI * 2)
    ctx.strokeStyle = warningColor
    ctx.lineWidth = CONTEXT_RING.glowLineWidth
    ctx.globalAlpha = Math.max(0, intensity)
    ctx.stroke()
    ctx.restore()
  }

  // Percentage label when usage is high — tabular, monospace
  if (usage > CONTEXT_RING.percentLabelThreshold) {
    ctx.font = `${CONTEXT_BAR.fontSize}px ${CANVAS_FONT.mono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = usage > CONTEXT_RING.criticalThreshold ? COLORS.error : usage > CONTEXT_RING.warningThreshold ? COLORS.tool : COLORS.textDim
    ctx.fillText(`${Math.floor(usage * 100)}%`, agent.x, agent.y - radius - CONTEXT_RING.percentYOffset)
  }
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
  agent: Agent, half: number, color: string,
  isHovered: boolean, isSelected: boolean, isWaiting: boolean, time: number,
) {
  const emphasis = isHovered || isSelected
  const radius = half * NODE_DRAW.cornerScale

  // Single soft elevation shadow behind a solid white card.
  ctx.save()
  ctx.shadowColor = emphasis ? NODE_DRAW.shadowColorEmphasis : NODE_DRAW.shadowColor
  ctx.shadowBlur = emphasis ? NODE_DRAW.shadowBlurEmphasis : NODE_DRAW.shadowBlur
  ctx.shadowOffsetY = NODE_DRAW.shadowOffsetY
  drawSquircle(ctx, agent.x, agent.y, half, radius)
  ctx.fillStyle = '#ffffff'
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

function drawAgentLabel(ctx: CanvasRenderingContext2D, agent: Agent, half: number, isHovered: boolean) {
  ctx.fillStyle = isHovered ? COLORS.textPrimary : COLORS.textDim
  // Type carries hierarchy through weight + size, on the system stack.
  ctx.font = `600 12px ${CANVAS_FONT.sans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const maxLabelW = half * 3
  const agentLabel = truncateText(ctx, agent.name, maxLabelW)
  ctx.fillText(agentLabel, agent.x, agent.y + half + AGENT_DRAW.labelYOffset)
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
) {
  const dt = Math.min(0.1, Math.max(0, time - lastColorTime))
  lastColorTime = time

  for (const [id, agent] of agents) {
    const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const color = getAgentColor(id, getStateColor(agent.state), dt)
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

    drawNodeCard(ctx, agent, half, color, isHovered, isSelected, isWaiting, time)
    drawAgentBrand(ctx, agent.x, agent.y, half * 2.2, COLORS.textPrimary, agent.runtime)
    drawStateBadge(ctx, agent, radius, half, color, time)
    drawAgentLabel(ctx, agent, half, isHovered)

    // Context composition — ring for main agent, bar for all
    if (agent.state !== 'complete' || agent.opacity > 0.5) {
      if (agent.isMain) {
        drawContextRing(ctx, agent, radius, time)
      }
      drawContextComposition(ctx, agent, radius)
    }

    if (showStats && agent.state !== 'complete') {
      drawStatsOverlay(ctx, agent, radius)
    }

    ctx.restore()
  }
}
