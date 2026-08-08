import { ToolCallNode } from '@/lib/agent-types'
import { COLORS, withAlpha } from '@/lib/colors'
import { TOOL_MAX_CARD_W, TOOL_DRAW, PREFERS_REDUCED_MOTION } from '@/lib/canvas-constants'
import { truncateText } from './draw-misc'
import { measureTextCached } from './render-cache'

export function drawToolCalls(
  ctx: CanvasRenderingContext2D,
  toolCalls: Map<string, ToolCallNode>,
  time: number,
  selectedToolCallId?: string | null,
) {
  for (const [id, tool] of toolCalls) {
    const isRunning = tool.state === 'running'
    const isError = tool.state === 'error'

    ctx.save()
    ctx.globalAlpha = tool.opacity

    ctx.font = `${TOOL_DRAW.fontSize}px monospace`
    const toolLabel = `${tool.toolName}: ${tool.args}`
    const label = truncateText(ctx, toolLabel, TOOL_MAX_CARD_W - 12)
    const textWidth = Math.min(measureTextCached(ctx, label) + 12, TOOL_MAX_CARD_W)
    const cardW = Math.max(60, textWidth)
    const cardH = (!isRunning && (tool.tokenCost || isError)) ? TOOL_DRAW.expandedHeight : TOOL_DRAW.collapsedHeight
    const cardX = tool.x - cardW / 2
    const cardY = tool.y - cardH / 2

    const isSelected = id === selectedToolCallId

    // Flat card: solid white fill + single soft elevation shadow + hairline
    // border in the state color (no glow / crack lines).
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.1)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 2
    ctx.beginPath()
    ctx.roundRect(cardX, cardY, cardW, cardH, TOOL_DRAW.borderRadius)
    ctx.fillStyle = isError
      ? withAlpha(COLORS.toolCardErrorBase, 0.1)
      : isSelected ? withAlpha(COLORS.toolCardSelectedBase, 0.1) : withAlpha(COLORS.toolCardBase, 0.96)
    ctx.fill()
    ctx.restore()

    ctx.beginPath()
    ctx.roundRect(cardX, cardY, cardW, cardH, TOOL_DRAW.borderRadius)
    ctx.strokeStyle = isError
      ? COLORS.error
      : isSelected ? COLORS.holoBase : isRunning ? COLORS.tool : COLORS.return + '90'
    ctx.lineWidth = (isError || isSelected) ? 1.75 : 1.25
    ctx.stroke()

    // Quiet activity ring while running (static under reduced motion)
    if (isRunning) {
      const spin = PREFERS_REDUCED_MOTION ? -Math.PI / 2 : time * TOOL_DRAW.spinSpeed
      ctx.beginPath()
      ctx.arc(tool.x, tool.y, Math.max(cardW, cardH) / 2 + TOOL_DRAW.spinRingPadding, spin, spin + TOOL_DRAW.spinArc)
      ctx.strokeStyle = COLORS.tool + '80'
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.lineCap = 'butt'
    }

    const truncatedLabel = truncateText(ctx, toolLabel, cardW - 8)

    ctx.font = `${TOOL_DRAW.fontSize}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (isRunning) {
      ctx.fillStyle = COLORS.tool
      ctx.fillText(truncatedLabel, tool.x, tool.y)
    } else if (isError) {
      ctx.fillStyle = COLORS.error
      ctx.fillText(truncateText(ctx, `${tool.toolName}: FAILED`, cardW - 8), tool.x, tool.y - TOOL_DRAW.twoLineOffset)
      ctx.font = `${TOOL_DRAW.errorFontSize}px monospace`
      ctx.fillStyle = COLORS.error + 'aa'
      ctx.fillText(truncateText(ctx, tool.errorMessage || tool.result || '', cardW - 8), tool.x, tool.y + TOOL_DRAW.twoLineOffset + 2)
    } else {
      // Completed card: show action + file path (most useful info at a glance)
      ctx.fillStyle = COLORS.return
      ctx.fillText(truncatedLabel, tool.x, tool.y - TOOL_DRAW.twoLineOffset)
      if (tool.tokenCost) {
        // Token cost as dim text below
        ctx.fillStyle = COLORS.tool + '90'
        ctx.font = `${TOOL_DRAW.tokenFontSize}px monospace`
        ctx.fillText(`${tool.tokenCost} tok`, tool.x, tool.y + TOOL_DRAW.twoLineOffset + 2)
      }
    }

    ctx.restore()
  }
}
