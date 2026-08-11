// ─── Prompt composer templates & command builder ─────────────────────────────
// Lightweight, frontend-only helper for the "New agent" composer. Produces a
// ready-to-paste `claude` command; nothing here talks to a running agent.
// Model options derive from the single source of truth in canvas-constants.ts.

import { CLAUDE_FAMILIES } from "./canvas-constants"

/** A role frames the agent via --append-system-prompt without touching the
 *  user's task text. `systemPrompt: ''` means "no framing" (plain agent). */
export interface AgentRole {
  id: string
  label: string
  /** Appended to the system prompt. Empty for the default/general role. */
  systemPrompt: string
  /** Placeholder shown in the task textarea to hint the expected input. */
  placeholder: string
}

export const AGENT_ROLES: ReadonlyArray<AgentRole> = [
  {
    id: "general",
    label: "General",
    systemPrompt: "",
    placeholder: "Describe the task for this agent…",
  },
  {
    id: "reviewer",
    label: "Code reviewer",
    systemPrompt:
      "You are a meticulous code reviewer. Focus on correctness, edge cases, and security. Report findings; do not modify code unless explicitly asked.",
    placeholder: "Review the diff on this branch for correctness and security…",
  },
  {
    id: "debugger",
    label: "Debugger",
    systemPrompt:
      "You are a debugging specialist. Reproduce the issue, isolate the root cause with evidence, then propose the minimal fix.",
    placeholder: "The build fails with X — find the root cause and fix it…",
  },
  {
    id: "planner",
    label: "Planner",
    systemPrompt:
      "You are a software architect. Produce a step-by-step implementation plan with critical files and trade-offs. Do not write code.",
    placeholder: "Plan how to add feature X across the codebase…",
  },
  {
    id: "tester",
    label: "Test writer",
    systemPrompt:
      "You write focused, deterministic tests. Cover edge cases and follow the project's existing test conventions.",
    placeholder: "Add tests for the module at path/to/file…",
  },
  {
    id: "refactorer",
    label: "Refactorer",
    systemPrompt:
      "You improve code quality without changing behavior. Prefer small, reviewable changes and match surrounding style.",
    placeholder: "Refactor path/to/file for readability, no behavior change…",
  },
]

/** Model choices derived from the single source of truth. `''` = CLI default. */
export const MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Default" },
  ...CLAUDE_FAMILIES.map((f) => ({
    value: f.name,
    label: f.name.charAt(0).toUpperCase() + f.name.slice(1),
  })),
]

export interface ComposerOptions {
  prompt: string
  roleId: string
  model: string
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

  const role = AGENT_ROLES.find((r) => r.id === opts.roleId)
  const parts: string[] = ["claude"]

  if (opts.model) parts.push("--model", opts.model)
  if (opts.planMode) parts.push("--permission-mode", "plan")
  if (role && role.systemPrompt) {
    parts.push("--append-system-prompt", shq(role.systemPrompt))
  }
  parts.push(shq(prompt))

  const cmd = parts.join(" ")
  const cwd = opts.cwd?.trim()
  return cwd ? `cd ${shq(cwd)} && ${cmd}` : cmd
}
