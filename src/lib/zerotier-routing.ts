export interface ZeroTierTarget {
  host: string
  port: number
  path: string
}

export interface ZeroTierTargetConfig {
  networkId: string
  url: string
}

export function parseZeroTierTarget(config: ZeroTierTargetConfig): ZeroTierTarget {
  if (!/^[0-9a-fA-F]{16}$/.test(config.networkId.trim())) {
    throw new Error("ZeroTier network ID must contain exactly 16 hexadecimal characters")
  }

  let parsed: URL
  try {
    parsed = new URL(config.url.trim())
  } catch {
    throw new Error("ZeroTier OpenCode URL is invalid")
  }
  if (parsed.protocol !== "http:") {
    throw new Error("Embedded ZeroTier currently requires an http:// OpenCode URL")
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("ZeroTier OpenCode URL cannot include credentials, a query, or a fragment")
  }
  const host = parsed.hostname
  if (!host) throw new Error("ZeroTier OpenCode URL must include a host")
  const port = parsed.port ? Number(parsed.port) : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ZeroTier OpenCode URL has an invalid port")
  }
  return { host, port, path: parsed.pathname.replace(/\/$/, "") }
}

export function relayBaseUrl(relayUrl: string, target: ZeroTierTarget): string {
  return `${relayUrl.replace(/\/$/, "")}${target.path}`
}
