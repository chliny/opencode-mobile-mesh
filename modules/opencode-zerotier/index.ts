import { requireOptionalNativeModule } from "expo-modules-core"

export interface ZeroTierStartOptions {
  profileId: string
  networkId: string
  remoteHost: string
  remotePort: number
  planetId?: string
  timeoutMs?: number
}

export interface ZeroTierStatus {
  state: "stopped" | "starting" | "awaiting_authorization" | "ready" | "error"
  phase?: "starting_node" | "joining_network" | "waiting_authorization"
  baseUrl?: string
  nodeId?: string
  assignedAddress?: string
  networkStatus?: string
  remoteHost?: string
  resolvedAddresses?: string[]
  error?: string
}

export interface InstalledPlanet {
  id: string
  name: string
  sha256: string
  size: number
}

interface NativeZeroTierModule {
  start(options: ZeroTierStartOptions): Promise<ZeroTierStatus>
  stop(): Promise<void>
  getStatus(): Promise<ZeroTierStatus>
  pickPlanetFile(): Promise<InstalledPlanet | null>
  installPlanetBase64(encoded: string): Promise<InstalledPlanet>
  installPlanet(uri: string, name?: string): Promise<InstalledPlanet>
  removePlanet(id: string): Promise<void>
}

const native = requireOptionalNativeModule<NativeZeroTierModule>("OpenCodeZeroTier")

function requireAndroidModule(): NativeZeroTierModule {
  if (!native) throw new Error("Embedded ZeroTier is available only in the Android native build")
  return native
}

export const embeddedZeroTier = {
  isAvailable: Boolean(native),
  start: (options: ZeroTierStartOptions) => requireAndroidModule().start(options),
  stop: () => (native ? native.stop() : Promise.resolve()),
  getStatus: () =>
    native
      ? native.getStatus()
      : Promise.resolve<ZeroTierStatus>({ state: "stopped" }),
  pickPlanetFile: () => requireAndroidModule().pickPlanetFile(),
  installPlanetBase64: (encoded: string) => requireAndroidModule().installPlanetBase64(encoded),
  installPlanet: (uri: string, name?: string) => requireAndroidModule().installPlanet(uri, name),
  removePlanet: (id: string) => (native ? native.removePlanet(id) : Promise.resolve()),
}
