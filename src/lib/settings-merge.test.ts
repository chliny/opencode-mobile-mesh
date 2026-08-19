import { test } from "node:test"
import assert from "node:assert/strict"
import { clampPageSize, mergeStoredSettings, normalizeStoredSettings } from "./settings-merge.ts"
import { isLocalePreference } from "./i18n/locale-resolve.ts"

const DEFAULTS = {
  pageSize: 25,
  notifications: { idle: true, error: true, permission: false },
  locale: "system" as const,
}

test("clampPageSize keeps in-range values unchanged", () => {
  assert.equal(clampPageSize(25), 25)
  assert.equal(clampPageSize(10), 10)
  assert.equal(clampPageSize(200), 200)
})

test("clampPageSize floors below 10 and caps above 200", () => {
  assert.equal(clampPageSize(0), 10)
  assert.equal(clampPageSize(-5), 10)
  assert.equal(clampPageSize(9), 10)
  assert.equal(clampPageSize(201), 200)
  assert.equal(clampPageSize(99999), 200)
  assert.equal(clampPageSize(Number.NaN), 25)
})

test("normalizeStoredSettings rejects malformed and non-object JSON", () => {
  assert.equal(normalizeStoredSettings("not json", DEFAULTS, isLocalePreference), null)
  assert.equal(normalizeStoredSettings("[]", DEFAULTS, isLocalePreference), null)
  assert.equal(normalizeStoredSettings("null", DEFAULTS, isLocalePreference), null)
})

test("normalizeStoredSettings validates page size, locale, categories and booleans", () => {
  const normalized = normalizeStoredSettings(
    JSON.stringify({
      pageSize: 999,
      locale: "future-locale",
      notifications: { idle: false, error: "yes", unknown: true },
    }),
    DEFAULTS,
    isLocalePreference,
  )

  assert.deepEqual(normalized, {
    pageSize: 200,
    locale: "system",
    notifications: { idle: false, error: true, permission: false },
  })
})

test("empty stored settings yield the defaults", () => {
  assert.deepEqual(mergeStoredSettings(DEFAULTS, {}), DEFAULTS)
})

test("stored values override defaults", () => {
  const merged = mergeStoredSettings(DEFAULTS, { pageSize: 50 })
  assert.equal(merged.pageSize, 50)
  assert.deepEqual(merged.notifications, DEFAULTS.notifications)
})

test("upgrade path: a category missing from storage gets its default", () => {
  // Stored data predates the "permission" category — it must come back as the default (false),
  // not undefined, while the user's stored choices are preserved.
  const merged = mergeStoredSettings(DEFAULTS, { notifications: { idle: false, error: true } })
  assert.equal(merged.notifications.idle, false) // user's stored choice kept
  assert.equal(merged.notifications.error, true)
  assert.equal(merged.notifications.permission, false) // new category -> default
  assert.equal("permission" in merged.notifications, true)
})

test("does not mutate the inputs", () => {
  const defaults = { pageSize: 25, notifications: { a: true } }
  const parsed = { notifications: { a: false } }
  const merged = mergeStoredSettings(defaults, parsed)
  assert.equal(defaults.notifications.a, true) // untouched
  assert.equal(parsed.notifications.a, false) // untouched
  assert.equal(merged.notifications.a, false)
  assert.notEqual(merged.notifications, defaults.notifications)
})
