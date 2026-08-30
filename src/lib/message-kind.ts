import type { Part } from "./sdk"

export function isCompactionMessage(parts: Part[]): boolean {
  return parts.some((part) => part.type === "compaction")
}
