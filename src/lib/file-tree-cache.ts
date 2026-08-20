import type { FileEntry } from "./sdk"

const entries = new Map<string, FileEntry[]>()

function key(directory: string | undefined, path: string): string {
  return `${directory || ""}\0${path}`
}

export function getCachedFileEntries(directory: string | undefined, path: string): FileEntry[] | undefined {
  return entries.get(key(directory, path))
}

export function cacheFileEntries(directory: string | undefined, path: string, value: FileEntry[]): void {
  entries.set(key(directory, path), value)
}

export function clearCachedFileEntries(directory?: string): void {
  if (directory === undefined) {
    entries.clear()
    return
  }
  const prefix = `${directory}\0`
  for (const item of entries.keys()) {
    if (item.startsWith(prefix)) entries.delete(item)
  }
}
