import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AT_BOTTOM_THRESHOLD_PX,
  isAtBottom,
  shouldAutoScroll,
  shouldShowScrollButton,
  transcriptSignature,
} from "./auto-scroll.ts"

test("the bottom threshold and scroll button use the same boundary", () => {
  assert.equal(isAtBottom(AT_BOTTOM_THRESHOLD_PX), true)
  assert.equal(shouldShowScrollButton(AT_BOTTOM_THRESHOLD_PX), false)
  assert.equal(isAtBottom(AT_BOTTOM_THRESHOLD_PX + 1), false)
  assert.equal(shouldShowScrollButton(AT_BOTTOM_THRESHOLD_PX + 1), true)
})

test("new transcript content follows only while the user remains near the bottom", () => {
  assert.equal(
    shouldAutoScroll({ offsetY: 20, previousSignature: "old", currentSignature: "new" }),
    true,
  )
  assert.equal(
    shouldAutoScroll({ offsetY: 500, previousSignature: "old", currentSignature: "new" }),
    false,
  )
})

test("an unchanged transcript does not schedule another follow", () => {
  assert.equal(
    shouldAutoScroll({ offsetY: 0, previousSignature: "same", currentSignature: "same" }),
    false,
  )
})

test("the signature detects messages, streaming text, tool updates, and review revisions", () => {
  const base = { revision: 1, messageCount: 1, newestMessageID: "m1", newestPartCount: 1, newestTextLength: 5 }
  const signature = transcriptSignature(base)
  assert.notEqual(transcriptSignature({ ...base, messageCount: 2 }), signature)
  assert.notEqual(transcriptSignature({ ...base, newestMessageID: "m2" }), signature)
  assert.notEqual(transcriptSignature({ ...base, newestPartCount: 2 }), signature)
  assert.notEqual(transcriptSignature({ ...base, newestTextLength: 6 }), signature)
  assert.notEqual(transcriptSignature({ ...base, revision: 2 }), signature)
})
