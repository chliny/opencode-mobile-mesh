import test from "node:test"
import assert from "node:assert/strict"
import { activeMention, buildReferenceParts, diffHunkStarts, insertMention, parseUnifiedPatch } from "./file-review.ts"

test("finds and replaces the mention nearest the cursor", () => {
  const text = "check @src/ut please"
  const range = activeMention(text, 13)
  assert.deepEqual(range, { start: 6, end: 13, query: "src/ut" })
  assert.deepEqual(insertMention(text, range!, "src/utils.ts"), {
    text: "check @src/utils.ts please",
    cursor: 19,
  })
})

test("parses unified diff line coordinates", () => {
  const lines = parseUnifiedPatch("--- a/x\n+++ b/x\n@@ -4,2 +4,3 @@\n same\n-old\n+new\n+extra")
  assert.deepEqual(lines.slice(-4).map((line) => [line.type, line.oldLine, line.newLine]), [
    ["context", 4, 4],
    ["remove", 5, undefined],
    ["add", undefined, 5],
    ["add", undefined, 6],
  ])
})

test("finds each changed hunk in a rendered diff", () => {
  assert.deepEqual(diffHunkStarts([
    { type: "header" },
    { type: "context" },
    { type: "add" },
    { type: "add" },
    { type: "context" },
    { type: "remove" },
    { type: "context" },
    { type: "add" },
  ]), [2, 5, 7])
})

test("serializes line comments as synthetic text and ranged file parts", () => {
  const parts = buildReferenceParts("/repo", [{
    path: "src/a.ts",
    text: "@src/a.ts",
    start: 0,
    end: 9,
    comment: "rename this",
    selection: { startLine: 2, startChar: 0, endLine: 4, endChar: 0 },
    origin: "file",
  }])
  assert.equal(parts.length, 2)
  assert.equal(parts[0].type, "text")
  assert.equal(parts[1].type, "file")
  if (parts[1].type === "file") assert.equal(parts[1].url, "file:///repo/src/a.ts?start=2&end=4")
})
