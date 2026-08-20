import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const dir = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(dir, "../../app/session/[id].tsx"), "utf8")

test("the session route binds transcript data before rendering it", () => {
  assert.match(source, /const transcriptBound = routeState === ["']bound["']/)
  assert.match(source, /if \(!transcriptBound\) return \[\]/)
})

test("unbound routes gate session chrome and expose failed-load recovery", () => {
  for (const marker of [
    "transcriptBound && (\n          <SessionInfo",
    "transcriptBound && currentSession && <StatusIndicator",
    "transcriptBound && permissions.map",
    "transcriptBound && questions.map",
    "transcriptBound && <ImageAttachments",
    'routeState === "failed"',
    "onPress={bindSession}",
    "onPress={() => router.back()}",
  ]) {
    assert.ok(source.includes(marker), `missing route-binding marker: ${marker}`)
  }
})
