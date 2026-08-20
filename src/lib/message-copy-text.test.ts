import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { extractCopyText, hasCopyableText } from "./message-copy-text.ts"

describe("extractCopyText", () => {
  it("returns empty string for undefined parts", () => {
    assert.equal(extractCopyText(undefined), "")
  })

  it("returns empty string for empty parts array", () => {
    assert.equal(extractCopyText([]), "")
  })

  it("joins multiple text parts with newline", () => {
    const parts = [
      { id: "1", type: "text" as const, text: "Hello" },
      { id: "2", type: "text" as const, text: "World" },
    ]
    assert.equal(extractCopyText(parts as never[]), "Hello\nWorld")
  })

  it("ignores reasoning and tool parts", () => {
    const parts = [
      { id: "1", type: "reasoning" as const, text: "thinking..." },
      { id: "2", type: "text" as const, text: "Answer here" },
      { id: "3", type: "tool" as const, name: "bash", state: "completed" },
    ]
    assert.equal(extractCopyText(parts as never[]), "Answer here")
  })

  it("skips text parts with empty/missing text", () => {
    const parts = [
      { id: "1", type: "text" as const, text: "" },
      { id: "2", type: "text" as const, text: "Valid" },
    ]
    assert.equal(extractCopyText(parts as never[]), "Valid")
  })

  it("returns empty for tool-only messages", () => {
    const parts = [
      { id: "1", type: "tool" as const, name: "bash", state: "completed" },
    ]
    assert.equal(extractCopyText(parts as never[]), "")
  })
})

describe("hasCopyableText", () => {
  it("returns false for undefined", () => {
    assert.equal(hasCopyableText(undefined), false)
  })

  it("returns false for whitespace-only text parts", () => {
    const parts = [{ id: "1", type: "text" as const, text: "   " }]
    assert.equal(hasCopyableText(parts as never[]), false)
  })

  it("returns true when there is visible text", () => {
    const parts = [{ id: "1", type: "text" as const, text: "Hello" }]
    assert.equal(hasCopyableText(parts as never[]), true)
  })

  it("returns false for tool-only parts", () => {
    const parts = [
      { id: "1", type: "tool" as const, name: "bash", state: "completed" },
    ]
    assert.equal(hasCopyableText(parts as never[]), false)
  })
})
