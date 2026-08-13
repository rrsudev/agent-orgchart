import type { Agent, ToolCallNode, Discovery } from '@/lib/agent-types'
import { NODE } from '@/lib/agent-types'
import {
  BUBBLE_MAX_W, BUBBLE_GAP,
  TOOL_MAX_CARD_W, getDiscoveryCardDimensions,
  AGENT_DRAW, HIT_DETECTION, BUBBLE_DRAW, TOOL_DRAW, NODE_DRAW,
} from '@/lib/canvas-constants'
import { bubbleAlpha } from './bubble-utils'

/**
 * Find which agent's NAME LABEL (the text drawn just below the node) is at the
 * given canvas-space coordinates. Returns the agent id, or null.
 *
 * Geometry mirrors drawAgentLabel: the label starts at `agent.y + half +
 * labelYOffset` and spans the name line plus an optional subtitle line, centered
 * on the node. `half` uses the resting size (breathing/scale ≈ 1); the hit box is
 * intentionally generous so the name is easy to tap. Used to open inline rename
 * on a tap of the name (distinct from tapping the node body, which selects it).
 */
export function findAgentLabelAt(
  x: number,
  y: number,
  agents: Map<string, Agent>,
): string | null {
  for (const [id, agent] of agents) {
    if (agent.opacity < 0.3) continue
    const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const half = radius * NODE_DRAW.halfScale
    const nameY = agent.y + half + AGENT_DRAW.labelYOffset
    // Covers the wrapped name block (≤2 lines) plus an optional wrapped goal
    // subtitle (≤2 lines) — matches drawAgentLabel's max height.
    const top = nameY - 2
    const bottom = nameY + 56
    const hitHalfW = Math.max(half * 3.5, 60)
    if (x >= agent.x - hitHalfW && x <= agent.x + hitHalfW && y >= top && y <= bottom) return id
  }
  return null
}

/**
 * Find which agent (if any) is at the given canvas-space coordinates.
 * Returns the agent id, or null.
 */
export function findAgentAt(
  x: number,
  y: number,
  agents: Map<string, Agent>,
): string | null {
  for (const [id, agent] of agents) {
    const size = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const dx = x - agent.x
    const dy = y - agent.y
    if (dx * dx + dy * dy < size * size) return id
  }
  return null
}

/**
 * Find which tool-call card (if any) is at the given canvas-space coordinates.
 * Returns the tool-call id, or null.
 */
export function findToolCallAt(
  x: number,
  y: number,
  toolCalls: Map<string, ToolCallNode>,
): string | null {
  for (const [id, tool] of toolCalls) {
    if (tool.opacity < 0.1) continue
    // Match the card dimensions from drawToolCalls
    const isRunning = tool.state === 'running'
    const isError = tool.state === 'error'
    const labelLen = (`${tool.toolName}: ${tool.args}`).length * HIT_DETECTION.toolCharWidth + 12
    const cardW = Math.max(60, Math.min(labelLen, TOOL_MAX_CARD_W))
    const cardH = (!isRunning && (tool.tokenCost || isError)) ? TOOL_DRAW.expandedHeight : TOOL_DRAW.collapsedHeight
    const cardX = tool.x - cardW / 2
    const cardY = tool.y - cardH / 2
    if (x >= cardX && x <= cardX + cardW && y >= cardY && y <= cardY + cardH) return id
  }
  return null
}

/**
 * Find which agent's message bubble (if any) is at the given canvas-space coordinates.
 * Returns the agent id, or null.
 */
export function findBubbleAgentAt(
  x: number,
  y: number,
  agents: Map<string, Agent>,
  currentTime: number,
): string | null {
  for (const agent of agents.values()) {
    if (agent.messageBubbles.length === 0) continue
    const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const anchorX = agent.x + radius + AGENT_DRAW.bubbleAnchorOffset
    let cursorY = agent.y + AGENT_DRAW.bubbleCursorY
    for (const bubble of agent.messageBubbles) {
      const age = currentTime - bubble.time
      const alpha = bubbleAlpha(age, agent.opacity)
      if (alpha < 0.01) continue

      // Use cached dimensions from the draw pass when available;
      // fall back to char-width estimation for the first frame.
      let bubbleW: number
      let bubbleH: number
      if (bubble._cachedW != null && bubble._cachedH != null) {
        bubbleW = bubble._cachedW
        bubbleH = bubble._cachedH
      } else {
        const isThinking = bubble.role === 'thinking'
        const style = isThinking ? BUBBLE_DRAW.thinking : BUBBLE_DRAW.normal
        const charW = HIT_DETECTION.bubbleCharWidth
        const maxChars = Math.floor((BUBBLE_MAX_W - style.padding * 2) / charW)
        let lineCount = 0
        for (const para of bubble.text.split('\n')) {
          if (para.trim() === '') { lineCount++; continue }
          const words = para.split(/\s+/)
          let line = ''
          for (const word of words) {
            if (line && (line + ' ' + word).length > maxChars) { lineCount++; line = word }
            else line = line ? line + ' ' + word : word
          }
          if (line) lineCount++
        }
        if (lineCount === 0) lineCount = 1
        bubbleW = BUBBLE_MAX_W
        bubbleH = style.headerH + lineCount * style.lineH + style.padding
      }

      if (x >= anchorX && x <= anchorX + bubbleW && y >= cursorY && y <= cursorY + bubbleH) {
        return agent.id
      }
      cursorY += bubbleH + BUBBLE_GAP
    }
  }
  return null
}

/**
 * Find which discovery card (if any) is at the given canvas-space coordinates.
 * Returns the discovery id, or null.
 */
export function findDiscoveryAt(
  x: number,
  y: number,
  discoveries: Discovery[],
): string | null {
  for (const disc of discoveries) {
    if (disc.opacity < 0.1) continue
    // Match the card dimensions from drawDiscoveries
    const lines = disc.content.split('\n')
    const { cardW, cardH } = getDiscoveryCardDimensions(disc.label, lines)
    const cardX = disc.x - cardW / 2
    const cardY = disc.y - cardH / 2
    if (x >= cardX && x <= cardX + cardW && y >= cardY && y <= cardY + cardH) return disc.id
  }
  return null
}
