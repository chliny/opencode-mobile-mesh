import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldApplyTranscriptRefresh } from "./transcript-refresh.ts"

test("applies a refresh when the session and transcript revision are unchanged", () => {
  assert.equal(
    shouldApplyTranscriptRefresh({
      expectedSessionID: "session-1",
      requestedSessionID: "session-1",
      currentSessionID: "session-1",
      requestRevision: 4,
      currentRevision: 4,
    }),
    true,
  )
})

test("rejects a response after navigation to another session", () => {
  assert.equal(
    shouldApplyTranscriptRefresh({
      expectedSessionID: "session-1",
      requestedSessionID: "session-1",
      currentSessionID: "session-2",
      requestRevision: 4,
      currentRevision: 4,
    }),
    false,
  )
})

test("rejects an HTTP snapshot after a newer SSE transcript update", () => {
  assert.equal(
    shouldApplyTranscriptRefresh({
      requestedSessionID: "session-1",
      currentSessionID: "session-1",
      requestRevision: 4,
      currentRevision: 5,
    }),
    false,
  )
})

test("rejects a request that did not target the expected session", () => {
  assert.equal(
    shouldApplyTranscriptRefresh({
      expectedSessionID: "session-2",
      requestedSessionID: "session-1",
      currentSessionID: "session-1",
      requestRevision: 4,
      currentRevision: 4,
    }),
    false,
  )
})
