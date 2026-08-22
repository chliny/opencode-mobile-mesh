import assert from "node:assert/strict"
import test from "node:test"
import { messageTextFromParts } from "./message-text.ts"

test("messageTextFromParts hides synthetic file context text", () => {
  assert.equal(messageTextFromParts([
    { id: "1", messageID: "m", type: "text", text: "Please inspect @src/app.ts" },
    { id: "2", messageID: "m", type: "text", text: "full file contents", synthetic: true },
  ]), "Please inspect @src/app.ts")
})

test("messageTextFromParts keeps real text and ignores non-text parts", () => {
  assert.equal(messageTextFromParts([
    { id: "1", messageID: "m", type: "reasoning", text: "thinking" },
    { id: "2", messageID: "m", type: "text", text: "first" },
    { id: "3", messageID: "m", type: "text", text: "second" },
  ]), "first\nsecond")
})
