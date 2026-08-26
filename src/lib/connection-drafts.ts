export interface ConnectionFormDraft {
  mode?: "quick" | "advanced"
  type?: "local" | "tunnel" | "zerotier" | "tailscale"
  name?: string
  ip?: string
  port?: string
  url?: string
  directory?: string
  username?: string
  password?: string
  zeroTierNetworkId?: string
  planet?: unknown
  planetBase64?: string
  showPlanetBase64?: boolean
  tailscaleHostname?: string
}

const drafts = new Map<string, ConnectionFormDraft>()

export function getConnectionDraft(key: string): ConnectionFormDraft | undefined {
  return drafts.get(key)
}

export function setConnectionDraft(key: string, draft: ConnectionFormDraft): void {
  drafts.set(key, draft)
}

export function clearConnectionDraft(key: string): void {
  drafts.delete(key)
}
