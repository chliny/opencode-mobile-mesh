// Helpers for the task tool's subagent sessions. Extracted from the UI so
// the matching rules are unit-testable in isolation (mirrors the upstream
// web client's detection logic).
//
// The server (packages/opencode/src/tool/task.ts) creates a child session
// with `parentID` set and title `${description} (@${agent} subagent)`, then
// writes its ID into the task part: `state.metadata.sessionId`.
import type { Part } from "./sdk"

const TASK_TITLE_LENGTH = 60

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

// A compact fallback title for task cards when the server has not supplied
// state.title. Native Task input takes priority over the legacy swarm shape.
export function taskToolTitle(part: Part): string | undefined {
  if (!isTaskToolPart(part)) return undefined

  const agent = singleLine(inputField(part, "subagent_type"))
  const description = singleLine(inputField(part, "description"))
  if (agent || description) return truncate(`Task ${agent ?? "general"}: ${description ?? "subagent"}`)

  const role = singleLine(inputField(part, "role"))
  if (!role) return undefined
  const prompt = singleLine(inputField(part, "prompt")) ?? "delegation"
  return truncate(`Task ${role}: ${prompt}`)
}

function singleLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const line = value.split("\n").find((item) => item.trim())
  if (!line) return undefined
  return line.trim().replace(/\s+/g, " ")
}

function truncate(value: string): string {
  const points = [...value]
  if (points.length <= TASK_TITLE_LENGTH) return value
  return `${points.slice(0, TASK_TITLE_LENGTH - 1).join("").trimEnd()}…`
}

// Child sessions are titled "<description> (@<agent> subagent)" — strip the
// suffix for display (same rule as the web timeline).
export function childSessionTitle(title: string | undefined): string | undefined {
  if (!title) return title
  return title.replace(/\s+\(@[^)]+ subagent\)$/, "")
}
