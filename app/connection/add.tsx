import { useEffect, useRef, useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { WebView } from "react-native-webview"
import { useConnections } from "../../src/stores/connections"
import type { ConnectionType, TailscaleConnectionConfig, ZeroTierPlanet } from "../../src/lib/types"
import { embeddedZeroTier } from "@opencode-ai/zerotier"
import { embeddedTailscale } from "@opencode-ai/tailscale"
import { parseZeroTierTarget } from "../../src/lib/zerotier-routing"
import { isStandardBase64 } from "../../src/lib/base64"
import { parseTailscaleTarget } from "../../src/lib/tailscale-routing"
import { probeConnection, shareReport } from "../../src/lib/diagnostics"
import { parseUrl } from "../../src/lib/diagnostics-classify"
import { buildAuth } from "../../src/lib/auth"
import { AnalyticsEvent, track } from "../../src/lib/analytics"
import { clearConnectionDraft, getConnectionDraft, setConnectionDraft } from "../../src/lib/connection-drafts"

const ADD_DRAFT_KEY = "new"

export default function AddConnectionScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { addConnection, testConnection } = useConnections()

  const draft = getConnectionDraft(ADD_DRAFT_KEY)
  const [mode, setMode] = useState<"quick" | "advanced">(draft?.mode || "quick")
  const [type, setType] = useState<ConnectionType>(draft?.type || "local")
  const [name, setName] = useState(draft?.name || "")
  const [ip, setIp] = useState(draft?.ip || "")
  const [port, setPort] = useState(draft?.port || "4096")
  const [url, setUrl] = useState(draft?.url || "")
  const [directory, setDirectory] = useState(draft?.directory || "")
  const [username, setUsername] = useState(draft?.username || "")
  const [password, setPassword] = useState(draft?.password || "")
  const [zeroTierNetworkId, setZeroTierNetworkId] = useState(draft?.zeroTierNetworkId || "")
  const [planet, setPlanet] = useState<ZeroTierPlanet | undefined>(draft?.planet as ZeroTierPlanet | undefined)
  const [planetBase64, setPlanetBase64] = useState(draft?.planetBase64 || "")
  const [showPlanetBase64, setShowPlanetBase64] = useState(draft?.showPlanetBase64 || false)
  const [planetImportSource, setPlanetImportSource] = useState<"file" | "base64" | null>(null)
  const isImportingPlanet = planetImportSource !== null
  const [isConnecting, setIsConnecting] = useState(false)
  const awaitingTailscaleLogin = useRef(false)
  const completedTailscaleLogin = useRef(false)
  const tailscaleWebView = useRef<WebView>(null)
  const [tailscaleLoginUrl, setTailscaleLoginUrl] = useState<string | null>(null)
  const [tailscaleHostname, setTailscaleHostname] = useState(draft?.tailscaleHostname || "")

  useEffect(() => {
    setConnectionDraft(ADD_DRAFT_KEY, {
      mode, type, name, ip, port, url, directory, username, password,
      zeroTierNetworkId, planet, planetBase64, showPlanetBase64, tailscaleHostname,
    })
  }, [mode, type, name, ip, port, url, directory, username, password, zeroTierNetworkId, planet, planetBase64, showPlanetBase64, tailscaleHostname])

  const buildUrl = () => {
    if (mode === "advanced") return url.trim()
    const raw = ip.trim()
    if (!raw) return ""
    // Be forgiving about pasted values: a full URL, a host:port, or a
    // host with a trailing path. Extract scheme, host, and port so we
    // never produce "http://http://host:4096:4096".
    const schemeMatch = raw.match(/^(https?):\/\//i)
    const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "http"
    let rest = raw.replace(/^https?:\/\//i, "")
    rest = rest.split("/")[0] // drop any path/query
    let host = rest
    let pastedPort = ""
    const lastColon = rest.lastIndexOf(":")
    // Only treat trailing ":NNNN" as a port (ignore IPv6 colons / bare host)
    if (lastColon > -1 && /^\d+$/.test(rest.slice(lastColon + 1))) {
      host = rest.slice(0, lastColon)
      pastedPort = rest.slice(lastColon + 1)
    }
    const finalPort = pastedPort || port.trim() || "4096"
    return `${scheme}://${host}:${finalPort}`
  }

  const handleQuickConnect = async () => {
    const serverUrl = buildUrl()
    if (!serverUrl) {
      Alert.alert(t("common.error"), t("connection.add.alerts.enterIp"))
      return
    }

    track(AnalyticsEvent.ConnectionFormSubmitted, { mode: "quick" })
    setIsConnecting(true)

    // Test connection first. Quick Connect has no username field, so the
    // connection is intentionally saved without one — buildAuth() defaults
    // it to "opencode" wherever auth is built. Sending the `username` state
    // here would leak a value typed earlier in Advanced mode (issue: Back to
    // Quick silently overriding the default).
    const result = await testConnection(
      {
        id: "",
        name: name || t("connection.shared.namePlaceholder"),
        type: "local",
        url: serverUrl,
      },
      "onboarding",
      password || undefined,
    )

    if (result.ok) {
      // Save and go back
      try {
        await addConnection(
          {
            name: name.trim() || t("connection.shared.namePlaceholder"),
            type: "local",
            url: serverUrl,
          },
          password || undefined,
        )
        clearConnectionDraft(ADD_DRAFT_KEY)
        setIsConnecting(false)
        router.back()
      } catch {
        setIsConnecting(false)
        Alert.alert(
          t("connection.shared.alerts.saveFailedTitle"),
          t("connection.shared.alerts.saveFailedMessage"),
        )
      }
    } else {
      // Failed: run active diagnostics and offer a local shareable report.
      const report = await probeConnection(serverUrl, buildAuth(undefined, password))
      setIsConnecting(false)
      Alert.alert(
        t("connection.shared.alerts.connectionFailedTitle"),
        t("connection.add.alerts.connectionFailedMessage", {
          summary: report.summary,
          target: serverUrl,
          error: result.error || t("connection.shared.alerts.unknownError"),
        }),
        [
          { text: t("common.ok"), style: "cancel" },
          { text: t("common.shareReport"), onPress: () => shareReport(report) },
        ],
      )
    }
  }

  const handleAdvancedSave = async () => {
    if (!name.trim()) {
      Alert.alert(t("common.error"), t("connection.shared.alerts.enterName"))
      return
    }
    const connectionUrl = url.trim()
    if (!connectionUrl) {
      Alert.alert(t("common.error"), t("connection.shared.alerts.enterUrl"))
      return
    }
    if (type !== "zerotier" && type !== "tailscale" && !parseUrl(connectionUrl).valid) {
      Alert.alert(t("connection.shared.alerts.invalidUrlTitle"), t("connection.shared.alerts.invalidUrlMessage"))
      return
    }

    const zerotier = type === "zerotier"
      ? { networkId: zeroTierNetworkId.trim(), planet }
      : undefined
    const tailscale: TailscaleConnectionConfig | undefined = type === "tailscale"
      ? { hostname: tailscaleHostname.trim() || undefined }
      : undefined
    if (zerotier) {
      try {
        parseZeroTierTarget({ networkId: zerotier.networkId, url: connectionUrl })
      } catch (error) {
        Alert.alert(t("connection.zerotier.invalidTitle"), error instanceof Error ? error.message : String(error))
        return
      }
    }
    if (tailscale) {
      try {
        parseTailscaleTarget(connectionUrl)
      } catch (error) {
        Alert.alert(t("connection.tailscale.invalidTitle"), error instanceof Error ? error.message : String(error))
        return
      }
    }

    track(AnalyticsEvent.ConnectionFormSubmitted, { mode: "advanced" })
    setIsConnecting(true)

    // Pre-flight, mirroring Quick Connect: previously Advanced mode saved
    // directly with no health check, so bad credentials (401/403) or an
    // unreachable server silently became the active connection with zero
    // feedback (issue #76). testConnection() also fires the
    // connection_attempted/succeeded/failed analytics events.
    const result = await testConnection(
      {
        id: "",
        name: name.trim(),
        type,
        url: connectionUrl,
        directory: directory.trim() || undefined,
        username: username.trim() || undefined,
        zerotier,
        tailscale,
      },
      "onboarding",
      password || undefined,
    )

    if (result.ok) {
      try {
        await addConnection(
          {
            name: name.trim(),
            type,
            url: connectionUrl,
            directory: directory.trim() || undefined,
            username: username.trim() || undefined,
            zerotier,
            tailscale,
          },
          password || undefined,
        )
        clearConnectionDraft(ADD_DRAFT_KEY)
        setIsConnecting(false)
        router.back()
      } catch {
        setIsConnecting(false)
        Alert.alert(
          t("connection.shared.alerts.saveFailedTitle"),
          t("connection.shared.alerts.saveFailedMessage"),
        )
      }
      return
    }

    // Failed: same "Connection Failed" alert as Quick Connect — run active
    // diagnostics and offer a shareable report instead of
    // silently persisting an unreachable/unauthorized connection.
    if (type === "zerotier" || type === "tailscale") {
      if (type === "tailscale" && result.loginUrl) {
        if (awaitingTailscaleLogin.current) {
          Alert.alert(t("connection.tailscale.loginTitle"), t("connection.tailscale.loginMessage"))
          return
        }
        awaitingTailscaleLogin.current = true
        completedTailscaleLogin.current = false
        setTailscaleLoginUrl(result.loginUrl)
        return
      }
      setIsConnecting(false)
      awaitingTailscaleLogin.current = false
      Alert.alert(
        t("connection.shared.alerts.connectionFailedTitle"),
        result.error || t("connection.shared.alerts.unknownError"),
      )
      return
    }
    const report = await probeConnection(url.trim(), buildAuth(username, password))
    setIsConnecting(false)
    Alert.alert(
      t("connection.shared.alerts.connectionFailedTitle"),
      t("connection.add.alerts.connectionFailedMessage", {
        summary: report.summary,
        target: url.trim(),
        error: result.error || t("connection.shared.alerts.unknownError"),
      }),
      [
        { text: t("common.ok"), style: "cancel" },
        { text: t("common.shareReport"), onPress: () => shareReport(report) },
      ],
    )
  }

  useEffect(() => {
    if (!tailscaleLoginUrl) return
    const interval = setInterval(() => {
      void embeddedTailscale.getStatus().then((status) => {
        if (status.state !== "ready") return
        if (completedTailscaleLogin.current) return
        completedTailscaleLogin.current = true
        setTailscaleLoginUrl(null)
        awaitingTailscaleLogin.current = false
        // Keep the original save operation active while the authorized relay
        // becomes usable, then finish the same flow without another tap.
        void handleAdvancedSave()
      })
    }, 1_000)
    return () => clearInterval(interval)
  }, [tailscaleLoginUrl])

  const closeTailscaleLogin = () => {
    setTailscaleLoginUrl(null)
    awaitingTailscaleLogin.current = false
    completedTailscaleLogin.current = false
    setIsConnecting(false)
  }

  const handleImportPlanet = async () => {
    setPlanetImportSource("file")
    try {
      const installed = await embeddedZeroTier.pickPlanetFile()
      if (installed) {
        setPlanet(installed)
        setPlanetBase64("")
        setShowPlanetBase64(false)
      }
    } catch (error) {
      Alert.alert(t("connection.zerotier.importFailedTitle"), error instanceof Error ? error.message : String(error))
    } finally {
      setPlanetImportSource(null)
    }
  }

  const handleImportPlanetBase64 = async () => {
    const encoded = planetBase64.trim()
    if (!encoded) {
      Alert.alert(t("connection.zerotier.importFailedTitle"), t("connection.zerotier.planetBase64Empty"))
      return
    }
    if (!isStandardBase64(encoded)) {
      Alert.alert(t("connection.zerotier.importFailedTitle"), t("connection.zerotier.planetBase64Invalid"))
      return
    }
    setPlanetImportSource("base64")
    try {
      const installed = await embeddedZeroTier.installPlanetBase64(encoded)
      setPlanet({ ...installed, base64: encoded })
      setPlanetBase64(encoded)
    } catch (error) {
      Alert.alert(t("connection.zerotier.importFailedTitle"), error instanceof Error ? error.message : String(error))
    } finally {
      setPlanetImportSource(null)
    }
  }

  // Quick connect mode - simplified
  if (mode === "quick") {
    return (
      <KeyboardAvoidingView
        style={[styles.container, isDark && styles.containerDark]}
        enabled={Platform.OS === "ios"}
        behavior="padding"
      >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.quickHeader}>
          <Ionicons name="wifi" size={48} color={isDark ? "#ffffff" : "#0a0a0a"} />
          <Text style={[styles.quickTitle, isDark && styles.textDark]}>{t("connection.add.quick.title")}</Text>
          <Text style={[styles.quickSubtitle, isDark && styles.hintDark]}>{t("connection.add.quick.subtitle")}</Text>
        </View>

        {/* IP Address */}
        <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.add.quick.ipAddressLabel")}</Text>
        <View style={styles.ipRow}>
          <TextInput
            style={[styles.input, styles.ipInput, isDark && styles.inputDark]}
            placeholder="192.168.1.100"
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={ip}
            onChangeText={setIp}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="connect-ip-input"
          />
          <Text style={[styles.ipColon, isDark && styles.textDark]}>:</Text>
          <TextInput
            style={[styles.input, styles.portInput, isDark && styles.inputDark]}
            placeholder="4096"
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            testID="connect-port-input"
          />
        </View>

        {/* Optional name */}
        <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.add.quick.nameOptionalLabel")}</Text>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder={t("connection.add.quick.namePlaceholder")}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={name}
          onChangeText={setName}
        />

        {/* Password if needed */}
        <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.add.quick.passwordIfSetLabel")}</Text>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder={t("connection.add.quick.passwordPlaceholder")}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          testID="connect-password-input"
        />
        <Text style={[styles.usernameHint, isDark && styles.hintDark]}>
          {t("connection.add.quick.usernameHintPrefix")}
          <Text style={styles.code}>opencode</Text>
          {t("connection.add.quick.usernameHintMiddle")}
          <Text
            style={styles.usernameHintLink}
            onPress={() => setMode("advanced")}
            accessibilityRole="link"
            accessibilityLabel={t("connection.add.quick.advancedOptionsLink")}
            testID="advanced-options-hint"
          >
            {t("connection.add.quick.advancedOptionsLink")}
          </Text>
          {t("connection.add.quick.usernameHintSuffix")}
        </Text>

        {/* Connect button */}
        <TouchableOpacity
          style={[styles.connectButton, isDark && styles.connectButtonDark]}
          onPress={handleQuickConnect}
          disabled={isConnecting}
          testID="connect-submit-button"
        >
          {isConnecting ? (
            <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
          ) : (
            <>
              <Ionicons name="flash" size={20} color={isDark ? "#0a0a0a" : "#ffffff"} />
              <Text style={[styles.connectButtonText, isDark && styles.connectButtonTextDark]}>
                {t("connection.add.quick.connectButton")}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Help text */}
        <View style={[styles.helpBox, isDark && styles.helpBoxDark]}>
          <Text style={[styles.helpTitle, isDark && styles.textDark]}>{t("connection.add.quick.helpTitle")}</Text>
          <Text style={[styles.helpText, isDark && styles.hintDark]}>
            {t("connection.add.quick.helpMacPrefix")}
            {"\n"}
            <Text style={styles.code}>ipconfig getifaddr en0</Text>
          </Text>
          <Text style={[styles.helpText, isDark && styles.hintDark, { marginTop: 8 }]}>
            {t("connection.add.quick.helpTailscalePrefix")}
            {"\n"}
            <Text style={styles.code}>http://100.64.12.34:4096</Text>
            {"\n"}
            <Text style={styles.code}>http://my-mac.tailnet.ts.net:4096</Text>
          </Text>
          <Text style={[styles.helpText, isDark && styles.hintDark, { marginTop: 8 }]}>
            {t("connection.add.quick.helpProtocolPrefix")}
            <Text style={styles.code}>http://</Text>
            {t("connection.add.quick.helpProtocolMiddle")}
            <Text style={styles.code}>https://</Text>
            {t("connection.add.quick.helpProtocolSuffix")}
          </Text>
          <Text style={[styles.helpText, isDark && styles.hintDark, { marginTop: 8 }]}>
            {t("connection.add.quick.helpRunningPrefix")}
            {"\n"}
            <Text style={styles.code}>opencode serve --hostname 0.0.0.0</Text>
          </Text>
        </View>

        {/* Advanced mode link */}
        <TouchableOpacity
          style={styles.advancedLink}
          onPress={() => setMode("advanced")}
          accessibilityLabel="advanced-options"
          testID="advanced-options"
        >
          <Text style={[styles.advancedLinkText, isDark && styles.hintDark]}>
            {t("connection.add.quick.advancedLink")}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={isDark ? "#888888" : "#666666"} />
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // Advanced mode - full options
  return (
    <KeyboardAvoidingView
      style={[styles.container, isDark && styles.containerDark]}
      enabled={Platform.OS === "ios"}
      behavior="padding"
    >
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity style={styles.backToQuick} onPress={() => setMode("quick")}>
        <Ionicons name="chevron-back" size={16} color={isDark ? "#888888" : "#666666"} />
        <Text style={[styles.backToQuickText, isDark && styles.hintDark]}>{t("connection.add.advanced.backToQuick")}</Text>
      </TouchableOpacity>

      {/* Connection Type */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.connectionType")}</Text>
      <View style={styles.typeContainer}>
        {[
          { type: "local" as const, label: t("connection.shared.types.local"), icon: "wifi" as const },
          { type: "tunnel" as const, label: t("connection.shared.types.tunnel"), icon: "globe" as const },
          { type: "zerotier" as const, label: t("connection.shared.types.zerotier"), icon: "git-network" as const },
          { type: "tailscale" as const, label: t("connection.shared.types.tailscale"), icon: "git-branch" as const },
        ].map((opt) => (
          <TouchableOpacity
            key={opt.type}
            style={[
              styles.typeOption,
              isDark && styles.typeOptionDark,
              type === opt.type && styles.typeOptionSelected,
              type === opt.type && isDark && styles.typeOptionSelectedDark,
            ]}
            onPress={() => setType(opt.type)}
            accessibilityLabel={`connection-type-${opt.type}`}
            testID={`connection-type-${opt.type}`}
          >
            <Ionicons
              name={opt.icon}
              size={20}
              color={type === opt.type ? (isDark ? "#0a0a0a" : "#ffffff") : isDark ? "#888888" : "#666666"}
            />
            <Text
              style={[
                styles.typeLabel,
                isDark && styles.textDark,
                type === opt.type && styles.typeLabelSelected,
                type === opt.type && isDark && styles.typeLabelSelectedDark,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Name */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.name")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={t("connection.shared.namePlaceholder")}
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={name}
        onChangeText={setName}
      />

      {/* URL */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.serverUrl")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={
          type === "local"
            ? "http://192.168.1.100:4096"
             : type === "zerotier"
               ? "http://10.10.0.8:4096"
               : type === "tailscale"
                 ? "http://100.64.12.34:4096"
              : type === "tunnel"
                ? "https://your-tunnel.trycloudflare.com"
                : "https://api.opencode.ai"
        }
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
       {type === "zerotier" ? (
        <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.zerotier.httpHint")}</Text>
       ) : type === "tailscale" ? (
         <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.tailscale.httpHint")}</Text>
       ) : (
        <>
          <Text style={[styles.hint, isDark && styles.hintDark]}>
            {t("connection.add.advanced.urlHintPrefix")}
            <Text style={styles.code}>http://100.64.12.34:4096</Text>
            {t("connection.add.advanced.urlHintOr")}
            <Text style={styles.code}>http://my-mac.tailnet.ts.net:4096</Text>
            {t("connection.add.advanced.urlHintUse")}
            <Text style={styles.code}>https://</Text>
            {t("connection.add.advanced.urlHintSuffix")}
          </Text>
        </>
      )}

       {type === "zerotier" && (
        <View style={[styles.zeroTierBox, isDark && styles.zeroTierBoxDark]}>
          <Text style={[styles.sectionTitle, styles.zeroTierTitle, isDark && styles.textDark]}>
            {t("connection.zerotier.title")}
          </Text>
          <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.zerotier.routeHint")}</Text>

          <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.zerotier.networkId")}</Text>
          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            placeholder="8056c2e21c000001"
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={zeroTierNetworkId}
            onChangeText={setZeroTierNetworkId}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.zerotier.planet")}</Text>
          <View style={styles.planetRow}>
            <TouchableOpacity
              style={[styles.planetButton, isDark && styles.typeOptionDark]}
              onPress={handleImportPlanet}
              disabled={isImportingPlanet}
            >
              {planetImportSource === "file" ? (
                <ActivityIndicator size="small" color={isDark ? "#ffffff" : "#0a0a0a"} />
              ) : (
                <Ionicons name="document-attach-outline" size={18} color={isDark ? "#ffffff" : "#0a0a0a"} />
       )}

              <Text style={[styles.planetButtonText, isDark && styles.textDark]}>
                {planet ? t("connection.zerotier.replacePlanet") : t("connection.zerotier.choosePlanet")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.planetButton, isDark && styles.typeOptionDark]}
              onPress={() => setShowPlanetBase64((current) => !current)}
              disabled={isImportingPlanet}
            >
              <Ionicons name="code-slash" size={18} color={isDark ? "#ffffff" : "#0a0a0a"} />
              <Text style={[styles.planetButtonText, isDark && styles.textDark]}>
                {t("connection.zerotier.importPlanetBase64")}
              </Text>
            </TouchableOpacity>
            {planet && (
              <TouchableOpacity
                onPress={() => {
                  setPlanet(undefined)
                  setPlanetBase64("")
                  setShowPlanetBase64(false)
                }}
                accessibilityLabel={t("connection.zerotier.useDefaultPlanet")}
              >
                <Ionicons name="close-circle" size={24} color={isDark ? "#aaaaaa" : "#666666"} />
              </TouchableOpacity>
            )}
          </View>
          {showPlanetBase64 && (
            <View style={styles.base64Box}>
              <TextInput
                style={[styles.input, styles.base64Input, isDark && styles.inputDark]}
                placeholder={t("connection.zerotier.planetBase64Placeholder")}
                placeholderTextColor={isDark ? "#666666" : "#999999"}
                value={planetBase64}
                onChangeText={setPlanetBase64}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.base64Confirm, isDark && styles.connectButtonDark, (!planetBase64.trim() || isImportingPlanet) && styles.disabledButton]}
                onPress={handleImportPlanetBase64}
                disabled={!planetBase64.trim() || isImportingPlanet}
              >
                {planetImportSource === "base64" ? (
                  <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
                ) : (
                  <Text style={[styles.base64ConfirmText, isDark && styles.connectButtonTextDark]}>
                    {t("connection.zerotier.decodePlanetBase64")}
                  </Text>
                )}
              </TouchableOpacity>
              <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.zerotier.planetBase64Hint")}</Text>
            </View>
          )}
          <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.zerotier.planetRenameHint")}</Text>
          <Text style={[styles.hint, isDark && styles.hintDark]}>
            {planet
              ? t("connection.zerotier.selectedPlanet", { name: planet.name, hash: planet.sha256.slice(0, 12) })
              : t("connection.zerotier.defaultPlanet")}
          </Text>
        </View>
      )}

       {type === "tailscale" && (
         <View style={[styles.zeroTierBox, isDark && styles.zeroTierBoxDark]}>
           <Text style={[styles.sectionTitle, styles.zeroTierTitle, isDark && styles.textDark]}>{t("connection.tailscale.title")}</Text>
           <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.tailscale.routeHint")}</Text>
           <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.tailscale.hostname")}</Text>
           <TextInput
             style={[styles.input, isDark && styles.inputDark]}
             placeholder="opencode-mobile"
             placeholderTextColor={isDark ? "#666666" : "#999999"}
             value={tailscaleHostname}
             onChangeText={setTailscaleHostname}
             autoCapitalize="none"
             autoCorrect={false}
           />
         </View>
       )}

       {/* Directory */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.directoryOptional")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="/path/to/project"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={directory}
        onChangeText={setDirectory}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.add.advanced.directoryHint")}</Text>

      {/* Auth */}
      <Text style={[styles.sectionTitle, isDark && styles.textDark]}>{t("connection.shared.authentication")}</Text>

      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.username")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="admin"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.password")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="password"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {/* Save */}
      <TouchableOpacity
        style={[styles.connectButton, isDark && styles.connectButtonDark, { marginTop: 32 }]}
        onPress={handleAdvancedSave}
        disabled={isConnecting}
        accessibilityLabel="save-connection"
        testID="save-connection"
      >
        {isConnecting ? (
          <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
        ) : (
          <Text style={[styles.connectButtonText, isDark && styles.connectButtonTextDark]}>
            {t("connection.add.advanced.saveButton")}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
    <Modal
      visible={Boolean(tailscaleLoginUrl)}
      animationType="slide"
      onRequestClose={closeTailscaleLogin}
    >
      <View style={[styles.webViewHeader, isDark && styles.webViewHeaderDark]}>
        <Text style={[styles.webViewTitle, isDark && styles.textDark]}>{t("connection.tailscale.loginTitle")}</Text>
        <TouchableOpacity onPress={closeTailscaleLogin} accessibilityLabel="close-tailscale-login">
          <Ionicons name="close" size={28} color={isDark ? "#ffffff" : "#0a0a0a"} />
        </TouchableOpacity>
      </View>
      {tailscaleLoginUrl ? (
        <WebView
          ref={tailscaleWebView}
          source={{ uri: tailscaleLoginUrl }}
          injectedJavaScript={`
            const reportAuthorization = () => {
              if (!/^https:\/\/([a-z0-9-]+\.)?tailscale\.com\/admin\/machines/.test(location.href)) return;
              window.ReactNativeWebView.postMessage("tailscale-authorized");
            };
            setInterval(reportAuthorization, 500);
            true;
          `}
          onMessage={({ nativeEvent }) => {
            if (nativeEvent.data === "tailscale-authorized") return
          }}
          onLoadEnd={({ nativeEvent }) => {
            if (nativeEvent.title.includes("Machines")) {
              return
            }
            tailscaleWebView.current?.injectJavaScript(`
              if (/^https:\/\/([a-z0-9-]+\.)?tailscale\.com\/admin\/machines/.test(location.href)) {
                window.ReactNativeWebView.postMessage("tailscale-authorized");
              }
              true;
            `)
          }}
          onNavigationStateChange={({ url }) => {
            // The login flow has several redirects before authorization. The
            // machines page is only reached after Tailscale accepts the node.
            if (!/^https:\/\/([a-z0-9-]+\.)?tailscale\.com\/admin\/machines/.test(url)) return
          }}
        />
      ) : null}
    </Modal>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  webViewHeader: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: 52,
  },
  webViewHeaderDark: {
    backgroundColor: "#0a0a0a",
  },
  webViewTitle: {
    color: "#0a0a0a",
    fontSize: 18,
    fontWeight: "600",
  },
  // Quick connect styles
  quickHeader: {
    alignItems: "center",
    paddingVertical: 24,
  },
  quickTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0a0a0a",
    marginTop: 16,
  },
  quickSubtitle: {
    fontSize: 15,
    color: "#666666",
    marginTop: 8,
    textAlign: "center",
  },
  ipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ipInput: {
    flex: 1,
  },
  ipColon: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  portInput: {
    width: 80,
  },
  connectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
    marginTop: 24,
  },
  connectButtonDark: {
    backgroundColor: "#ffffff",
  },
  connectButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
  },
  connectButtonTextDark: {
    color: "#0a0a0a",
  },
  helpBox: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  helpBoxDark: {
    backgroundColor: "#1a1a1a",
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
    marginBottom: 8,
  },
  helpText: {
    fontSize: 13,
    color: "#666666",
    lineHeight: 20,
  },
  code: {
    fontFamily: "monospace",
    backgroundColor: "#e5e5e5",
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  usernameHint: {
    fontSize: 12,
    color: "#666666",
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 18,
  },
  usernameHintLink: {
    color: "#6366f1",
    fontWeight: "600",
  },
  advancedLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 16,
    marginTop: 16,
  },
  advancedLinkText: {
    fontSize: 14,
    color: "#666666",
  },
  backToQuick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
  },
  backToQuickText: {
    fontSize: 14,
    color: "#666666",
  },
  // Original styles
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
    marginTop: 16,
    marginBottom: 8,
  },
  labelDark: {
    color: "#ffffff",
  },
  typeContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typeOption: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    gap: 6,
  },
  typeOptionDark: {
    backgroundColor: "#1a1a1a",
  },
  typeOptionSelected: {
    backgroundColor: "#0a0a0a",
  },
  typeOptionSelectedDark: {
    backgroundColor: "#ffffff",
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666666",
  },
  textDark: {
    color: "#ffffff",
  },
  typeLabelSelected: {
    color: "#ffffff",
  },
  typeLabelSelectedDark: {
    color: "#0a0a0a",
  },
  hint: {
    fontSize: 13,
    color: "#666666",
    marginTop: 8,
  },
  hintDark: {
    color: "#888888",
  },
  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#0a0a0a",
  },
  inputDark: {
    backgroundColor: "#1a1a1a",
    color: "#ffffff",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0a0a0a",
    marginTop: 32,
    marginBottom: 8,
  },
  zeroTierBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
  },
  zeroTierBoxDark: {
    backgroundColor: "#141414",
  },
  zeroTierTitle: {
    marginTop: 0,
    marginBottom: 0,
  },
  planetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planetButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  planetButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  base64Box: {
    marginTop: 10,
  },
  base64Input: {
    minHeight: 96,
    fontFamily: "monospace",
    fontSize: 12,
  },
  base64Confirm: {
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#0a0a0a",
    marginTop: 8,
  },
  base64ConfirmText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  disabledButton: {
    opacity: 0.5,
  },
})
