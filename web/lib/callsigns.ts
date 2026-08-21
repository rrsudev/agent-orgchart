/**
 * Value-neutral session "call-signs".
 *
 * Each open session gets a short, distinct handle (Apple, Mango, Melon, …)
 * instead of a truncated goal fragment. Call-signs are deliberately
 * NON-PRESCRIPTIVE: they identify a session without telling the viewer how to
 * think about what its agent is doing — which matters for the study this tool
 * backs (a name like "fix auth" would prime a mental model; "Apple" doesn't).
 * The session's real goal still travels alongside as secondary context (a dim
 * subtitle on the node, and the tab tooltip) — see {@link resolveSessionName}.
 *
 * The pool is all fruit — on theme with "Agent Fruitstand" — and curated to be:
 *  - value-neutral, with no ordering/quality connotation (unlike A/B/C, whose
 *    "was it B or D?" fades fast, or Alpha/Beta, which read as a ranking);
 *  - free of colour words, so a call-sign never contradicts the per-session
 *    identity COLOUR feature (a "Cherry" tab tinted blue would read as a clash).
 *    This is why the obvious colour-fruits — Cherry, Orange, Lime, Lemon, Plum,
 *    Peach, Apricot — are all deliberately absent.
 * A few entries are recognisable-but-exotic (Loquat, Tangelo); harmless, since a
 * study session never opens enough tabs to reach the tail of the list.
 *
 * This pool and {@link SUBAGENT_CALLSIGNS} are kept DISJOINT so a session and
 * one of its subagents never read as the same fruit — see the disjointness test.
 * Swap these two lists to change the whole scheme.
 */
export const CALLSIGNS = [
  'Apple', 'Mango', 'Melon', 'Kiwi', 'Papaya', 'Pear',
  'Banana', 'Grape', 'Pineapple', 'Nectarine', 'Pomegranate', 'Cantaloupe',
  'Honeydew', 'Mandarin', 'Clementine', 'Satsuma', 'Tangelo', 'Plantain',
  'Starfruit', 'Dragonfruit', 'Jackfruit', 'Passionfruit', 'Quince', 'Loquat',
  'Date',
] as const

/**
 * Value-neutral call-signs for SUBAGENTS — the same non-prescriptive idea as
 * {@link CALLSIGNS}, but a distinct fruit pool so a session and one of its
 * subagents never read as the same word (a "Mango" session with a "Mango"
 * subagent). Colour-free for the same reason, since subagents also carry an
 * identity colour. The subagent's real type + task travels alongside (folded
 * into the node label as "Guava · Explore", and shown in full on hover).
 */
export const SUBAGENT_CALLSIGNS = [
  'Guava', 'Lychee', 'Fig', 'Coconut', 'Persimmon', 'Kumquat',
  'Durian', 'Rambutan', 'Longan', 'Mangosteen', 'Soursop', 'Cherimoya',
  'Tamarind', 'Feijoa', 'Sapodilla', 'Breadfruit', 'Ackee', 'Yuzu',
  'Calamansi', 'Pawpaw', 'Pomelo', 'Salak', 'Jujube', 'Medlar',
  'Sapote',
] as const

/**
 * Map a 0-based per-session subagent index to a stable, distinct call-sign.
 * Wraps with a numeric suffix past the pool size ("Guava 2") so names stay
 * distinct with no hard cap. Purely positional — the caller supplies the index
 * (subagent spawn order within its session), which keeps it deterministic
 * across replays.
 */
export function subagentCallSign(index: number): string {
  const n = SUBAGENT_CALLSIGNS.length
  const word = SUBAGENT_CALLSIGNS[index % n]
  const wrap = Math.floor(index / n)
  return wrap === 0 ? word : `${word} ${wrap + 1}`
}

/**
 * Assign a stable, collision-free call-sign to every currently-open session.
 *
 * Guarantees:
 *  - Distinct — no two open sessions share a call-sign.
 *  - Stable — a session keeps its call-sign for as long as it stays open (and,
 *    via the persisted `prev` map, across reloads); reordering or closing a
 *    neighbouring tab never reshuffles it.
 *  - Recycling — a call-sign freed by a closed session is reused by a later one.
 *
 * `orderedIds` is the open sessions left→right; `prev` is the last assignment
 * (persisted). New sessions take the lowest-index call-sign not already in use.
 * With more open sessions than call-signs, the extras wrap with a numeric suffix
 * ("Apple 2") so they stay distinct — no hard cap. (Wrapped names aren't
 * reload-stable, but hitting the overflow needs > {@link CALLSIGNS}.length tabs
 * open at once, which the study never does.)
 */
export function assignCallSigns(
  orderedIds: readonly string[],
  prev: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>()
  const used = new Set<string>()
  const known = new Set<string>(CALLSIGNS)

  // Pass 1 — honour prior assignments (stability), dropping any that now collide
  // or reference a word no longer in the list (so list edits re-migrate cleanly).
  for (const id of orderedIds) {
    const prior = prev.get(id)
    if (prior && known.has(prior) && !used.has(prior)) {
      result.set(id, prior)
      used.add(prior)
    }
  }

  // Pass 2 — fill the rest from the lowest free call-sign, in tab order.
  let cursor = 0
  let overflow = 0
  for (const id of orderedIds) {
    if (result.has(id)) continue
    while (cursor < CALLSIGNS.length && used.has(CALLSIGNS[cursor])) cursor++
    if (cursor < CALLSIGNS.length) {
      const cs = CALLSIGNS[cursor++]
      result.set(id, cs)
      used.add(cs)
    } else {
      // More open tabs than names — wrap: "Apple 2", "Mango 2", … "Apple 3".
      const cs = `${CALLSIGNS[overflow % CALLSIGNS.length]} ${Math.floor(overflow / CALLSIGNS.length) + 2}`
      result.set(id, cs)
      overflow++
    }
  }
  return result
}

/** What to display for one session. */
export interface SessionName {
  /** Primary, non-prescriptive handle — the NAME shown on the tab + node. */
  name: string
  /** The session's goal, shown as secondary context (dim node subtitle + tab
   *  tooltip). Omitted when it adds nothing: no goal yet, still the default
   *  placeholder, or identical to `name`. */
  goal?: string
}

/** The extension's placeholder label before a real goal is known
 *  (`Session <id-prefix>`). Never worth surfacing as goal context. */
function isPlaceholderGoal(label: string): boolean {
  return /^Session [0-9a-f]+$/i.test(label.trim())
}

/**
 * Resolve a session's display name + goal, given its raw pieces:
 *   name = explicit user rename › call-sign › raw goal label (last-ditch)
 *   goal = the extension's short goal summary, as secondary context
 * A rename always wins so the user's explicit choice sticks; the call-sign is
 * the neutral default; the raw label is only a fallback for the brief moment
 * before a call-sign is assigned.
 */
export function resolveSessionName(
  goalLabel: string | undefined,
  callSign: string | undefined,
  rename: string | undefined,
): SessionName {
  const name = (rename?.trim() || callSign || goalLabel || '').trim()
  const goal = goalLabel?.trim()
  if (!goal || goal === name || isPlaceholderGoal(goal)) return { name }
  return { name, goal }
}
