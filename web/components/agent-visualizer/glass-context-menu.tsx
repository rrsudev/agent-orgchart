'use client'

import { useRef, type ReactNode } from 'react'
import { Z, TIMING } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { GlassCard } from './glass-card'
import { useClickOutside } from '@/hooks/use-click-outside'
import { stopPropagationHandlers } from './shared-ui'
import { Icon, type IconName } from './chrome'

interface ContextMenuProps {
  position: { x: number; y: number }
  items: Array<{
    label?: string
    /** Leading glyph. Drawn from the shared icon set so menu rows match the rest
     *  of the chrome — emoji rendered at their own size and color here. */
    icon?: IconName
    onClick?: () => void
    danger?: boolean
    separator?: boolean
    /** Custom row content (e.g. a color-swatch picker) rendered instead of a button. */
    node?: ReactNode
  }>
  onClose: () => void
}

export function GlassContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useClickOutside(ref, onClose, TIMING.contextMenuDelayMs)

  return (
    <div
      ref={ref}
      {...stopPropagationHandlers}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: Z.contextMenu,
      }}
    >
      <GlassCard
        visible={true}
        style={{ minWidth: 160 }}
      >
        <div className="py-1">
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="my-1 h-px" style={{ background: COLORS.holoBg10 }} />
            ) : item.node ? (
              <div key={i} className="px-3 py-1.5">{item.node}</div>
            ) : (
              <button
                key={i}
                onClick={() => {
                  item.onClick?.()
                  onClose()
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 text-left ui-sm transition-colors hover:bg-black/5"
                style={{ color: item.danger ? COLORS.error : COLORS.textPrimary }}
              >
                {item.icon && (
                  <span className="shrink-0" style={{ color: COLORS.textMuted }}>
                    <Icon name={item.icon} />
                  </span>
                )}
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            )
          )}
        </div>
      </GlassCard>
    </div>
  )
}
