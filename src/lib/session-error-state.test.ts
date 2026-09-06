import { test } from "node:test"
import assert from "node:assert/strict"
import { replaceSessionError } from "./session-error-state.ts"

test("replaceSessionError clears a stale error when the refreshed transcript is healthy", () => {
  const before = { sessionA: "stale network error", sessionB: "keep me" }
  assert.deepEqual(replaceSessionError(before, "sessionA", undefined), { sessionB: "keep me" })
  assert.deepEqual(replaceSessionError(before, "sessionA", "new error"), {
    sessionA: "new error",
    sessionB: "keep me",
  })
})
