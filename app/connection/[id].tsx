import { useEffect, useState } from "react"
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
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useConnections } from "../../src/stores/connections"
import { useEvents } from "../../src/stores/events"
import type { ConnectionType, ZeroTierPlanet } from "../../src/lib/types"
import { embeddedZeroTier } from "@opencode-ai/zerotier"
import { parseZeroTierTarget } from "../../src/lib/zerotier-routing"
import { probeConnection, shareReport } from "../../src/lib/diagnostics"
import { captureDiagnostic } from "../../src/lib/sentry"
import { parseUrl } from "../../src/lib/diagnostics-classify"
import { buildAuth } from "../../src/lib/auth"

// labelKey (not literal text): this is a module-level constant evaluated
// before i18next is guaranteed ready, so the label is resolved with t() at
// render time — same pattern as categoryMeta in src/lib/notifications.ts.
const CONNECTION_TYPES: Array<{
  type: ConnectionType
  labelKey: string
  icon: keyof typeof Ionicons.glyphMap
}> = [
  { type: "local", labelKey: "connection.shared.types.local", icon: "wifi" },
  { type: "tunnel", labelKey: "connection.shared.types.tunnel", icon: "globe" },
  { type: "cloud", labelKey: "connection.shared.types.cloud", icon: "cloud" },
  { type: "zerotier", labelKey: "connection.shared.types.zerotier", icon: "git-network" },
]

export default function EditConnectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { connections, updateConnection, removeConnection, testConnection } = useConnections()

  const connection = connections.find((c) => c.id === id)

  const [type, setType] = useState<ConnectionType>(connection?.type || "local")
  const [name, setName] = useState(connection?.name || "")
  const [url, setUrl] = useState(connection?.url || "")
  const [directory, setDirectory] = useState(connection?.directory || "")
  const [username, setUsername] = useState(connection?.username || "")
  const [password, setPassword] = useState("")
  const [zeroTierNetworkId, setZeroTierNetworkId] = useState(connection?.zerotier?.networkId || "")
  const [planet, setPlanet] = useState<ZeroTierPlanet | undefined>(connection?.zerotier?.planet)
  const [planetBase64, setPlanetBase64] = useState(connection?.zerotier?.planet?.base64 || "")
  const [showPlanetBase64, setShowPlanetBase64] = useState(Boolean(connection?.zerotier?.planet?.base64))
  const [planetImportSource, setPlanetImportSource] = useState<"file" | "base64" | null>(null)
  const isImportingPlanet = planetImportSource !== null
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (connection) {
      setType(connection.type)
      setName(connection.name)
      setUrl(connection.url)
      setDirectory(connection.directory || "")
      setUsername(connection.username || "")
      setZeroTierNetworkId(connection.zerotier?.networkId || "")
      setPlanet(connection.zerotier?.planet)
      const savedBase64 = connection.zerotier?.planet?.base64 || ""
      setPlanetBase64(savedBase64)
      setShowPlanetBase64(Boolean(savedBase64))
    }
  }, [connection])

  if (!connection) {
    return (
      <View style={[styles.container, isDark && styles.containerDark, styles.center]}>
        <Text style={[styles.errorText, isDark && styles.textDark]}>{t("connection.edit.notFound")}</Text>
      </View>
    )
  }

  const handleTest = async () => {
    const connectionUrl = url.trim()
    if (!connectionUrl) {
      Alert.alert(t("common.error"), t("connection.shared.alerts.enterUrl"))
      return
    }
    if (type !== "zerotier" && !parseUrl(connectionUrl).valid) {
      Alert.alert(t("connection.shared.alerts.invalidUrlTitle"), t("connection.shared.alerts.invalidUrlMessage"))
      return
    }
    const zerotier = type === "zerotier"
      ? { networkId: zeroTierNetworkId.trim(), planet }
      : undefined
    if (zerotier) {
      try {
        parseZeroTierTarget({ networkId: zerotier.networkId, url: connectionUrl })
      } catch (error) {
        Alert.alert(t("connection.zerotier.invalidTitle"), error instanceof Error ? error.message : String(error))
        return
      }
    }

    setIsTesting(true)
    const result = await testConnection(
      {
        id: connection.id,
        name: name || "Test",
        type,
        url: connectionUrl,
        directory: directory.trim() || undefined,
        username: username.trim() || undefined,
        zerotier,
      },
      "edit_test",
      password || undefined,
    )

    if (result.ok) {
      setIsTesting(false)
      Alert.alert(t("connection.edit.alerts.successTitle"), t("connection.edit.alerts.successMessage"))
      return
    }

    if (type === "zerotier") {
      setIsTesting(false)
      Alert.alert(
        t("connection.shared.alerts.connectionFailedTitle"),
        result.error || t("connection.shared.alerts.unknownError"),
      )
      return
    }

    // Failed: run active diagnostics, capture to Sentry, offer a shareable report.
    const report = await probeConnection(url.trim(), buildAuth(username, password))
    captureDiagnostic(report)
    setIsTesting(false)

    Alert.alert(
      t("connection.shared.alerts.connectionFailedTitle"),
      t("connection.edit.alerts.connectionFailedMessage", {
        summary: report.summary,
        detail: result.error || t("connection.edit.alerts.noDetail"),
      }),
      [
        { text: t("common.ok"), style: "cancel" },
        { text: t("common.shareReport"), onPress: () => shareReport(report) },
      ],
    )
  }

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert(t("common.error"), t("connection.shared.alerts.enterName"))
      return
    }
    const connectionUrl = url.trim()
    if (!connectionUrl) {
      Alert.alert(t("common.error"), t("connection.shared.alerts.enterUrl"))
      return
    }
    if (type !== "zerotier" && !parseUrl(connectionUrl).valid) {
      Alert.alert(t("connection.shared.alerts.invalidUrlTitle"), t("connection.shared.alerts.invalidUrlMessage"))
      return
    }
    const zerotier = type === "zerotier"
      ? { networkId: zeroTierNetworkId.trim(), planet }
      : undefined
    if (zerotier) {
      try {
        parseZeroTierTarget({ networkId: zerotier.networkId, url: connectionUrl })
      } catch (error) {
        Alert.alert(t("connection.zerotier.invalidTitle"), error instanceof Error ? error.message : String(error))
        return
      }
    }

    setIsSaving(true)
    try {
      await updateConnection(
        connection.id,
        {
          name: name.trim(),
          type,
          url: connectionUrl,
          directory: directory.trim() || undefined,
          username: username.trim() || undefined,
          zerotier,
        },
        // Empty = keep existing password (the field loads blank); a typed value
        // rotates it in SecureStore.
        password || undefined,
      )
      // If this was the active connection, the SSE loop may have stopped
      // retrying after a prior 401 (see events.ts) — reconnect now with the
      // freshly saved credentials instead of leaving the user stuck until
      // they relaunch the app.
      if (useConnections.getState().activeConnection?.id === connection.id) {
        useEvents.getState().connect()
      }
      setIsSaving(false)
      router.back()
    } catch {
      setIsSaving(false)
      Alert.alert(
        t("connection.shared.alerts.saveFailedTitle"),
        t("connection.shared.alerts.saveFailedMessage"),
      )
    }
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

  const handleDelete = () => {
    Alert.alert(t("connection.edit.alerts.deleteTitle"), t("connection.edit.alerts.deleteMessage", { name: connection.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          await removeConnection(connection.id)
          router.back()
        },
      },
    ])
  }

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
      {/* Connection Type */}
      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.shared.connectionType")}</Text>
      <View style={styles.typeContainer}>
        {CONNECTION_TYPES.map((opt) => (
          <TouchableOpacity
            key={opt.type}
            style={[
              styles.typeOption,
              isDark && styles.typeOptionDark,
              type === opt.type && styles.typeOptionSelected,
              type === opt.type && isDark && styles.typeOptionSelectedDark,
            ]}
            onPress={() => setType(opt.type)}
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
              {t(opt.labelKey)}
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
        placeholder={type === "zerotier" ? "http://10.10.0.8:4096" : "http://192.168.1.100:4096"}
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {type === "zerotier" && (
        <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.zerotier.httpHint")}</Text>
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
                style={[styles.base64Confirm, isDark && styles.saveButtonDark, (!planetBase64.trim() || isImportingPlanet) && styles.disabledButton]}
                onPress={handleImportPlanetBase64}
                disabled={!planetBase64.trim() || isImportingPlanet}
              >
                {planetImportSource === "base64" ? (
                  <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
                ) : (
                  <Text style={[styles.base64ConfirmText, isDark && styles.saveButtonTextDark]}>
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
      <Text style={[styles.hint, isDark && styles.hintDark]}>{t("connection.edit.directoryHint")}</Text>

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

      <Text style={[styles.label, isDark && styles.labelDark]}>{t("connection.edit.passwordLabel")}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder="••••••••"
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.testButton, isDark && styles.testButtonDark]}
          onPress={handleTest}
          disabled={isTesting}
        >
          {isTesting ? (
            <ActivityIndicator size="small" color={isDark ? "#ffffff" : "#0a0a0a"} />
          ) : (
            <>
              <Ionicons name="pulse" size={20} color={isDark ? "#ffffff" : "#0a0a0a"} />
              <Text style={[styles.testButtonText, isDark && styles.textDark]}>{t("connection.edit.testButton")}</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, isDark && styles.saveButtonDark]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
          ) : (
            <Text style={[styles.saveButtonText, isDark && styles.saveButtonTextDark]}>
              {t("connection.edit.saveButton")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
          <Text style={styles.deleteButtonText}>{t("connection.edit.deleteButton")}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  errorText: {
    fontSize: 16,
    color: "#666666",
  },
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
  hint: {
    fontSize: 13,
    color: "#666666",
    marginTop: 6,
  },
  hintDark: {
    color: "#888888",
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0a0a0a",
    marginTop: 32,
    marginBottom: 8,
  },
  actions: {
    marginTop: 32,
    gap: 12,
  },
  testButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  testButtonDark: {
    borderColor: "#333333",
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0a0a0a",
  },
  saveButton: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
  },
  saveButtonDark: {
    backgroundColor: "#ffffff",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  saveButtonTextDark: {
    color: "#0a0a0a",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fef2f2",
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ef4444",
  },
})
