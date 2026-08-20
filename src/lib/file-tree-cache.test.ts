import test from "node:test"
import assert from "node:assert/strict"
import { cacheFileEntries, clearCachedFileEntries, getCachedFileEntries } from "./file-tree-cache.ts"

test("file tree cache isolates directories and paths", () => {
  clearCachedFileEntries()
  const value = [{ name: "a.ts", path: "a.ts", absolute: "/repo/a.ts", type: "file" as const, ignored: false }]
  cacheFileEntries("/repo", ".", value)
  assert.deepEqual(getCachedFileEntries("/repo", "."), value)
  assert.equal(getCachedFileEntries("/other", "."), undefined)
  assert.equal(getCachedFileEntries("/repo", "src"), undefined)
})

test("file tree cache clears one directory without affecting another", () => {
  clearCachedFileEntries()
  const value = [{ name: "a", path: "a", absolute: "/repo/a", type: "file" as const, ignored: false }]
  cacheFileEntries("/repo", ".", value)
  cacheFileEntries("/other", ".", value)
  clearCachedFileEntries("/repo")
  assert.equal(getCachedFileEntries("/repo", "."), undefined)
  assert.deepEqual(getCachedFileEntries("/other", "."), value)
  clearCachedFileEntries()
})
