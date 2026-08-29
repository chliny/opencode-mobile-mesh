import assert from "node:assert/strict"
import test from "node:test"
import { isStandardBase64 } from "./base64.ts"

test("accepts standard padded Base64 and whitespace", () => {
  assert.equal(isStandardBase64("AQIDBA==\n"), true)
})

test("rejects URL-encoded and malformed Base64", () => {
  assert.equal(isStandardBase64("AQIDBA%3D%3D"), false)
  assert.equal(isStandardBase64("AQIDBA="), false)
  assert.equal(isStandardBase64("AQIDBA==extra"), false)
})
