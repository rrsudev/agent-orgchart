'use client'

import { useState, useCallback, useEffect } from 'react'

/**
 * Per-agent identity colors, persisted in localStorage (mirrors the session-tab
 * rename precedent in use-vscode-bridge). Colors survive reloads once set.
 *
 * Entries are keyed by `${sessionId}␞${agentName}` so a color is scoped to one
 * agent in one session and does NOT bleed across sessions that happen to reuse a
 * name (e.g. every session's "orchestrator"). The key is view-mode agnostic: in
 * the parallel view an agent's id is already `${sessionId}␞${name}`, so it maps
 * to the same key as the single-session view — a color set in one shows in both.
 */
const STORAGE_KEY = 'agent-orgchart:agent-colors'

/** Record-separator glyph — matches SESSION_SEP in use-vscode-bridge; never
 *  appears in a real agent name. */
export const AGENT_KEY_SEP = '␞'
const SEP = AGENT_KEY_SEP

/** Build the stable per-(session, agent) color key from a canvas agent id. */
export function agentColorKey(sessionId: string | null, agentId: string): string {
  // Parallel-view ids are already namespaced (`sessionId␞name`) — use as-is.
  if (agentId.includes(SEP)) return agentId
  return `${sessionId ?? ''}${SEP}${agentId}`
}

export function useAgentColors() {
  const [colors, setColors] = useState<Map<string, string>>(new Map())

  // Load after mount to avoid any SSR/hydration mismatch (canvas-only data).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setColors(new Map(Object.entries(JSON.parse(raw))))
    } catch { /* ignore malformed storage */ }
  }, [])

  /** Set (hex) or clear (null) the color for a key produced by agentColorKey(). */
  const setAgentColor = useCallback((key: string, hex: string | null) => {
    setColors(prev => {
      const next = new Map(prev)
      if (hex) next.set(key, hex)
      else next.delete(key)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)))
        } catch { /* ignore quota/availability errors */ }
      }
      return next
    })
  }, [])

  return { colors, setAgentColor }
}
