// Connection types for multiple server support
export type ConnectionType = "local" | "tunnel" | "cloud" | "zerotier"

export interface ZeroTierPlanet {
  // Content-addressed identifier of the copy in the app's private storage.
  id: string
  name: string
  sha256: string
  size: number
  // Kept in the local connection profile when the planet was pasted so it
  // can be viewed and updated the next time the profile is edited.
  base64?: string
}

export interface ZeroTierConnectionConfig {
  networkId: string
  planet?: ZeroTierPlanet
}

export interface ServerConnection {
  id: string
  name: string
  type: ConnectionType
  // For ZeroTier profiles this is the address inside the ZeroTier network.
  // It may be a hostname when system DNS resolves it to that managed address.
  url: string
  // When present, all app traffic uses the embedded userspace ZeroTier relay.
  zerotier?: ZeroTierConnectionConfig
  // For auth
  username?: string
  // Password stored separately in SecureStore
  // Directory to use for this connection
  directory?: string
  // When last successfully connected
  lastConnected?: number
  // Is this the active connection?
  active?: boolean
}

export interface AppSettings {
  // Require biometric auth to open app
  requireBiometric: boolean
  // Require biometric to send messages
  requireBiometricForMessages: boolean
  // Theme preference
  theme: "light" | "dark" | "system"
  // Show notifications for task completion
  notifications: boolean
}

// Re-export SDK types we'll use frequently
export type { Session, Message, Part, Project, Event, HealthResponse } from "./sdk"
