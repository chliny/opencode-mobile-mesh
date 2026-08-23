import { useRef, useState } from "react"
import * as Clipboard from "expo-clipboard"
import { Stack, useRouter } from "expo-router"
import { Platform, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WideScroll } from "../src/components/WideScroll"
import { getContentViewer } from "../src/lib/content-viewer"
import { parseDiffText } from "../src/components/chat/diff-compute"
import { DiffRenderer, type SharedDiffLine } from "../src/components/files/DiffRenderer"
import { FullScreenDiffReview } from "../src/components/files/FullScreenDiffReview"

export default function ContentViewerScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const isDark = useColorScheme() === "dark"
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const viewer = getContentViewer()
  const scrollRef = useRef<ScrollView>(null)

  if (!viewer) {
    return <View style={[s.empty, isDark && s.emptyDark]}><Text style={[s.emptyText, isDark && s.textDark]}>{t("chat.contentViewer.empty")}</Text></View>
  }

  const isDiff = viewer.language === "diff"
  const diffLines: SharedDiffLine[] = isDiff ? parseDiffText(viewer.content).map((line, index) => ({ ...line, key: `${line.type}-${index}` })) : []
  const copy = async () => {
    await Clipboard.setStringAsync(viewer.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <FullScreenDiffReview title={viewer.title} lines={diffLines} isDark={isDark} topInset={insets.top + 8} onBack={() => router.back()} onCopy={copy} copied={copied} onNavigateHunk={(index) => scrollRef.current?.scrollTo({ y: index * 22, animated: true })} headerLabel={viewer.language || t("chat.contentViewer.output")}>
        {isDiff ? <ScrollView ref={scrollRef} nestedScrollEnabled contentContainerStyle={s.verticalContent}>
          <DiffRenderer lines={diffLines} isDark={isDark} wrap />
        </ScrollView> : <WideScroll style={s.horizontal} contentContainerStyle={s.scrollContent}>
          <ScrollView ref={scrollRef} nestedScrollEnabled contentContainerStyle={s.verticalContent}>
            <Text selectable style={[s.code, isDark && s.codeDark]}>{viewer.content}</Text>
          </ScrollView>
        </WideScroll>}
      </FullScreenDiffReview>
    </>
  )
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"
const s = StyleSheet.create({
  horizontal: { flex: 1 }, scrollContent: { minWidth: "100%", flexGrow: 1 }, verticalContent: { padding: 14 },
  code: { fontFamily: mono, fontSize: 13, lineHeight: 20, color: "#171717" }, codeDark: { color: "#e5e5e5" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }, emptyDark: { backgroundColor: "#0a0a0a" }, emptyText: { color: "#111" }, textDark: { color: "#fff" },
})
