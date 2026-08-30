import { test } from "node:test"
import assert from "node:assert/strict"
import { isCompactionMessage } from "./message-kind.ts"

test("recognizes automatic compaction messages by their compaction part", () => {
  assert.equal(isCompactionMessage([{ id: "p", messageID: "m", type: "compaction" }]), true)
})

test("does not classify an ordinary empty user message as compaction", () => {
  assert.equal(isCompactionMessage([]), false)
  assert.equal(isCompactionMessage([{ id: "p", messageID: "m", type: "text", text: "" }]), false)
})
