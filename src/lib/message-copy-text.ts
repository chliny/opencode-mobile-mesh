import type { Part } from "./sdk"

export function extractCopyText(parts: Part[] | undefined): string {
  return (parts || [])
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
}

export function hasCopyableText(parts: Part[] | undefined): boolean {
  return extractCopyText(parts).trim().length > 0
}
