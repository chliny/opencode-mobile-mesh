import type { Part } from "./sdk"

export function messageTextFromParts(parts: Part[]): string {
  return parts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n")
}
