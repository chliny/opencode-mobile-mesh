export function shouldApplyTranscriptRefresh(input: {
  expectedSessionID?: string
  requestedSessionID: string
  currentSessionID?: string
  requestRevision: number
  currentRevision: number
}): boolean {
  if (input.expectedSessionID && input.expectedSessionID !== input.requestedSessionID) return false
  if (input.currentSessionID !== input.requestedSessionID) return false
  return input.currentRevision === input.requestRevision
}
