import type { Message } from "./sdk"

type ServerError = {
  message?: string
  data?: { message?: string; responseBody?: string }
}

function messageFromValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return undefined
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown }
      return messageFromValue(parsed.error) || messageFromValue(parsed.message) || text
    } catch {
      return text
    }
  }
  if (!value || typeof value !== "object") return undefined
  const error = value as ServerError
  return messageFromValue(error.data?.message) || messageFromValue(error.message) || messageFromValue(error.data?.responseBody)
}

export function messageErrorText(error: Message["error"] | unknown): string | undefined {
  return messageFromValue(error)
}
