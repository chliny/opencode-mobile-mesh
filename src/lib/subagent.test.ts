import { test } from "node:test"
import assert from "node:assert/strict"
import type { Part } from "./sdk.ts"
import {
  childSessionTitle,
  isTaskToolPart,
  taskAgentLabel,
  taskChildSessionID,
  taskDescription,
  taskToolTitle,
} from "./subagent.ts"

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

test("taskToolTitle: uses compact native Task input", () => {
  assert.equal(
    taskToolTitle(part({ state: { status: "running", input: { subagent_type: "explore", description: "Trace session flow" } } })),
    "Task explore: Trace session flow",
  )
})

test("taskToolTitle: native Task input wins over swarm-shaped fallback", () => {
  assert.equal(
    taskToolTitle(part({ state: { status: "running", input: { subagent_type: "explore", description: "Trace flow", role: "QA", prompt: "Ignore me" } } })),
    "Task explore: Trace flow",
  )
})

test("taskToolTitle: uses the first normalized swarm prompt line", () => {
  assert.equal(
    taskToolTitle(part({ state: { status: "running", input: { role: "Goomba - QA", prompt: "\n  Verify reconnect   behavior\nIgnore later lines" } } })),
    "Task Goomba - QA: Verify reconnect behavior",
  )
})

test("taskToolTitle: normalizes native descriptions and truncates at 60 code points", () => {
  const title = taskToolTitle(part({ state: { status: "running", input: { description: `\n  ${"a".repeat(100)}\nignored` } } }))!
  assert.equal([...title].length, 60)
  assert.equal(title.endsWith("…"), true)
})

test("taskToolTitle: leaves non-task and unknown input without a title", () => {
  assert.equal(taskToolTitle(part({ tool: "bash" })), undefined)
  assert.equal(taskToolTitle(part({ state: { status: "running", input: { prompt: "No role" } } })), undefined)
})

test("childSessionTitle: strips the (@agent subagent) suffix", () => {
  assert.equal(childSessionTitle("Inspect navigation (@explore subagent)"), "Inspect navigation")
  assert.equal(childSessionTitle("Plain title"), "Plain title")
  assert.equal(childSessionTitle(undefined), undefined)
})
