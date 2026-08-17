import { useState } from "react"
import { Ionicons } from "@expo/vector-icons"
import * as Clipboard from "expo-clipboard"
import { Stack, useRouter } from "expo-router"
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from "react-native"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WIDE_CONTENT_SCROLL_CONFIG } from "../src/lib/scroll-config"
import { getContentViewer } from "../src/lib/content-viewer"

export default function ContentViewerScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const isDark = useColorScheme() === "dark"
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const viewer = getContentViewer()

  if (!viewer) {
    return (
      <View style={[s.empty, isDark && s.emptyDark]}>
        <Text style={[s.emptyText, isDark && s.textDark]}>{t("chat.contentViewer.empty")}</Text>
      </View>
    )
  }

  const copy = async () => {
    await Clipboard.setStringAsync(viewer.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View style={[s.screen, isDark && s.screenDark]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[s.toolbar, isDark && s.toolbarDark, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.toolbarButton} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={isDark ? "#fff" : "#111"} />
          <Text style={[s.backText, isDark && s.textDark]}>{t("common.back")}</Text>
        </TouchableOpacity>
        <Text style={[s.title, isDark && s.textDark]} numberOfLines={1}>{viewer.title}</Text>
        <TouchableOpacity onPress={copy} style={s.toolbarButton} hitSlop={8}>
          <Ionicons name="copy-outline" size={20} color={isDark ? "#c4b5fd" : "#6d28d9"} />
          <Text style={[s.copyText, isDark && s.copyTextDark]}>{copied ? t("common.copied") : t("common.copy")}</Text>
        </TouchableOpacity>
      </View>
      <View style={[s.content, isDark && s.contentDark]}>
        <Text style={[s.language, isDark && s.languageDark]}>{viewer.language || t("chat.contentViewer.output")}</Text>
        <ScrollView {...WIDE_CONTENT_SCROLL_CONFIG} style={s.horizontal} contentContainerStyle={s.scrollContent}>
          <ScrollView nestedScrollEnabled contentContainerStyle={s.verticalContent}>
            <Text selectable style={[s.code, isDark && s.codeDark]}>{viewer.content}</Text>
          </ScrollView>
        </ScrollView>
      </View>
    </View>
  )
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f5f5f5" },
  screenDark: { backgroundColor: "#0a0a0a" },
  toolbar: { minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ddd" },
  toolbarDark: { backgroundColor: "#151515", borderBottomColor: "#333" },
  toolbarButton: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 72 },
  backText: { fontSize: 13, color: "#111" },
  title: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "700", color: "#111" },
  copyText: { fontSize: 12, color: "#6d28d9" },
  copyTextDark: { color: "#c4b5fd" },
  content: { flex: 1, margin: 10, borderRadius: 8, overflow: "hidden", backgroundColor: "#fff" },
  contentDark: { backgroundColor: "#1a1a1a" },
  language: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 11, fontWeight: "700", color: "#666", textTransform: "uppercase", backgroundColor: "#e8e8e8" },
  languageDark: { color: "#aaa", backgroundColor: "#2a2a2a" },
  horizontal: { flex: 1 },
  scrollContent: { minWidth: "100%", flexGrow: 1 },
  verticalContent: { padding: 14 },
  code: { fontFamily: mono, fontSize: 13, lineHeight: 20, color: "#171717" },
  codeDark: { color: "#e5e5e5" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  emptyDark: { backgroundColor: "#0a0a0a" },
  emptyText: { color: "#111" },
  textDark: { color: "#fff" },
})
