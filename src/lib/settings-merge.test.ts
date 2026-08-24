import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clampPageSize,
  clampProjectPageSize,
  clampSessionPageSize,
  mergeStoredSettings,
  normalizeStoredSettings,
} from "./settings-merge.ts"
import { isLocalePreference } from "./i18n/locale-resolve.ts"

const DEFAULTS = {
  pageSize: 25,
  sessionPageSize: 10,
  projectPageSize: 5,
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

test("clampSessionPageSize enforces the 5 to 30 range", () => {
  assert.equal(clampSessionPageSize(5), 5)
  assert.equal(clampSessionPageSize(30), 30)
  assert.equal(clampSessionPageSize(4), 5)
  assert.equal(clampSessionPageSize(31), 30)
  assert.equal(clampSessionPageSize(Number.NaN), 10)
})

test("clampProjectPageSize enforces the 3 to 20 range", () => {
  assert.equal(clampProjectPageSize(3), 3)
  assert.equal(clampProjectPageSize(20), 20)
  assert.equal(clampProjectPageSize(2), 3)
  assert.equal(clampProjectPageSize(21), 20)
  assert.equal(clampProjectPageSize(Number.NaN), 5)
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
      sessionPageSize: 99,
      projectPageSize: 99,
      locale: "future-locale",
      notifications: { idle: false, error: "yes", unknown: true },
    }),
    DEFAULTS,
    isLocalePreference,
  )

  assert.deepEqual(normalized, {
    pageSize: 200,
    sessionPageSize: 30,
    projectPageSize: 20,
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
  const defaults = { pageSize: 25, sessionPageSize: 10, projectPageSize: 5, notifications: { a: true } }
  const parsed = { notifications: { a: false } }
  const merged = mergeStoredSettings(defaults, parsed)
  assert.equal(defaults.notifications.a, true) // untouched
  assert.equal(parsed.notifications.a, false) // untouched
  assert.equal(merged.notifications.a, false)
  assert.notEqual(merged.notifications, defaults.notifications)
})
