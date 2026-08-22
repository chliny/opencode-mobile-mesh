import { test } from "node:test"
import assert from "node:assert/strict"
import type { Part } from "./sdk.ts"
import { childSessionTitle, isTaskToolPart, taskAgentLabel, taskChildSessionID, taskDescription } from "./subagent.ts"

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "prt1",
    messageID: "msg1",
    type: "tool",
    tool: "task",
    state: { status: "completed", input: {}, output: "" },
    ...overrides,
  }
}

test("isTaskToolPart: only tool parts with tool === 'task'", () => {
  assert.equal(isTaskToolPart(part()), true)
  assert.equal(isTaskToolPart(part({ tool: "bash" })), false)
  assert.equal(isTaskToolPart(part({ type: "text", text: "hi" })), false)
})

test("taskChildSessionID: reads state.metadata.sessionId", () => {
  const p = part({ state: { status: "completed", input: {}, metadata: { sessionId: "ses_child" } } })
  assert.equal(taskChildSessionID(p), "ses_child")
})

test("taskChildSessionID: null when missing or non-string", () => {
  assert.equal(taskChildSessionID(part()), null)
  assert.equal(taskChildSessionID(part({ tool: "bash" })), null)
  assert.equal(
    taskChildSessionID(part({ state: { status: "running", input: {}, metadata: { sessionId: 42 } } })),
    null,
  )
})

test("taskAgentLabel: capitalized subagent_type with fallback", () => {
  assert.equal(taskAgentLabel(part({ state: { status: "running", input: { subagent_type: "explore" } } })), "Explore")
  assert.equal(taskAgentLabel(part({ state: { status: "running", input: {} } })), "Agent")
})

test("taskDescription: from input.description", () => {
  assert.equal(taskDescription(part({ state: { status: "running", input: { description: "Find files" } } })), "Find files")
  assert.equal(taskDescription(part()), null)
})

test("childSessionTitle: strips the (@agent subagent) suffix", () => {
  assert.equal(childSessionTitle("Inspect navigation (@explore subagent)"), "Inspect navigation")
  assert.equal(childSessionTitle("Plain title"), "Plain title")
  assert.equal(childSessionTitle(undefined), undefined)
})
