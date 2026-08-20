export type SessionRouteState = "binding" | "bound" | "failed"

export function sessionRouteState(
  routeSessionID: string | null | undefined,
  currentSessionID: string | null | undefined,
  failedSessionID: string | null | undefined,
): SessionRouteState {
  if (routeSessionID && currentSessionID === routeSessionID) return "bound"
  if (routeSessionID && failedSessionID === routeSessionID) return "failed"
  return "binding"
}
