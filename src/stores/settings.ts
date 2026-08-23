import { create } from "zustand"
import * as SecureStore from "expo-secure-store"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { type Category, defaultPreferences } from "../lib/notifications"
import { clampPageSize, clampSessionPageSize, normalizeStoredSettings } from "../lib/settings-merge"
import { setAppLocale } from "../lib/i18n/config"
import { isLocalePreference, type LocalePreference } from "../lib/i18n/locale-resolve"
import { loadMigratedSettings } from "../lib/settings-storage"
import { log } from "../lib/logbuffer"

export const SETTINGS_KEY = "opencode_settings"

interface Settings {
  pageSize: number
  sessionPageSize: number
  notifications: Record<Category, boolean>
  locale: LocalePreference
}

const DEFAULTS: Settings = {
  pageSize: 25,
  sessionPageSize: 10,
  notifications: { ...defaultPreferences },
  locale: "system",
}

interface SettingsState extends Settings {
  loaded: boolean
  load: () => Promise<void>
  setPageSize: (size: number) => Promise<void>
  setSessionPageSize: (size: number) => Promise<void>
  setNotification: (category: Category, enabled: boolean) => Promise<void>
  setLocale: (locale: LocalePreference) => Promise<void>
}

function snapshot(get: () => SettingsState): Settings {
  return {
    pageSize: get().pageSize,
    sessionPageSize: get().sessionPageSize,
    notifications: get().notifications,
    locale: get().locale,
  }
}

async function persist(settings: Settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

const settingsStorage = {
  readCurrent: () => AsyncStorage.getItem(SETTINGS_KEY),
  readLegacy: () => SecureStore.getItemAsync(SETTINGS_KEY),
  writeCurrent: (value: string) => AsyncStorage.setItem(SETTINGS_KEY, value),
  deleteLegacy: () => SecureStore.deleteItemAsync(SETTINGS_KEY),
  normalize: (raw: string) => normalizeStoredSettings(raw, DEFAULTS, isLocalePreference),
}

let loadPromise: Promise<void> | null = null
let writeQueue = Promise.resolve()

function enqueuePersist(settings: Settings): Promise<void> {
  const next = writeQueue.then(() => persist(settings))
  writeQueue = next.catch(() => undefined)
  return next
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  load: async () => {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const settings = await loadMigratedSettings(settingsStorage)
        if (settings) {
          set({ ...settings, loaded: true })
          setAppLocale(settings.locale)
          return
        }
      } catch (error) {
        log.warn("settings", "failed to load preferences", String(error))
      }
      set({ loaded: true })
    })()
    return loadPromise
  },

  setPageSize: async (size) => {
    await get().load()
    const clamped = clampPageSize(size)
    const next = { ...snapshot(get), pageSize: clamped }
    set(next)
    await enqueuePersist(next)
  },

  setSessionPageSize: async (size) => {
    await get().load()
    const next = { ...snapshot(get), sessionPageSize: clampSessionPageSize(size) }
    set(next)
    await enqueuePersist(next)
  },

  setNotification: async (category, enabled) => {
    await get().load()
    const notifications = { ...get().notifications, [category]: enabled }
    const next = { ...snapshot(get), notifications }
    set(next)
    await enqueuePersist(next)
  },

  setLocale: async (locale) => {
    await get().load()
    const next = { ...snapshot(get), locale }
    set(next)
    setAppLocale(locale) // applies immediately
    await enqueuePersist(next)
  },
}))
