/**
 * In-app update discovery (AGE-110) — the device half.
 *
 * Runtime wiring only: AsyncStorage, the GitHub releases API, the running app
 * version. All decisions live in update-check-policy.ts so they are testable
 * under `node --test`; see that file for why this exists at all.
 *
 * WHY GITHUB RELEASES AND NOT `expo-updates`
 * ------------------------------------------
 * expo-updates ships JS over the air, which cannot replace a native binary and
 * would not have fixed the cohort this targets (they need a new APK). The
 * GitHub releases API is the source for the direct APK distributed by this
 * fork. The app opens the release page so users can choose the appropriate APK
 * for their device.
 *
 * WHY ANDROID ONLY
 * ----------------
 * iOS installs come from TestFlight/App Store, which already handle updates and
 * where pointing a user at a GitHub download is nonsense (and against review
 * guidelines).
 *
 * PRIVACY
 * -------
 * One unauthenticated GET per 24h to api.github.com, no query params, no ids,
 * no analytics. GitHub sees an IP that already downloaded the APK from GitHub.
 * The only thing stored on device is a timestamp and two version strings.
 */

import { Platform } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import appJson from "../../app.json"
import {
  DISMISSED_KEY,
  resolveUpdate,
  type AvailableUpdate,
  type UpdateStorage,
} from "./update-check-policy"
import { RELEASES_API, RELEASES_PAGE } from "./update-check-config"

export type { AvailableUpdate }
export { RELEASES_API, RELEASES_PAGE }

/** Same source Sentry uses for `release`, so the two always agree. */
export const CURRENT_VERSION = (appJson as { expo?: { version?: string } }).expo?.version ?? "unknown"

const TIMEOUT_MS = 8000

const storage: UpdateStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
}

async function fetchLatestRelease(): Promise<AvailableUpdate | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = (await response.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }
    if (body?.draft || body?.prerelease) return null
    const tag = typeof body?.tag_name === "string" ? body.tag_name.replace(/^v/i, "") : null
    if (!tag) return null
    return { version: tag, url: typeof body?.html_url === "string" ? body.html_url : RELEASES_PAGE }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Returns the update the user should be told about, or null for "stay quiet".
 * Safe to call on every foreground: the 24h throttle lives in the policy.
 */
export async function checkForUpdate(options?: {
  force?: boolean
  /** Settings passes true: a dismissal silences the banner, not the About row. */
  ignoreDismissed?: boolean
}): Promise<AvailableUpdate | null> {
  if (Platform.OS !== "android") return null
  return resolveUpdate({
    storage,
    fetchLatest: fetchLatestRelease,
    currentVersion: CURRENT_VERSION,
    force: options?.force,
    ignoreDismissed: options?.ignoreDismissed,
  })
}

/** "Not now" — remembered for this version only, never re-asked for it. */
export async function dismissUpdate(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, version)
  } catch {
    // A dismissal we could not persist costs one extra banner, nothing more.
  }
}
