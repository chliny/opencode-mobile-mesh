import test from "node:test"
import assert from "node:assert/strict"
import { cacheVcsDiffs, clearCachedVcsDiffs, getCachedVcsDiffs } from "./session-file-cache.ts"

test("VCS diff cache is shared by directory and mode", () => {
  clearCachedVcsDiffs()
  const value = [{ file: "a.ts", additions: 1, deletions: 0 }]
  cacheVcsDiffs("/repo", "git", value)
  assert.deepEqual(getCachedVcsDiffs("/repo", "git"), value)
  assert.equal(getCachedVcsDiffs("/other", "git"), undefined)
  assert.equal(getCachedVcsDiffs("/repo", "branch"), undefined)
})

test("VCS diff cache clears one directory", () => {
  clearCachedVcsDiffs()
  const value = [{ file: "a.ts", additions: 1, deletions: 0 }]
  cacheVcsDiffs("/repo", "git", value)
  cacheVcsDiffs("/other", "git", value)
  clearCachedVcsDiffs("/repo")
  assert.equal(getCachedVcsDiffs("/repo", "git"), undefined)
  assert.deepEqual(getCachedVcsDiffs("/other", "git"), value)
  clearCachedVcsDiffs()
})
