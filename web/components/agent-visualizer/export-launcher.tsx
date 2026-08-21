'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { useLayout } from '@/lib/layout'
import { ChromeButton, Icon } from './chrome'

/**
 * A small, non-invasive export affordance that lives in the bottom dock's left
 * slot (bottom-left corner). It gives participants a findable, one-click way to
 * package and hand off their captured session logs WITHOUT hunting the command
 * palette or their filesystem.
 *
 * It renders in both deployments, so the affordance is always where people look:
 *   - In the VS Code extension it exposes the real actions — export a zip and
 *     reveal the capture folder — via the wired handlers.
 *   - On the web/localhost build there is no capture backend (the recorder runs
 *     only inside the extension host), so instead of a dead button it opens a
 *     short guidance note explaining where logging happens.
 *
 * The popover opens UPWARD (the trigger sits on the bottom edge), and dismisses
 * on outside-click or Escape like the other menus in this surface.
 */
export function ExportLauncher({ isVSCode, onExport, onRevealFolder }: {
  isVSCode: boolean
  /** Package captured logs into a zip (VS Code only). */
  onExport?: () => void
  /** Reveal the local capture folder in the OS file explorer (VS Code only). */
  onRevealFolder?: () => void
}) {
  const { narrow, panelHeight, width, gutter } = useLayout()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div ref={rootRef} className="relative shrink-0">
      <ChromeButton
        icon="download"
        iconOnly={narrow}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export session logs"
        title="Export your session logs to send to the researchers"
      >
        Export logs
      </ChromeButton>

      {open && (
        <div
          role="menu"
          className="glass-card is-dense absolute bottom-full mb-1.5 left-0 flex flex-col gap-0.5 panel-scroll"
          style={{
            minWidth: 220,
            maxWidth: Math.min(300, width - gutter * 2),
            maxHeight: panelHeight(0, 0),
            zIndex: Z.contextMenu,
            padding: 6,
          }}
        >
          {isVSCode ? (
            <>
              <p className="px-2 pt-1 pb-2 ui-xs" style={{ color: COLORS.textMuted }}>
                Package your captured sessions into a single zip to send to the
                researchers. Nothing leaves your machine automatically.
              </p>
              {onExport && (
                <MenuButton icon="archive" onClick={() => { onExport(); close() }}>
                  Export logs (.zip)
                </MenuButton>
              )}
              {onRevealFolder && (
                <MenuButton icon="files" onClick={() => { onRevealFolder(); close() }}>
                  Open logs folder
                </MenuButton>
              )}
            </>
          ) : (
            <p className="px-2 py-1.5 ui-xs" style={{ color: COLORS.textMuted, lineHeight: 1.5 }}>
              Session logging and export run inside the installed VS&nbsp;Code
              extension. Open the Agent&nbsp;Fruitstand panel there to capture your
              sessions and export a zip for the researchers — this preview build
              (browser) doesn&apos;t record anything.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** One action row in the export popover. */
function MenuButton({ icon, children, onClick }: {
  icon: 'archive' | 'files'
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors hover:bg-black/5 ui-sm"
      style={{ color: COLORS.textDim }}
    >
      <Icon name={icon} />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}
