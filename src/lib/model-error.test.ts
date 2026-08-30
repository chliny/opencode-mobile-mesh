import { test } from "node:test"
import assert from "node:assert/strict"
import { messageErrorText } from "./model-error.ts"

test("extracts the current server error shape", () => {
  assert.equal(
    messageErrorText({ name: "APIError", data: { message: "This model is not available in your region" } }),
    "This model is not available in your region",
  )
})

test("extracts provider messages embedded in a JSON response body", () => {
  assert.equal(
    messageErrorText({ data: { responseBody: '{"error":{"message":"Region unavailable"}}' } }),
    "Region unavailable",
  )
})

test("keeps flat errors compatible", () => {
  assert.equal(messageErrorText({ message: "Model request failed" }), "Model request failed")
})

test("preserves stream transport errors", () => {
  assert.equal(
    messageErrorText('Post "https://chatgpt.com/backend-api/codex/responses": stream error: stream ID 1; PROTOCOL_ERROR; received from peer'),
    'Post "https://chatgpt.com/backend-api/codex/responses": stream error: stream ID 1; PROTOCOL_ERROR; received from peer',
  )
})
