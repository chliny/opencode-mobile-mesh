import type { FileDiff, Message } from "./sdk"

export function reviewDiffsForMessage(message: Message, messages: Message[]): FileDiff[] | undefined {
  if (message.role !== "assistant" || !message.parentID) return undefined
  const activeUser = messages.filter((item) => item.role === "user").at(-1)
  if (message.parentID !== activeUser?.id) return undefined
  const activeAssistants = messages.filter((item) => item.role === "assistant" && item.parentID === activeUser.id)
  if (message.id !== activeAssistants.at(-1)?.id) return undefined
  return messages.find((item) => item.id === message.parentID)?.summary?.diffs
}

/**
 * Turn diffs live on the last user message's `summary.diffs` — the server's
 * /session/:id/diff endpoint returns [] without a messageID and upstream's own
 * UI reads this field instead. Returns [] when the last visible turn has no
 * recorded diff and undefined when the transcript has no user message at all.
 */
export function turnDiffsFromMessages(messages: Message[], revertMessageID?: string): FileDiff[] | undefined {
  let users = messages.filter((item) => item.role === "user")
  if (revertMessageID) {
    const boundary = users.findIndex((item) => item.id === revertMessageID)
    if (boundary >= 0) users = users.slice(0, boundary)
  }
  const last = users.at(-1)
  return last ? (last.summary?.diffs ?? []) : undefined
}
