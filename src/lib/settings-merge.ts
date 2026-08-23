// Pure settings helpers extracted from stores/settings.ts so the clamp + the
// forward-compatible merge (the upgrade path: stored data from an older app
// version that predates a newer notification category) are unit-testable without
// pulling in zustand / native storage modules.

export function clampPageSize(size: number): number {
  if (!Number.isFinite(size)) return 25
  return Math.max(10, Math.min(200, Math.round(size)))
}

export function clampSessionPageSize(size: number): number {
  if (!Number.isFinite(size)) return 10
  return Math.max(5, Math.min(30, Math.round(size)))
}

/**
 * Merge stored settings over defaults. Stored values win, but any top-level field
 * or notification category missing from storage falls back to its default — so a
 * user upgrading to a build with a new setting gets that setting's default rather
 * than `undefined`. Defaults are passed in to keep this module dependency-free.
 */
export function mergeStoredSettings<T extends { notifications: Record<string, boolean> }>(
  defaults: T,
  parsed: Partial<T>,
): T {
  return {
    ...defaults,
    ...parsed,
    notifications: { ...defaults.notifications, ...parsed.notifications },
  }
}

export function normalizeStoredSettings<T extends {
  pageSize: number
  sessionPageSize: number
  notifications: Record<string, boolean>
  locale: string
}>(raw: string, defaults: T, isLocale: (value: unknown) => value is T["locale"]): T | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const parsed = value as Record<string, unknown>
    const storedNotifications =
      parsed.notifications && typeof parsed.notifications === "object" && !Array.isArray(parsed.notifications)
        ? (parsed.notifications as Record<string, unknown>)
        : {}
    const notifications = Object.fromEntries(
      Object.entries(defaults.notifications).map(([category, fallback]) => [
        category,
        typeof storedNotifications[category] === "boolean" ? storedNotifications[category] : fallback,
      ]),
    ) as T["notifications"]
    const pageSize = typeof parsed.pageSize === "number" ? clampPageSize(parsed.pageSize) : defaults.pageSize
    const sessionPageSize =
      typeof parsed.sessionPageSize === "number" ? clampSessionPageSize(parsed.sessionPageSize) : defaults.sessionPageSize
    const locale = isLocale(parsed.locale) ? parsed.locale : defaults.locale

    return { ...defaults, pageSize, sessionPageSize, notifications, locale }
  } catch {
    return null
  }
}
