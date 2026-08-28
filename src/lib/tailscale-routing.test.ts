import assert from "node:assert/strict"
import test from "node:test"
import { parseTailscaleTarget, relayBaseUrl } from "./tailscale-routing.ts"

test("parses a Tailscale IPv4 OpenCode endpoint", () => {
  const target = parseTailscaleTarget("http://100.64.12.34:4096")
  assert.deepEqual(target, { host: "100.64.12.34", port: 4096, path: "" })
  assert.equal(relayBaseUrl("http://127.0.0.1:49152", target), "http://127.0.0.1:49152")
})

test("preserves a MagicDNS host and base path through the relay", () => {
  const target = parseTailscaleTarget("http://openclaw-dev-1.tailnet.ts.net:4096/opencode/")
  assert.deepEqual(target, { host: "openclaw-dev-1.tailnet.ts.net", port: 4096, path: "/opencode" })
  assert.equal(relayBaseUrl("http://127.0.0.1:49152/", target), "http://127.0.0.1:49152/opencode")
})

test("rejects TLS and URLs that cannot be safely relayed", () => {
  assert.throws(() => parseTailscaleTarget("https://100.64.12.34:4096"), /http:\/\//)
  assert.throws(() => parseTailscaleTarget("http://user:secret@100.64.12.34:4096"), /credentials/)
})
