// ─── Prompt composer & command builder ───────────────────────────────────────
// Lightweight, frontend-only helper for the "New agent" composer. Produces a
// ready-to-paste `claude` command; nothing here talks to a running agent.
// Model options derive from the single source of truth in canvas-constants.ts.
//
// Deliberately unopinionated: it imposes no predefined purpose, name, or framing
// on the agent. Whatever the user wants the agent to be is expressed in their own
// free-form text.

import { CLAUDE_FAMILIES } from "./canvas-constants"

/** Model families that are not offered in the composer. */
const EXCLUDED_MODELS = new Set(["fable", "mythos"])

/** Model choices derived from the single source of truth. `''` = CLI default. */
export const MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Default" },
  ...CLAUDE_FAMILIES.filter((f) => !EXCLUDED_MODELS.has(f.name)).map((f) => ({
    value: f.name,
    label: f.name.charAt(0).toUpperCase() + f.name.slice(1),
  })),
]

export interface ComposerOptions {
  prompt: string
  model: string
  /** Free-form context the agent should have before starting.
   *  Appended via --append-system-prompt. Empty = none. */
  context?: string
  /** Optional working directory; prefixes the command with `cd '<dir>' &&`. */
  cwd?: string
  /** Start in plan mode (--permission-mode plan). */
  planMode?: boolean
}

/** POSIX single-quote escaping: wrap in '…' and turn ' into '\''. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Build a ready-to-paste `claude` command from composer options.
 * Returns an empty string when there is no prompt text.
 */
export function buildClaudeCommand(opts: ComposerOptions): string {
  const prompt = opts.prompt.trim()
  if (!prompt) return ""

  const parts: string[] = ["claude"]

  // Ignore any excluded model so it can never leak into the command.
  if (opts.model && !EXCLUDED_MODELS.has(opts.model)) {
    parts.push("--model", opts.model)
  }
  if (opts.planMode) parts.push("--permission-mode", "plan")

  const context = opts.context?.trim()
  if (context) parts.push("--append-system-prompt", shq(context))

  parts.push(shq(prompt))

  const cmd = parts.join(" ")
  const cwd = opts.cwd?.trim()
  return cwd ? `cd ${shq(cwd)} && ${cmd}` : cmd
}
