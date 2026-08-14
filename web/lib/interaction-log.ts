'use client'

/**
 * logInteraction — record a discrete UI interaction (currently agent/session
 * renames) to the host for distinctive on-disk logging.
 *
 * Mirrors the study-session dispatch in use-study-session: inside VS Code the
 * bridge forwards it to the extension host; standalone POSTs to the dev relay.
 * Always best-effort — never throws into React / an input handler.
 */
import { vscodeBridge, type InteractionRecord } from '@/lib/vscode-bridge'

export function logInteraction(record: Omit<InteractionRecord, 'at'> & { at?: string }): void {
  const payload: InteractionRecord = { at: new Date().toISOString(), ...record }
  try {
    if (vscodeBridge?.isVSCode) {
      vscodeBridge.sendInteraction(payload)
    } else if (typeof window !== 'undefined') {
      const port = process.env.NEXT_PUBLIC_RELAY_PORT || ''
      const url = port ? `http://127.0.0.1:${port}/interaction` : '/interaction'
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {})
    }
  } catch { /* logging must never disrupt the interaction */ }
}
