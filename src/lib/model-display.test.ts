import { test } from "node:test"
import assert from "node:assert/strict"
import { modelNameFor } from "./model-display.ts"

const providers = [
  { id: "opencode", models: [{ id: "x-preview-f-free", name: "ox alpha free" }, { id: "deepseek-v4-flash-free", name: "deepseek v4 flash" }] },
  { id: "anthropic", models: [{ id: "claude-fable-5", name: "claude fable 5" }] },
]

test("resolves the display name for the named provider's model", () => {
  assert.equal(modelNameFor(providers, "opencode", "x-preview-f-free"), "ox alpha free")
})

test("same modelID on another provider resolves within that provider only", () => {
  const shared = [
    { id: "a", models: [{ id: "m1", name: "A Model" }] },
    { id: "b", models: [{ id: "m1", name: "B Model" }] },
  ]
  assert.equal(modelNameFor(shared, "b", "m1"), "B Model")
})

test("provider missing from the catalog returns undefined (raw ID fallback, no global scan)", () => {
  assert.equal(modelNameFor(providers, "gone-provider", "claude-fable-5"), undefined)
})

test("known provider without that model returns undefined (no cross-provider mislabel)", () => {
  assert.equal(modelNameFor(providers, "opencode", "claude-fable-5"), undefined)
})

test("falls back to undefined when nothing matches or inputs are missing", () => {
  assert.equal(modelNameFor(providers, "opencode", "nope"), undefined)
  assert.equal(modelNameFor(providers, "opencode", undefined), undefined)
  assert.equal(modelNameFor(undefined, "opencode", "x-preview-f-free"), undefined)
  assert.equal(modelNameFor([], "opencode", "x-preview-f-free"), undefined)
})
