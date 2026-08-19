export const LIVENESS_TIMEOUT_MS = 35_000
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000] as const

export type TransportState = "idle" | "connecting" | "live"

export function isStreamStale(input: { lastEventAt: number; now: number; timeoutMs?: number }): boolean {
  return input.now - input.lastEventAt >= (input.timeoutMs ?? LIVENESS_TIMEOUT_MS)
}

export function shouldResetRetries(input: { receivedEvent: boolean }): boolean {
  return input.receivedEvent
}

export function shouldReconnectOnResume(input: {
  transport: TransportState
  attemptInFlight: boolean
}): boolean {
  if (input.transport === "live") return false
  return !input.attemptInFlight
}

export function isHealthy(transport: TransportState): boolean {
  return transport === "live"
}

export async function readWithTimeout<T>(input: {
  read: () => Promise<T>
  cancel: (reason?: string) => Promise<void>
  abort: () => void
  timeoutMs?: number
}): Promise<T> {
  const timeoutMs = input.timeoutMs ?? LIVENESS_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      input.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const message = `SSE stream idle for ${timeoutMs}ms`
          reject(new Error(message))
          input.abort()
          void input.cancel(message).catch(() => undefined)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
