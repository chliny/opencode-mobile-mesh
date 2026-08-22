import type { FileDiff } from "./sdk"

const diffs = new Map<string, FileDiff[]>()
const vcsDiffs = new Map<string, { value: FileDiff[]; expires: number }>()
const VCS_CACHE_TTL = 15_000

function key(directory: string | undefined, sessionID: string, mode: "git" | "turn" | "branch"): string {
  return `${directory || ""}\0${sessionID}\0${mode}`
}

export function getCachedDiffs(directory: string | undefined, sessionID: string, mode: "git" | "turn" | "branch"): FileDiff[] | undefined {
  return diffs.get(key(directory, sessionID, mode))
}

export function cacheDiffs(directory: string | undefined, sessionID: string, mode: "git" | "turn" | "branch", value: FileDiff[]): void {
  diffs.set(key(directory, sessionID, mode), value)
}

export function clearCachedDiffs(directory: string | undefined, sessionID: string, mode: "git" | "turn" | "branch"): void {
  diffs.delete(key(directory, sessionID, mode))
}

function vcsKey(directory: string | undefined, mode: "git" | "branch"): string {
  return `${directory || ""}\0${mode}`
}

export function getCachedVcsDiffs(directory: string | undefined, mode: "git" | "branch"): FileDiff[] | undefined {
  const cached = vcsDiffs.get(vcsKey(directory, mode))
  if (!cached) return undefined
  if (cached.expires <= Date.now()) {
    vcsDiffs.delete(vcsKey(directory, mode))
    return undefined
  }
  return cached.value
}

export function cacheVcsDiffs(directory: string | undefined, mode: "git" | "branch", value: FileDiff[]): void {
  vcsDiffs.set(vcsKey(directory, mode), { value, expires: Date.now() + VCS_CACHE_TTL })
}

export function clearCachedVcsDiffs(directory?: string): void {
  if (directory === undefined) {
    vcsDiffs.clear()
    return
  }
  const prefix = `${directory}\0`
  for (const item of vcsDiffs.keys()) {
    if (item.startsWith(prefix)) vcsDiffs.delete(item)
  }
}
