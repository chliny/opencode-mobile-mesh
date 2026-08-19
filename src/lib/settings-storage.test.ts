import { test } from "node:test"
import assert from "node:assert/strict"
import { loadMigratedSettings, type SettingsStorage } from "./settings-storage.ts"

type Value = { pageSize: number }

function storage(input: {
  current?: string | null
  legacy?: string | null
  currentError?: Error
  writeError?: Error
  deleteError?: Error
}) {
  const calls: string[] = []
  const adapter: SettingsStorage<Value> = {
    readCurrent: async () => {
      calls.push("readCurrent")
      if (input.currentError) throw input.currentError
      return input.current ?? null
    },
    readLegacy: async () => {
      calls.push("readLegacy")
      return input.legacy ?? null
    },
    writeCurrent: async (value) => {
      calls.push(`writeCurrent:${value}`)
      if (input.writeError) throw input.writeError
    },
    deleteLegacy: async () => {
      calls.push("deleteLegacy")
      if (input.deleteError) throw input.deleteError
    },
    normalize: (raw) => {
      try {
        const parsed = JSON.parse(raw) as { pageSize?: unknown }
        return typeof parsed.pageSize === "number" ? { pageSize: parsed.pageSize } : null
      } catch {
        return null
      }
    },
  }
  return { adapter, calls }
}

test("uses a valid current value without reading legacy storage", async () => {
  const subject = storage({ current: '{"pageSize":50}', legacy: '{"pageSize":25}' })
  assert.deepEqual(await loadMigratedSettings(subject.adapter), { pageSize: 50 })
  assert.deepEqual(subject.calls, ["readCurrent"])
})

test("migrates only when current storage confirms the key is absent", async () => {
  const subject = storage({ current: null, legacy: '{"pageSize":25}' })
  assert.deepEqual(await loadMigratedSettings(subject.adapter), { pageSize: 25 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(subject.calls, ["readCurrent", "readLegacy", 'writeCurrent:{"pageSize":25}', "deleteLegacy"])
})

test("keeps legacy after a failed current write so migration can retry", async () => {
  const subject = storage({ legacy: '{"pageSize":25}', writeError: new Error("unavailable") })
  assert.deepEqual(await loadMigratedSettings(subject.adapter), { pageSize: 25 })
  assert.deepEqual(subject.calls, ["readCurrent", "readLegacy", 'writeCurrent:{"pageSize":25}'])
})

test("current read errors use legacy only as a process fallback", async () => {
  const subject = storage({ currentError: new Error("locked"), legacy: '{"pageSize":25}' })
  assert.deepEqual(await loadMigratedSettings(subject.adapter), { pageSize: 25 })
  assert.deepEqual(subject.calls, ["readCurrent", "readLegacy"])
})

test("invalid current data does not get overwritten by legacy", async () => {
  const subject = storage({ current: "future-schema", legacy: '{"pageSize":25}' })
  assert.deepEqual(await loadMigratedSettings(subject.adapter), { pageSize: 25 })
  assert.deepEqual(subject.calls, ["readCurrent", "readLegacy"])
})

test("legacy deletion is best effort after a successful migration", async () => {
  const subject = storage({ legacy: '{"pageSize":25}', deleteError: new Error("locked") })
  assert.deepEqual(await loadMigratedSettings(subject.adapter), { pageSize: 25 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(subject.calls.includes("deleteLegacy"), true)
})
