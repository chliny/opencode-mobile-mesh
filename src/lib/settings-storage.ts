export interface SettingsStorage<T> {
  readCurrent: () => Promise<string | null>
  readLegacy: () => Promise<string | null>
  writeCurrent: (value: string) => Promise<void>
  deleteLegacy: () => Promise<void>
  normalize: (raw: string) => T | null
}

async function readLegacy<T>(storage: SettingsStorage<T>): Promise<T | null> {
  const raw = await storage.readLegacy().catch(() => null)
  return raw === null ? null : storage.normalize(raw)
}

export async function loadMigratedSettings<T>(storage: SettingsStorage<T>): Promise<T | null> {
  let currentRaw: string | null
  try {
    currentRaw = await storage.readCurrent()
  } catch {
    return readLegacy(storage)
  }

  if (currentRaw !== null) {
    const current = storage.normalize(currentRaw)
    if (current) return current
    return readLegacy(storage)
  }

  const legacy = await readLegacy(storage)
  if (!legacy) return null

  try {
    await storage.writeCurrent(JSON.stringify(legacy))
  } catch {
    return legacy
  }

  void storage.deleteLegacy().catch(() => undefined)
  return legacy
}
