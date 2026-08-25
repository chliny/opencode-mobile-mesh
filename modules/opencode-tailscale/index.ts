import { requireOptionalNativeModule } from "expo-modules-core"

export interface TailscaleStartOptions {
  profileId: string
  authKey: string
  remoteHost: string
  remotePort: number
  hostname?: string
}

export interface TailscaleAuthStatus {
  mode: "auth_key"
  provided: boolean
  interactiveLogin: false
}

export interface TailscaleStatus {
  state: "stopped" | "starting" | "ready" | "error"
  baseUrl?: string
  hostname?: string
  tailnetIPv4?: string
  tailnetIPv6?: string
  remoteHost?: string
  remotePort?: number
  auth?: TailscaleAuthStatus
  error?: string
}

interface NativeTailscaleModule {
  start(options: TailscaleStartOptions): Promise<TailscaleStatus>
  stop(): Promise<void>
  getStatus(): Promise<TailscaleStatus>
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
}
