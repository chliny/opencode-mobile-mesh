import assert from "node:assert/strict"
import test from "node:test"
import type { Message } from "./sdk.ts"
import { reviewDiffsForMessage } from "./review-diffs.ts"

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

  assert.deepEqual(reviewDiffsForMessage(assistant, [user, assistant], true), user.summary?.diffs)
})

test("reviewDiffsForMessage ignores unrelated messages", () => {
  const assistant: Message = {
    id: "assistant-2",
    sessionID: "session-1",
    role: "assistant",
    parentID: "other-user",
    time: { created: 3 },
  }

  assert.equal(reviewDiffsForMessage(user, [user, assistant], true), undefined)
  assert.equal(reviewDiffsForMessage(assistant, [user, assistant], true), undefined)
})

test("reviewDiffsForMessage hides changes from earlier assistant replies", () => {
  const assistant: Message = {
    id: "assistant-1",
    sessionID: "session-1",
    role: "assistant",
    parentID: user.id,
    time: { created: 2 },
  }

  assert.equal(reviewDiffsForMessage(assistant, [user, assistant], false), undefined)
})
