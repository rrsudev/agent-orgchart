'use client'

import { useState, useCallback, useEffect } from 'react'

/**
 * Per-agent CUSTOM names, persisted in localStorage. Mirrors use-agent-colors:
 * keyed by `${sessionId}␞${agentName}` (via agentColorKey) so a rename is scoped
 * to one agent in one session and survives reloads. A custom name overrides the
 * default label everywhere (canvas + panels); clearing it restores the default.
 */
const STORAGE_KEY = 'agent-orgchart:agent-names'

export function useAgentNames() {
  const [names, setNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setNames(new Map(Object.entries(JSON.parse(raw))))
    } catch { /* ignore malformed storage */ }
  }, [])

  /** Set (name) or clear (null/empty) the custom name for a key from agentColorKey(). */
  const setAgentName = useCallback((key: string, name: string | null) => {
    setNames(prev => {
      const next = new Map(prev)
      const trimmed = name?.trim()
      if (trimmed) next.set(key, trimmed)
      else next.delete(key)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)))
        } catch { /* ignore quota/availability errors */ }
      }
      return next
    })
  }, [])

  return { names, setAgentName }
}
