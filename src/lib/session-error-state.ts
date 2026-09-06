export function replaceSessionError(
  sessionErrors: Record<string, string>,
  sessionID: string,
  error: string | undefined,
): Record<string, string> {
  const next = { ...sessionErrors }
  if (error) next[sessionID] = error
  else delete next[sessionID]
  return next
}
