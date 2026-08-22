import assert from "node:assert/strict"
import test from "node:test"
import type { Message } from "./sdk.ts"
import { reviewDiffsForMessage, turnDiffsFromMessages, turnSummaryRecorded } from "./review-diffs.ts"

const user: Message = {
  id: "user-1",
  sessionID: "session-1",
  role: "user",
  time: { created: 1 },
  summary: {
    diffs: [{ file: "src/app.ts", patch: "-old\n+new", additions: 1, deletions: 1, status: "modified" }],
  },
}

test("reviewDiffsForMessage links an assistant reply to its user turn", () => {
  const assistant: Message = {
    id: "assistant-1",
    sessionID: "session-1",
    role: "assistant",
    parentID: user.id,
    time: { created: 2 },
  }

  assert.deepEqual(reviewDiffsForMessage(assistant, [user, assistant]), user.summary?.diffs)
})

test("reviewDiffsForMessage ignores unrelated messages", () => {
  const assistant: Message = {
    id: "assistant-2",
    sessionID: "session-1",
    role: "assistant",
    parentID: "other-user",
    time: { created: 3 },
  }

  assert.equal(reviewDiffsForMessage(user, [user, assistant]), undefined)
  assert.equal(reviewDiffsForMessage(assistant, [user, assistant]), undefined)
})

test("reviewDiffsForMessage hides changes from an earlier turn", () => {
  const assistant: Message = {
    id: "assistant-1",
    sessionID: "session-1",
    role: "assistant",
    parentID: user.id,
    time: { created: 2 },
  }

  const laterUser: Message = {
    ...user,
    id: "user-2",
    time: { created: 3 },
  }

  assert.equal(reviewDiffsForMessage(assistant, [user, assistant, laterUser]), undefined)
})

test("reviewDiffsForMessage uses the last user turn in response order", () => {
  const earlierAssistant: Message = {
    id: "assistant-early",
    sessionID: "session-1",
    role: "assistant",
    parentID: user.id,
    time: { created: 2 },
  }
  const laterUser: Message = {
    ...user,
    id: "user-2",
    time: { created: 3 },
  }

  assert.equal(reviewDiffsForMessage(earlierAssistant, [user, earlierAssistant, laterUser]), undefined)
})

test("reviewDiffsForMessage keeps the current turn when no newer user exists", () => {
  const assistant: Message = {
    id: "assistant-1",
    sessionID: "session-1",
    role: "assistant",
    parentID: user.id,
    time: { created: 2 },
  }

  assert.deepEqual(reviewDiffsForMessage(assistant, [user, assistant]), user.summary?.diffs)
})

test("reviewDiffsForMessage renders once after multiple assistant messages in a turn", () => {
  const firstAssistant: Message = {
    id: "assistant-1",
    sessionID: "session-1",
    role: "assistant",
    parentID: user.id,
    time: { created: 2 },
  }
  const lastAssistant: Message = {
    ...firstAssistant,
    id: "assistant-2",
    time: { created: 3 },
  }

  assert.equal(reviewDiffsForMessage(firstAssistant, [user, firstAssistant, lastAssistant]), undefined)
  assert.deepEqual(reviewDiffsForMessage(lastAssistant, [user, firstAssistant, lastAssistant]), user.summary?.diffs)
})

test("turnDiffsFromMessages reads the last user message's summary diffs", () => {
  const laterUser: Message = {
    ...user,
    id: "user-2",
    time: { created: 3 },
    summary: { diffs: [{ file: "b.ts", patch: "+x", additions: 1, deletions: 0, status: "added" }] },
  }

  assert.deepEqual(turnDiffsFromMessages([user, laterUser]), laterUser.summary?.diffs)
})

test("turnDiffsFromMessages returns [] when the last turn has no summary yet", () => {
  const pending: Message = { id: "user-2", sessionID: "session-1", role: "user", time: { created: 3 } }
  assert.deepEqual(turnDiffsFromMessages([user, pending]), [])
})

test("turnDiffsFromMessages returns undefined without any user message", () => {
  const assistant: Message = { id: "a-1", sessionID: "session-1", role: "assistant", time: { created: 2 } }
  assert.equal(turnDiffsFromMessages([]), undefined)
  assert.equal(turnDiffsFromMessages([assistant]), undefined)
})

test("turnDiffsFromMessages respects the revert boundary", () => {
  const reverted: Message = { ...user, id: "user-0", time: { created: 0 } }
  assert.deepEqual(turnDiffsFromMessages([reverted, user], user.id), reverted.summary?.diffs)
  assert.deepEqual(turnDiffsFromMessages([user, { ...user, id: "user-2", time: { created: 3 } }], "missing"), user.summary?.diffs)
})

test("turnSummaryRecorded distinguishes authoritative empty from mid-turn", () => {
  const emptyTurn: Message = {
    ...user,
    id: "user-2",
    time: { created: 3 },
    summary: { diffs: [] },
  }
  const pending: Message = { id: "user-3", sessionID: "session-1", role: "user", time: { created: 4 } }

  assert.equal(turnSummaryRecorded([user]), true)
  assert.equal(turnSummaryRecorded([emptyTurn]), true)
  assert.equal(turnSummaryRecorded([pending]), false)
  assert.equal(turnSummaryRecorded([]), false)
  assert.equal(turnSummaryRecorded([emptyTurn, pending], pending.id), true)
})
