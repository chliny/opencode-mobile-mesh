import type { FileDiff } from "./sdk"

const diffs = new Map<string, FileDiff[]>()

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
