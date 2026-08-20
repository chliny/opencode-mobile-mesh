export const AT_BOTTOM_THRESHOLD_PX = 200

export function isAtBottom(offsetY: number, threshold = AT_BOTTOM_THRESHOLD_PX): boolean {
  return offsetY <= threshold
}

export function shouldShowScrollButton(offsetY: number, threshold = AT_BOTTOM_THRESHOLD_PX): boolean {
  return !isAtBottom(offsetY, threshold)
}

export function shouldAutoScroll(input: {
  offsetY: number
  previousSignature: string | null
  currentSignature: string
  threshold?: number
}): boolean {
  if (input.previousSignature === input.currentSignature) return false
  return isAtBottom(input.offsetY, input.threshold ?? AT_BOTTOM_THRESHOLD_PX)
}

export function transcriptSignature(input: {
  revision: number
  messageCount: number
  newestMessageID: string | null
  newestPartCount: number
  newestTextLength: number
}): string {
  return [
    input.revision,
    input.messageCount,
    input.newestMessageID ?? "",
    input.newestPartCount,
    input.newestTextLength,
  ].join(":")
}
