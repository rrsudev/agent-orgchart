'use client'

import { useEffect, useRef, useState } from 'react'
import { assignCallSigns } from '@/lib/callsigns'

/**
 * Auto-assigns each open session a stable, distinct call-sign, persisted in
 * localStorage. A sibling to use-agent-colors / use-agent-names, but AUTOMATIC:
 * the value is derived from the open-tab set, not chosen by the user. A tab
 * rename (use-vscode-bridge) still overrides it downstream — see resolveSessionName.
 *
 * Pass the open sessions in tab order; returns `id → call-sign`. Recomputed only
 * when the set/order of ids changes, and persisted so a session keeps its
 * call-sign across reloads (and frees it for reuse once closed).
 */
const STORAGE_KEY = 'agent-orgchart:session-callsigns'

export function useSessionCallSigns(sessions: readonly { id: string }[]): Map<string, string> {
  const [callSigns, setCallSigns] = useState<Map<string, string>>(new Map())
  // Latest assignment, read synchronously inside the effect WITHOUT being an
  // effect dependency (which would re-run it on every assignment change).
  const ref = useRef<Map<string, string>>(new Map())

  // Load persisted assignments once. Into the ref (not rendered) so it can be
  // synchronous without risking an SSR/hydration mismatch; state fills post-mount.
  const loadedRef = useRef(false)
  if (!loadedRef.current) {
    loadedRef.current = true
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) ref.current = new Map(Object.entries(JSON.parse(raw)))
      } catch { /* ignore malformed storage */ }
    }
  }

  const idsKey = sessions.map(s => s.id).join('␞') // record-separator; never in an id
  useEffect(() => {
    const ids = idsKey ? idsKey.split('␞') : []
    const next = assignCallSigns(ids, ref.current)
    ref.current = next
    // Persist only currently-open sessions (prune closed) so freed call-signs
    // recycle and storage never grows unbounded.
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)))
      } catch { /* ignore quota/availability errors */ }
    }
    setCallSigns(next)
  }, [idsKey])

  return callSigns
}
