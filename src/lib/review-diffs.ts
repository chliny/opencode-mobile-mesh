import type { FileDiff, Message } from "./sdk"

export function reviewDiffsForMessage(message: Message, messages: Message[]): FileDiff[] | undefined {
  if (message.role !== "assistant" || !message.parentID) return undefined
  return messages.find((item) => item.id === message.parentID)?.summary?.diffs
}
