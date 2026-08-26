import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core"

export interface TailscaleStartOptions {
  profileId: string
  remoteHost: string
  remotePort: number
  hostname?: string
}

export interface TailscaleAuthStatus {
  mode: "interactive"
  interactiveLogin: true
}

export interface TailscaleStatus {
  state: "stopped" | "starting" | "needs_login" | "ready" | "error"
  phase?: "starting" | "control_plane" | "waiting_auth" | "tailnet" | "relay" | "network_unavailable"
  baseUrl?: string
  loginUrl?: string
  hostname?: string
  tailnetIPv4?: string
  tailnetIPv6?: string
  remoteHost?: string
  remotePort?: number
  auth?: TailscaleAuthStatus
  networkAvailable?: boolean
  networkType?: string
  lastNetworkChangeAt?: number
  controlPlaneOnline?: boolean
  tailnetOnline?: boolean
  diagnosticCode?: string
  diagnosticMessage?: string
  error?: string
}

interface NativeTailscaleModule {
  start(options: TailscaleStartOptions): Promise<TailscaleStatus>
  stop(): Promise<void>
  getStatus(): Promise<TailscaleStatus>
  addListener(event: "networkChanged", listener: (event: NetworkChangedEvent) => void): EventSubscription
}

export interface NetworkChangedEvent {
  available: boolean
  type: string
  at: number
}

const native = requireOptionalNativeModule<NativeTailscaleModule>("OpenCodeTailscale")

function requireAndroidModule(): NativeTailscaleModule {
  if (!native) throw new Error("Embedded Tailscale is available only in the Android native build")
  return native
}

export const embeddedTailscale = {
  isAvailable: Boolean(native),
  start: (options: TailscaleStartOptions) => requireAndroidModule().start(options),
  stop: () => (native ? native.stop() : Promise.resolve()),
  getStatus: () =>
    native
      ? native.getStatus()
      : Promise.resolve<TailscaleStatus>({ state: "stopped" }),
  addNetworkListener: (listener: (event: NetworkChangedEvent) => void) =>
    native?.addListener("networkChanged", listener) || { remove: () => {} },
}
