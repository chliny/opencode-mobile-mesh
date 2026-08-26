import { test } from "node:test"
import assert from "node:assert/strict"
import { clearConnectionDraft, getConnectionDraft, setConnectionDraft } from "./connection-drafts.ts"

test("connection drafts are isolated by key", () => {
  clearConnectionDraft("one")
  clearConnectionDraft("two")

  setConnectionDraft("one", { name: "One", url: "http://one" })
  setConnectionDraft("two", { name: "Two", url: "http://two" })

  assert.deepEqual(getConnectionDraft("one"), { name: "One", url: "http://one" })
  assert.deepEqual(getConnectionDraft("two"), { name: "Two", url: "http://two" })

  clearConnectionDraft("one")
  assert.equal(getConnectionDraft("one"), undefined)
  assert.deepEqual(getConnectionDraft("two"), { name: "Two", url: "http://two" })

  clearConnectionDraft("two")
})
