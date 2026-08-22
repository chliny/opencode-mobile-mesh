// Helpers for the task tool's subagent sessions. Extracted from the UI so
// the matching rules are unit-testable in isolation (mirrors the upstream
// web client's detection logic).
//
// The server (packages/opencode/src/tool/task.ts) creates a child session
// with `parentID` set and title `${description} (@${agent} subagent)`, then
// writes its ID into the task part: `state.metadata.sessionId`.
import type { Part } from "./sdk"

export function isTaskToolPart(part: Part): boolean {
  return part.type === "tool" && part.tool === "task"
}

// Child session ID written by the server into the task part's state metadata.
export function taskChildSessionID(part: Part): string | null {
  if (!isTaskToolPart(part)) return null
  const id = part.state?.metadata?.sessionId
  return typeof id === "string" && id ? id : null
}

function inputField(part: Part, field: string): unknown {
  const input = part.state?.input
  if (typeof input !== "object" || input === null) return undefined
  return (input as Record<string, unknown>)[field]
}

// "explore" -> "Explore"; falls back to the generic agent label.
export function taskAgentLabel(part: Part): string {
  const type = inputField(part, "subagent_type")
  if (typeof type === "string" && type) return type.charAt(0).toUpperCase() + type.slice(1)
  return "Agent"
}

export function taskDescription(part: Part): string | null {
  const description = inputField(part, "description")
  return typeof description === "string" && description ? description : null
}

// Child sessions are titled "<description> (@<agent> subagent)" — strip the
// suffix for display (same rule as the web timeline).
export function childSessionTitle(title: string | undefined): string | undefined {
  if (!title) return title
  return title.replace(/\s+\(@[^)]+ subagent\)$/, "")
}
