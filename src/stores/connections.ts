import { create } from "zustand"
import * as SecureStore from "expo-secure-store"
import * as Crypto from "expo-crypto"
import type { ServerConnection, ConnectionType } from "../lib/types"
import { createClient, type Client, type Project } from "../lib/sdk"
import { addBreadcrumb } from "../lib/sentry"
import { AnalyticsEvent, classifyConnectionError, track, type ConnectionTestSource } from "../lib/analytics"
import { buildAuth } from "../lib/auth"
import { stripTrailingSlash } from "../lib/path-utils"
import { embeddedZeroTier } from "@opencode-ai/zerotier"
import { embeddedTailscale } from "@opencode-ai/tailscale"
import { parseZeroTierTarget, relayBaseUrl } from "../lib/zerotier-routing"
import { parseTailscaleTarget, relayBaseUrl as tailscaleRelayBaseUrl } from "../lib/tailscale-routing"
import i18n from "../lib/i18n/config"
import { log } from "../lib/logbuffer"

const CONNECTIONS_KEY = "opencode_connections"
const PASSWORDS_PREFIX = "opencode_password_"
const RECENT_DIRS_KEY = "opencode_recent_dirs"
const MAX_RECENT_DIRS = 10
// A bad IP (unreachable host, wrong port) otherwise hangs for the full 30s
// general request timeout before the user sees a "connection failed" error —
// a first-run bounce driver. The interactive connect flow can afford to fail
// faster since a real server responds to /global/health in well under a
// second; this does NOT affect the timeout used for real session traffic.
// libzt's supported Java socket API uses a 30-second connect timeout. Keep the
// health probe alive long enough for the relay to report its native error
// instead of returning an unrelated localhost timeout first.
const CONNECTION_TEST_TIMEOUT_MS = 40_000

let routeGeneration = 0
let routeRefreshQueue = Promise.resolve()
let lastNetworkRefreshAt = 0

// Cached auth so we can create directory-scoped clients without async SecureStore lookups
interface ClientBase {
  baseUrl: string
  auth?: { username: string; password: string }
}

interface ConnectionsState {
  connections: ServerConnection[]
  activeConnection: ServerConnection | null
  client: Client | null
  clientBase: ClientBase | null
  currentProject: Project | null
  serverHome: string | null // Home directory on the server machine (for ~ expansion)
  serverDirectory: string | null // Effective default directory on the server
  recentDirectories: string[]
  isLoading: boolean
  error: string | null
  routeStatus: "idle" | "checking" | "lan" | "zerotier" | "tailscale" | "error"
  routeError: string | null

  // Actions
  loadConnections: () => Promise<void>
  addConnection: (connection: Omit<ServerConnection, "id">, password?: string) => Promise<void>
  removeConnection: (id: string) => Promise<void>
  setActiveConnection: (id: string) => Promise<void>
  // `source` distinguishes the activation funnel (onboarding) from the edit
  // screen's Test button (edit_test) in analytics.
  testConnection: (
    connection: ServerConnection,
    source: ConnectionTestSource,
    password?: string,
  ) => Promise<{ ok: boolean; error?: string; loginUrl?: string }>
  updateConnection: (id: string, updates: Partial<ServerConnection>, password?: string) => Promise<void>
  refreshProject: () => Promise<void>
  // Create a one-off client pointing at a specific directory (for cross-project operations).
  // Pass undefined to get a directory-less client that queries the server without project scope.
  clientForDirectory: (directory?: string) => Client | null
  // Switch the active connection's directory and reload
  switchDirectory: (directory?: string) => Promise<void>
  // Record a directory as recently used
  addRecentDirectory: (directory: string) => Promise<void>
  // Re-establish the active transport. ZeroTier profiles always use the
  // embedded libzt relay; stale concurrent attempts are ignored.
  refreshActiveRoute: (forceRestart?: boolean) => Promise<void>
}

function generateId(): string {
  return Crypto.randomUUID().replace(/-/g, "").slice(0, 16)
}

function buildClient(
  url: string,
  directory?: string,
  auth?: { username: string; password: string },
): { client: Client; base: ClientBase } {
  const base: ClientBase = { baseUrl: url, auth }
  const client = createClient({ baseUrl: url, directory, auth })
  return { client, base }
}

async function resolveConnectionRoute(
  connection: ServerConnection,
  forceRestart = false,
): Promise<{ baseUrl: string; route: "lan" | "zerotier" | "tailscale" }> {
  if (!connection.zerotier && !connection.tailscale) return { baseUrl: connection.url, route: "lan" }

  if (connection.tailscale) {
    const target = parseTailscaleTarget(connection.url)
    // Keep the pre-save test and persisted profile on the same node identity.
    const profileId = `ts-${(connection.tailscale.hostname || target.host).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 50)}`
    const result = await embeddedTailscale.start({
      profileId,
      remoteHost: target.host.replace(/^\[|\]$/g, ""),
      remotePort: target.port,
      hostname: connection.tailscale.hostname,
    })
    if (result.state === "needs_login" && result.loginUrl) {
      throw new Error(`Tailscale login required: ${result.loginUrl}`)
    }
    if (result.state !== "ready" || !result.baseUrl) {
      throw new Error(result.error || "Embedded Tailscale did not become ready")
    }
    return { baseUrl: tailscaleRelayBaseUrl(result.baseUrl, target), route: "tailscale" }
  }

  const target = parseZeroTierTarget({ networkId: connection.zerotier!.networkId, url: connection.url })
  const normalizedNetworkId = connection.zerotier!.networkId.trim().toLowerCase()
  // Stable across "test" and "save" so the node authorized during the test
  // remains the same identity after the connection receives its database ID.
  const profileId = `zt-${normalizedNetworkId}-${connection.zerotier!.planet?.id.slice(0, 16) || "default"}`
  const result = await embeddedZeroTier.start({
    profileId,
    networkId: normalizedNetworkId,
    remoteHost: target.host.replace(/^\[|\]$/g, ""),
    remotePort: target.port,
    planetId: connection.zerotier!.planet?.id,
    forceRestart,
  })
  if (result.state === "waiting_for_configuration") {
    throw new Error(
      i18n.t("connection.zerotier.configurationPending", {
        nodeId: result.nodeId || "unknown",
        networkId: normalizedNetworkId,
      }),
    )
  }
  if (result.state === "configuration_incomplete") {
    throw new Error(
      i18n.t("connection.zerotier.configurationIncomplete", {
        nodeId: result.nodeId || "unknown",
        networkId: normalizedNetworkId,
      }),
    )
  }
  if (result.state === "awaiting_authorization") {
    throw new Error(
      i18n.t("connection.zerotier.authorizationRequired", {
        nodeId: result.nodeId || "unknown",
        networkId: normalizedNetworkId,
      }),
    )
  }
  if (result.state !== "ready" || !result.baseUrl) {
    throw new Error(result.error || "Embedded ZeroTier did not become ready")
  }
  return { baseUrl: relayBaseUrl(result.baseUrl, target), route: "zerotier" }
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  connections: [],
  activeConnection: null,
  client: null,
  clientBase: null,
  serverHome: null,
  serverDirectory: null,
  currentProject: null,
  recentDirectories: [],
  isLoading: true,
  error: null,
  routeStatus: "idle",
  routeError: null,

  loadConnections: async () => {
    try {
      set({ isLoading: true, error: null })
      const [stored, recentRaw] = await Promise.all([
        SecureStore.getItemAsync(CONNECTIONS_KEY),
        SecureStore.getItemAsync(RECENT_DIRS_KEY),
      ])
      const saved: Array<ServerConnection | (Omit<ServerConnection, "type"> & { type: "cloud" })> = stored
        ? JSON.parse(stored)
        : []
      const connections: ServerConnection[] = saved.map((connection) => (
        connection.type === "cloud" ? { ...connection, type: "tunnel" } : connection
      ))
      const recentDirectories: string[] = recentRaw ? JSON.parse(recentRaw) : []

      // Find active connection
      const active = connections.find((c) => c.active) || null

      // Create client for active connection
      let client: Client | null = null
      let base: ClientBase | null = null
      let project: Project | null = null
      let home: string | null = null
      let directory: string | null = null
      if (active) {
        const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${active.id}`)
        const auth = buildAuth(active.username, password)
        // A ZeroTier profile must wait until its app-local libzt relay is ready.
        if (!active.zerotier && !active.tailscale) {
          const built = buildClient(active.url, active.directory, auth)
          client = built.client
          base = built.base
          // Fetch current project info and server paths
          try {
            const [proj, paths] = await Promise.all([
              client.project.current().catch(() => null),
              client.path.get().catch(() => null),
            ])
            project = proj
            home = paths?.home || null
            directory = paths?.directory || null
          } catch {
            // Server might be offline
          }
        }
      }

      set({
        connections,
        activeConnection: active,
        client,
        clientBase: base,
        currentProject: project,
        serverHome: home,
        serverDirectory: directory,
        recentDirectories,
        isLoading: false,
      })
      if (active) void get().refreshActiveRoute()
    } catch (error) {
      set({ error: "Failed to load connections", isLoading: false })
    }
  },

  addConnection: async (connection, password) => {
    const id = generateId()
    const newConnection: ServerConnection = {
      ...connection,
      id,
      active: get().connections.length === 0, // First connection is active
    }

    const connections = [...get().connections, newConnection]

    // Store password separately if provided
    if (password) {
      await SecureStore.setItemAsync(`${PASSWORDS_PREFIX}${id}`, password)
    }
    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    // If this is the first/active connection, create client
    let client = get().client
    let base = get().clientBase
    let activeConnection = get().activeConnection

    let project = get().currentProject
    let serverHome = get().serverHome
    let serverDirectory = get().serverDirectory

    if (newConnection.active) {
      activeConnection = newConnection
      if (newConnection.zerotier || newConnection.tailscale) {
        client = null
        base = null
        project = null
        serverHome = null
        serverDirectory = null
      } else {
        const auth = buildAuth(newConnection.username, password)
        const built = buildClient(newConnection.url, newConnection.directory, auth)
        client = built.client
        base = built.base

        // Fetch server metadata so loadSessions can use clientForDirectory(serverHome)
        // immediately after the connection is added (same as setActiveConnection does).
        try {
          const [proj, paths] = await Promise.all([
            client.project.current().catch(() => null),
            client.path.get().catch(() => null),
          ])
          project = proj
          serverHome = paths?.home || null
          serverDirectory = paths?.directory || null
        } catch {
          // Server might be unreachable; proceed without metadata
        }
      }
    }

    set({ connections, activeConnection, client, clientBase: base, currentProject: project, serverHome, serverDirectory })
    if (newConnection.active) void get().refreshActiveRoute()
  },

  removeConnection: async (id) => {
    const connections = get().connections.filter((c) => c.id !== id)

    // Remove stored password.
    await SecureStore.deleteItemAsync(`${PASSWORDS_PREFIX}${id}`)
    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    // If removing active connection, clear client
    const wasActive = get().activeConnection?.id === id
    if (wasActive) {
      const newActive = connections[0] || null
      if (newActive) {
        // Mark new connection as active
        newActive.active = true
        await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))
        const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${newActive.id}`)
        const auth = buildAuth(newActive.username, password)
        const built = newActive.zerotier || newActive.tailscale ? null : buildClient(newActive.url, newActive.directory, auth)
        set({
          connections,
          activeConnection: newActive,
          client: built?.client || null,
          clientBase: built?.base || null,
          currentProject: null,
          serverHome: null,
          serverDirectory: null,
        })
        void get().refreshActiveRoute()
      } else {
        set({
          connections,
          activeConnection: null,
          client: null,
          clientBase: null,
          currentProject: null,
          serverHome: null,
          serverDirectory: null,
        })
        void embeddedZeroTier.stop()
        void embeddedTailscale.stop()
      }
    } else {
      set({ connections })
    }
  },

  setActiveConnection: async (id) => {
    const connections = get().connections.map((c) => ({
      ...c,
      active: c.id === id,
    }))

    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    const active = connections.find((c) => c.id === id) || null
    let client: Client | null = null
    let base: ClientBase | null = null
    let project: Project | null = null
    let home: string | null = null
    let directory: string | null = null

    if (active) {
      const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${active.id}`)
      const auth = buildAuth(active.username, password)
      if (!active.zerotier && !active.tailscale) {
        const built = buildClient(active.url, active.directory, auth)
        client = built.client
        base = built.base

        try {
          const [proj, paths] = await Promise.all([
            client.project.current().catch(() => null),
            client.path.get().catch(() => null),
          ])
          project = proj
          home = paths?.home || null
          directory = paths?.directory || null
        } catch {
          // Server might be offline
        }
      }

      // Update last connected time
      active.lastConnected = Date.now()
      await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))
    }

    set({
      connections,
      activeConnection: active,
      client,
      clientBase: base,
      currentProject: project,
      serverHome: home,
      serverDirectory: directory,
    })
    if (active) void get().refreshActiveRoute()
    else {
      void embeddedZeroTier.stop()
      void embeddedTailscale.stop()
    }
    addBreadcrumb({
      category: "connection",
      message: active ? `active connection set: ${active.type}` : "active connection cleared",
      data: { id: active?.id, type: active?.type, hasProject: Boolean(project) },
    })
  },

  testConnection: async (connection, source, password) => {
    track(AnalyticsEvent.ConnectionAttempted, { source })
    let pendingTailscaleLogin = false
    try {
      const auth = buildAuth(connection.username, password)
      const resolved = await resolveConnectionRoute(connection)
      const client = createClient({
        baseUrl: resolved.baseUrl,
        directory: connection.directory,
        auth,
      })

      await client.global.health(CONNECTION_TEST_TIMEOUT_MS)
      track(AnalyticsEvent.ConnectionSucceeded, { source })
      return { ok: true }
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      if (connection.zerotier) {
        const zeroTierStatus = await embeddedZeroTier.getStatus().catch(() => null)
        if (zeroTierStatus?.state === "error" && zeroTierStatus.error && !message.includes(zeroTierStatus.error)) {
          message = `${message}\n\nZeroTier: ${zeroTierStatus.error}`
        }
      }
      if (connection.tailscale) {
        const tailscaleStatus = await embeddedTailscale.getStatus().catch(() => null)
        const loginUrl = tailscaleStatus?.loginUrl || message.match(/Tailscale login required:\s*(\S+)/)?.[1]
        if (loginUrl && (tailscaleStatus?.state === "needs_login" || message.startsWith("Tailscale login required:"))) {
          pendingTailscaleLogin = true
          return { ok: false, error: "Tailscale login required", loginUrl }
        }
        if (tailscaleStatus?.state === "error" && tailscaleStatus.error && !message.includes(tailscaleStatus.error)) {
          message = `${message}\n\nTailscale: ${tailscaleStatus.error}`
        }
      }
      track(AnalyticsEvent.ConnectionFailed, { source, error_class: classifyConnectionError(message) })
      return { ok: false, error: message }
    } finally {
      // Testing any profile may temporarily replace an embedded singleton.
      // Restore the persisted active profile before returning so a failed
      // Tailscale test cannot leave the healthy ZeroTier route unusable.
      if (get().activeConnection && !pendingTailscaleLogin) {
        await get().refreshActiveRoute().catch((restoreError) => {
          log.warn("route", "active route restore failed after connection test", String(restoreError))
        })
      }
    }
  },

  updateConnection: async (id, updates, password) => {
    const connections = get().connections.map((c) => (c.id === id ? { ...c, ...updates } : c))

    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    // Persist a new password only when one was entered. The edit form loads the
    // password field blank (passwords aren't read back for security), so an
    // empty value means "keep the existing password", not "clear it". Written
    // before the active-client rebuild below so the rebuilt client picks it up.
    if (password) {
      await SecureStore.setItemAsync(`${PASSWORDS_PREFIX}${id}`, password)
    }
    // If updating active connection, recreate client
    if (get().activeConnection?.id === id) {
      const active = connections.find((c) => c.id === id)!
      const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${id}`)
      const auth = buildAuth(active.username, password)
      if (active.zerotier || active.tailscale) {
        set({
          connections,
          activeConnection: active,
          client: null,
          clientBase: null,
          currentProject: null,
          serverHome: null,
          serverDirectory: null,
        })
        void get().refreshActiveRoute()
        return
      }
      const built = buildClient(active.url, active.directory, auth)
      try {
        const [project, paths] = await Promise.all([
          built.client.project.current().catch(() => null),
          built.client.path.get().catch(() => null),
        ])
        set({
          connections,
          activeConnection: active,
          client: built.client,
          clientBase: built.base,
          currentProject: project,
          serverHome: paths?.home || null,
          serverDirectory: paths?.directory || null,
        })
        void get().refreshActiveRoute()
      } catch {
        set({
          connections,
          activeConnection: active,
          client: built.client,
          clientBase: built.base,
          currentProject: null,
          serverHome: null,
          serverDirectory: null,
        })
        void get().refreshActiveRoute()
      }
    } else {
      set({ connections })
    }
  },

  refreshProject: async () => {
    const client = get().client
    if (!client) return

    try {
      const project = await client.project.current()
      set({ currentProject: project })
    } catch {
      set({ currentProject: null })
    }
  },

  clientForDirectory: (directory) => {
    const base = get().clientBase
    if (!base) return null
    // Reuse current client if directory matches
    const active = get().activeConnection
    if (active?.directory === directory) return get().client
    return createClient({ baseUrl: base.baseUrl, directory, auth: base.auth })
  },

  switchDirectory: async (directory) => {
    const active = get().activeConnection
    if (!active) return
    // Update connection directory and recreate client. Normalize trailing
    // slashes so "/home/user" and "/home/user/" don't diverge (recent-dir
    // duplicates + a mismatched "current directory" highlight).
    const trimmed = directory?.trim()
    const dir = trimmed ? stripTrailingSlash(trimmed) : undefined

    // Validate the target before persisting it. An invalid directory must not
    // replace the last known-good directory in the connection settings.
    if (dir && dir !== active.directory) {
      const client = get().clientForDirectory(dir)
      if (!client) throw new Error("No active connection")
      await client.path.get()
    }

    await get().updateConnection(active.id, { directory: dir })
    // Record in recents if it's a real directory
    if (dir) await get().addRecentDirectory(dir)
  },

  addRecentDirectory: async (directory) => {
    const current = get().recentDirectories
    // Normalize trailing slashes so the same dir entered as ".../x" and
    // ".../x/" dedups to one recent-list entry instead of two.
    directory = stripTrailingSlash(directory.trim())
    // Move to front, dedup, cap at MAX
    const updated = [directory, ...current.filter((d) => d !== directory)].slice(0, MAX_RECENT_DIRS)
    set({ recentDirectories: updated })
    await SecureStore.setItemAsync(RECENT_DIRS_KEY, JSON.stringify(updated))
  },

  refreshActiveRoute: (forceRestart = false) => {
    const run = routeRefreshQueue.then(async () => {
      const generation = ++routeGeneration
      const active = get().activeConnection
      try {
        if (!active) {
          if (generation === routeGeneration) set({ routeStatus: "idle", routeError: null })
          return
        }

        set({ routeStatus: "checking", routeError: null })
        log.info("route", "refresh start", `force=${forceRestart}`)
        const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${active.id}`)
        const auth = buildAuth(active.username, password)
        // The embedded relays are process-wide native singletons. Tear down
        // the other relay before starting this route so switching between
        // ZeroTier and Tailscale cannot leave both native services alive.
        if (active.zerotier) await embeddedTailscale.stop()
        if (active.tailscale) await embeddedZeroTier.stop()
        if (generation !== routeGeneration || get().activeConnection?.id !== active.id) return
        // Do not restart a live ZeroTier relay because a one-shot health probe
        // timed out. The probe uses a separate short-lived socket and can fail
        // while the long-lived SSE transport is healthy; restarting here would
        // disconnect the current screen. SSE reconnects request a forced
        // restart after repeated failures instead.
        const resolved = await resolveConnectionRoute(active, forceRestart)
        if (generation !== routeGeneration || get().activeConnection?.id !== active.id) return

        if (resolved.route !== "zerotier") await embeddedZeroTier.stop()
        if (resolved.route !== "tailscale") await embeddedTailscale.stop()
        if (generation !== routeGeneration || get().activeConnection?.id !== active.id) return

        if (get().clientBase?.baseUrl === resolved.baseUrl) {
          set({ routeStatus: resolved.route, routeError: null })
          log.info("route", "refresh reused transport", resolved.route)
          return
        }

        const built = buildClient(resolved.baseUrl, active.directory, auth)
        set({
          client: built.client,
          clientBase: built.base,
          routeStatus: resolved.route,
          routeError: null,
        })
        log.info("route", "transport ready", resolved.route)

        // Publish the ready transport before fetching optional metadata so
        // sessions, SSE, and the catalog can start without waiting for these
        // extra requests to complete.
        const [project, paths] = await Promise.all([
          built.client.project.current().catch(() => null),
          built.client.path.get().catch(() => null),
        ])
        if (generation !== routeGeneration || get().activeConnection?.id !== active.id) return
        set({
          currentProject: project,
          serverHome: paths?.home || null,
          serverDirectory: paths?.directory || null,
        })
      } catch (error) {
        if (generation !== routeGeneration) return
        set({
          routeStatus: "error",
          routeError: error instanceof Error ? error.message : String(error),
        })
        log.warn("route", "refresh failed", String(error))
      }
    })
    routeRefreshQueue = run.catch(() => {})
    return run
  },
}))

// Network changes invalidate the physical path used by both embedded relays.
// Let the native node recover first, then rebuild only the active route.
function refreshEmbeddedRouteOnNetworkChange(available: boolean) {
  const active = useConnections.getState().activeConnection
  if (!(active?.zerotier || active?.tailscale)) return
  if (!available) return
  if (Date.now() - lastNetworkRefreshAt < 1000) return
  lastNetworkRefreshAt = Date.now()
  // Do not force-restart an embedded node for every Android callback. Both
  // native modules observe the same physical network and callbacks can arrive
  // in pairs while a network is handed over. A normal refresh reuses a healthy
  // relay and only rebuilds a failed one, preventing a restart loop.
  void useConnections.getState().refreshActiveRoute()
}

embeddedZeroTier.addNetworkListener((event) => refreshEmbeddedRouteOnNetworkChange(event.available))
embeddedTailscale.addNetworkListener((event) => refreshEmbeddedRouteOnNetworkChange(event.available))
