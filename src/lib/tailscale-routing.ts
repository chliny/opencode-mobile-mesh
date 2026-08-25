export interface TailscaleTarget {
  host: string
  port: number
  path: string
}

export function parseTailscaleTarget(url: string): TailscaleTarget {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error("Tailscale OpenCode URL is invalid")
  }
  if (parsed.protocol !== "http:") {
    throw new Error("Embedded Tailscale currently requires an http:// OpenCode URL")
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Tailscale OpenCode URL cannot include credentials, a query, or a fragment")
  }
  if (!parsed.hostname) throw new Error("Tailscale OpenCode URL must include a host")
  const port = parsed.port ? Number(parsed.port) : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Tailscale OpenCode URL has an invalid port")
  }
  return { host: parsed.hostname, port, path: parsed.pathname.replace(/\/$/, "") }
}

export function relayBaseUrl(relayUrl: string, target: TailscaleTarget): string {
  return `${relayUrl.replace(/\/$/, "")}${target.path}`
}
