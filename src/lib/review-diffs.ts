import type { FileDiff, Message } from "./sdk"

export function reviewDiffsForMessage(message: Message, messages: Message[], isLastMessage: boolean): FileDiff[] | undefined {
  if (!isLastMessage || message.role !== "assistant" || !message.parentID) return undefined
  return messages.find((item) => item.id === message.parentID)?.summary?.diffs
}
