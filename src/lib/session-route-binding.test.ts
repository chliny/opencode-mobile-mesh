import { test } from "node:test"
import assert from "node:assert/strict"
import { sessionRouteState } from "./session-route-binding.ts"

test("a route is binding while the global store still holds another session", () => {
  assert.equal(sessionRouteState("s2", "s1", null), "binding")
})

test("a route is bound only to the matching current session", () => {
  assert.equal(sessionRouteState("s2", "s2", null), "bound")
})

test("a failed attempt applies only to the route it targeted", () => {
  assert.equal(sessionRouteState("s2", "s1", "s2"), "failed")
  assert.equal(sessionRouteState("s3", "s1", "s2"), "binding")
})
