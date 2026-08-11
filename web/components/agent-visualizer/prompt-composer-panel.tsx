"use client"

import { useMemo, useRef, useState } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { useClickOutside } from "@/hooks/use-click-outside"
import {
  AGENT_ROLES,
  MODEL_OPTIONS,
  buildClaudeCommand,
} from "@/lib/prompt-templates"
import { GlassCard } from "./glass-card"
import { PanelHeader, stopPropagationHandlers } from "./shared-ui"

// ─── Prompt Composer Panel ───────────────────────────────────────────────────
// Lightweight, frontend-only. Composes a `claude` command and copies it to the
// clipboard — the user pastes it into their terminal to launch a new agent,
// which then appears in the graph via the existing hooks. No backend channel.

interface PromptComposerPanelProps {
  visible: boolean
  onClose: () => void
}

const FIELD_STYLE: React.CSSProperties = {
  background: COLORS.holoBg03,
  border: `1px solid ${COLORS.holoBorder10}`,
  color: COLORS.textPrimary,
  borderRadius: 6,
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] uppercase tracking-wide mb-1"
      style={{ color: COLORS.textMuted }}
    >
      {children}
    </div>
  )
}

export function PromptComposerPanel({ visible, onClose }: PromptComposerPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [prompt, setPrompt] = useState("")
  const [roleId, setRoleId] = useState(AGENT_ROLES[0].id)
  const [model, setModel] = useState("")
  const [cwd, setCwd] = useState("")
  const [planMode, setPlanMode] = useState(false)
  const [copied, setCopied] = useState(false)

  useClickOutside(ref, onClose)

  const role = useMemo(
    () => AGENT_ROLES.find((r) => r.id === roleId) ?? AGENT_ROLES[0],
    [roleId],
  )

  const command = useMemo(
    () => buildClaudeCommand({ prompt, roleId, model, cwd, planMode }),
    [prompt, roleId, model, cwd, planMode],
  )

  const handleCopy = async () => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — leave the command
      // visible so the user can select and copy it manually.
    }
  }

  if (!visible) return null

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: Z.detailCard }}
      {...stopPropagationHandlers}
    >
      <div ref={ref} style={{ width: 460, maxWidth: "92vw" }}>
        <GlassCard visible={visible} className="p-4">
          <PanelHeader onClose={onClose}>
            <span
              className="font-mono text-[13px] font-medium"
              style={{ color: COLORS.holoBright }}
            >
              New agent
            </span>
          </PanelHeader>

          {/* Role + model */}
          <div className="flex gap-2 mt-1">
            <div className="flex-1 min-w-0">
              <Label>Role</Label>
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="w-full px-2 py-1.5 text-[13px] outline-none"
                style={FIELD_STYLE}
              >
                {AGENT_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <Label>Model</Label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-2 py-1.5 text-[13px] outline-none"
                style={FIELD_STYLE}
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Task */}
          <div className="mt-3">
            <Label>Task</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={role.placeholder}
              rows={4}
              className="w-full px-2 py-1.5 text-[13px] resize-y outline-none font-mono"
              style={FIELD_STYLE}
            />
          </div>

          {/* Working dir */}
          <div className="mt-3">
            <Label>Working directory (optional)</Label>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/project"
              className="w-full px-2 py-1.5 text-[13px] outline-none font-mono"
              style={FIELD_STYLE}
            />
          </div>

          {/* Plan mode */}
          <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={planMode}
              onChange={(e) => setPlanMode(e.target.checked)}
            />
            <span className="text-[12px]" style={{ color: COLORS.textDim }}>
              Start in plan mode (read-only, proposes a plan first)
            </span>
          </label>

          {/* Command preview */}
          <div className="mt-4">
            <Label>Command</Label>
            <pre
              className="px-2.5 py-2 text-[12px] font-mono whitespace-pre-wrap break-all overflow-x-auto"
              style={{
                background: COLORS.holoBg05,
                border: `1px solid ${COLORS.holoBorder08}`,
                borderRadius: 6,
                color: command ? COLORS.textPrimary : COLORS.textMuted,
                maxHeight: 140,
              }}
            >
              {command || "Enter a task to build the command…"}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[13px] rounded transition-all"
              style={{
                background: "transparent",
                border: `1px solid ${COLORS.holoBorder12}`,
                color: COLORS.textMuted,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleCopy}
              disabled={!command}
              className="px-3 py-1.5 text-[13px] rounded transition-all"
              style={{
                background: command ? COLORS.toggleActive : COLORS.holoBg03,
                border: `1px solid ${command ? COLORS.holoBright : COLORS.holoBorder10}`,
                color: command ? COLORS.holoBright : COLORS.textMuted,
                cursor: command ? "pointer" : "not-allowed",
              }}
            >
              {copied ? "Copied ✓" : "Copy command"}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
