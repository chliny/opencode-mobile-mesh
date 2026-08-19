import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isHealthy,
  isStreamStale,
  readWithTimeout,
  shouldReconnectOnResume,
  shouldResetRetries,
} from "./sse-liveness.ts"

test("detects an SSE stream that exceeded the liveness window", () => {
  assert.equal(isStreamStale({ lastEventAt: 1_000, now: 35_999, timeoutMs: 35_000 }), false)
  assert.equal(isStreamStale({ lastEventAt: 1_000, now: 36_000, timeoutMs: 35_000 }), true)
})

test("only received bytes reset retries and mark a transport healthy", () => {
  assert.equal(shouldResetRetries({ receivedEvent: false }), false)
  assert.equal(shouldResetRetries({ receivedEvent: true }), true)
  assert.equal(isHealthy("connecting"), false)
  assert.equal(isHealthy("live"), true)
})

test("resume reconnects only when no healthy or in-flight attempt exists", () => {
  assert.equal(shouldReconnectOnResume({ transport: "idle", attemptInFlight: false }), true)
  assert.equal(shouldReconnectOnResume({ transport: "connecting", attemptInFlight: true }), false)
  assert.equal(shouldReconnectOnResume({ transport: "live", attemptInFlight: false }), false)
})

test("read timeout rejects without waiting for reader cancellation", async () => {
  let aborted = 0
  let cancelled = 0
  const never = new Promise<never>(() => undefined)

  await assert.rejects(
    readWithTimeout({
      read: () => never,
      cancel: () => {
        cancelled += 1
        return never
      },
      abort: () => {
        aborted += 1
      },
      timeoutMs: 5,
    }),
    /SSE stream idle for 5ms/,
  )

  assert.equal(aborted, 1)
  assert.equal(cancelled, 1)
})

test("successful reads clear the timeout without cleanup", async () => {
  let aborted = 0
  let cancelled = 0
  const result = await readWithTimeout({
    read: async () => ({ done: false, value: "chunk" }),
    cancel: async () => {
      cancelled += 1
    },
    abort: () => {
      aborted += 1
    },
    timeoutMs: 5,
  })

  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(result, { done: false, value: "chunk" })
  assert.equal(aborted, 0)
  assert.equal(cancelled, 0)
})
