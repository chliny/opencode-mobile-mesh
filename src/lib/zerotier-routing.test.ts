import assert from "node:assert/strict"
import test from "node:test"
import { parseZeroTierTarget, relayBaseUrl } from "./zerotier-routing.ts"

test("parses an IPv4 ZeroTier OpenCode endpoint", () => {
  const target = parseZeroTierTarget({ networkId: "8056c2e21c000001", url: "http://10.10.0.8:4096" })
  assert.deepEqual(target, { host: "10.10.0.8", port: 4096, path: "" })
  assert.equal(relayBaseUrl("http://127.0.0.1:49152", target), "http://127.0.0.1:49152")
})

test("preserves a base path through the app-local relay", () => {
  const target = parseZeroTierTarget({ networkId: "8056C2E21C000001", url: "http://[fd00::8]:4096/opencode/" })
  assert.equal(target.host.replace(/^\[|\]$/g, ""), "fd00::8")
  assert.equal(relayBaseUrl("http://127.0.0.1:49152/", target), "http://127.0.0.1:49152/opencode")
})

test("accepts hostnames and rejects TLS", () => {
  assert.throws(
    () => parseZeroTierTarget({ networkId: "8056c2e21c000001", url: "https://10.10.0.8:4096" }),
    /http:\/\//,
  )
  assert.deepEqual(
    parseZeroTierTarget({ networkId: "8056c2e21c000001", url: "http://server.internal:4096/opencode" }),
    { host: "server.internal", port: 4096, path: "/opencode" },
  )
})

test("rejects malformed network IDs and invalid URLs", () => {
  assert.throws(() => parseZeroTierTarget({ networkId: "1234", url: "http://10.0.0.1" }), /16 hexadecimal/)
  assert.throws(
    () => parseZeroTierTarget({ networkId: "8056c2e21c000001", url: "http://999.0.0.1" }),
    /invalid|numeric/,
  )
})
