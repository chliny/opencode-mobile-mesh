import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// Chat and fullscreen content must wrap to their available width. This repo's
// runtime is React Native, so node:test verifies source-level layout markers.

function readComponent(relativePath: string): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return readFileSync(path.join(dir, relativePath), "utf8")
}

test("DiffView renders wrapping diff lines", () => {
  const src = readComponent("chat/DiffView.tsx")
  assert.match(src, /<DiffRenderer/)
  assert.doesNotMatch(src, /numberOfLines/, "DiffView must not truncate diff line text with numberOfLines")
  assert.doesNotMatch(src, /WideScroll/)
})

test("shared diff renderer does not scroll horizontally", () => {
  const src = readComponent("files/DiffRenderer.tsx")
  assert.doesNotMatch(src, /WideScroll/)
})

test("CodeBlock wraps code to its card width", () => {
  const src = readComponent("markdown/CodeBlock.tsx")
  assert.doesNotMatch(src, /WideScroll/)
  assert.doesNotMatch(src, /numberOfLines/, "CodeBlock must not truncate code text with numberOfLines")
})

test("Markdown table cells shrink and wrap", () => {
  const src = readComponent("markdown/Markdown.tsx")
  assert.doesNotMatch(src, /WideScroll/)
  assert.match(src, /flex: 1, minWidth: 0/)
})

test("content-viewer wraps fullscreen output instead of scrolling horizontally", () => {
  const src = readComponent(path.join("..", "..", "app", "content-viewer.tsx"))
  assert.match(src, /<ScrollView[^>]*contentContainerStyle={s\.verticalContent}/)
  assert.doesNotMatch(src, /<WideScroll/, "content-viewer must wrap fullscreen output")
})

test("wrapped content does not use the retired scroll config", () => {
  const diffView = readComponent("chat/DiffView.tsx")
  const codeBlock = readComponent("markdown/CodeBlock.tsx")
  const markdown = readComponent("markdown/Markdown.tsx")
  const contentView = readComponent(path.join("..", "..", "app", "content-viewer.tsx"))
  for (const [name, src] of Object.entries({ diffView, codeBlock, markdown, contentView })) {
    assert.doesNotMatch(src, /WIDE_CONTENT_SCROLL_CONFIG/, `${name} must not reference the old scroll config`)
  }
})
