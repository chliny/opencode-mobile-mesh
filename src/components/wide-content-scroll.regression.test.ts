import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// GitHub issue #21 + upstream #182 (e0f374e): wide content (diff, code,
// markdown tables, fullscreen content viewer) must render inside the
// gesture-forgiving WideScroll component, not a plain horizontal ScrollView.
// WideScroll uses a PanResponder to grab only clearly-horizontal drags,
// letting vertical scrolling pass through to the parent transcript FlatList.
//
// This repo's runtime is React Native, so these components can't be rendered
// with node:test. Instead, this test reads the actual .tsx source and
// asserts on its structure: a plain-text/regex check that directly targets
// the markers that would prove a regression — (a) the WideScroll wiring,
// (b) reintroducing line-truncation — so it can't pass on a source file
// where the fix was reverted.

function readComponent(relativePath: string): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return readFileSync(path.join(dir, relativePath), "utf8")
}

test("DiffView wraps diff lines in WideScroll", () => {
  const src = readComponent("chat/DiffView.tsx")
  assert.match(src, /<WideScroll/)
  assert.doesNotMatch(src, /numberOfLines/, "DiffView must not truncate diff line text with numberOfLines")
  assert.doesNotMatch(src, /WIDE_CONTENT_SCROLL_CONFIG/, "DiffView must use WideScroll, not the old scroll config")
})

test("CodeBlock wraps code in WideScroll", () => {
  const src = readComponent("markdown/CodeBlock.tsx")
  assert.match(src, /<WideScroll/)
  assert.doesNotMatch(src, /numberOfLines/, "CodeBlock must not truncate code text with numberOfLines")
  assert.doesNotMatch(src, /WIDE_CONTENT_SCROLL_CONFIG/, "CodeBlock must use WideScroll, not the old scroll config")
})

test("Markdown table renderer wraps in WideScroll", () => {
  const src = readComponent("markdown/Markdown.tsx")
  assert.match(src, /<WideScroll[^>]*testID="markdown-table-scroll"/)
})

test("content-viewer wraps horizontal axis in WideScroll", () => {
  const src = readComponent(path.join("..", "..", "app", "content-viewer.tsx"))
  assert.match(src, /<WideScroll/)
  assert.doesNotMatch(src, /WIDE_CONTENT_SCROLL_CONFIG/, "content-viewer must use WideScroll, not the old scroll config")
})

test("no remaining consumers of WIDE_CONTENT_SCROLL_CONFIG in runtime code", () => {
  const diffView = readComponent("chat/DiffView.tsx")
  const codeBlock = readComponent("markdown/CodeBlock.tsx")
  const markdown = readComponent("markdown/Markdown.tsx")
  const contentView = readComponent(path.join("..", "..", "app", "content-viewer.tsx"))
  for (const [name, src] of Object.entries({ diffView, codeBlock, markdown, contentView })) {
    assert.doesNotMatch(src, /WIDE_CONTENT_SCROLL_CONFIG/, `${name} must not reference the old scroll config`)
  }
})
