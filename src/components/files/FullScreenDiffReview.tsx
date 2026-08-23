import { useEffect, useState, type ReactNode } from "react"
import { Ionicons } from "@expo/vector-icons"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useTranslation } from "react-i18next"
import { diffHunkIndexAtLine, diffHunkStarts } from "../../lib/file-review"
import type { SharedDiffLine } from "./DiffRenderer"

interface Props {
  title: string
  lines: SharedDiffLine[]
  isDark: boolean
  children: ReactNode
  footer?: ReactNode
  topInset?: number
  onBack: () => void
  onCopy?: () => void
  copied?: boolean
  onNavigateHunk?: (lineIndex: number) => void
  visibleLineIndex?: number | null
  headerLabel?: string
}

export function FullScreenDiffReview({ title, lines, isDark, children, footer, topInset = 0, onBack, onCopy, copied, onNavigateHunk, visibleLineIndex, headerLabel }: Props) {
  const { t } = useTranslation()
  const [hunkIndex, setHunkIndex] = useState(0)
  const hunks = diffHunkStarts(lines)
  const visibleHunkIndex = visibleLineIndex == null ? undefined : diffHunkIndexAtLine(hunks, visibleLineIndex)
  const currentHunkIndex = visibleHunkIndex ?? hunkIndex

  const lineSignature = `${lines.length}:${lines[0]?.key ?? ""}:${lines[lines.length - 1]?.key ?? ""}`
  useEffect(() => setHunkIndex(0), [title, lineSignature])

  const navigate = (offset: number) => {
    const next = Math.max(0, Math.min(hunks.length - 1, currentHunkIndex + offset))
    if (next === currentHunkIndex || hunks[next] === undefined) return
    setHunkIndex(next)
    onNavigateHunk?.(hunks[next])
  }

  return (
    <View style={[s.screen, isDark && s.screenDark]}>
      <View style={[s.toolbar, isDark && s.toolbarDark, { paddingTop: topInset }]}>
        <TouchableOpacity onPress={onBack} style={s.toolbarButton} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={isDark ? "#fff" : "#111"} />
          <Text style={[s.backText, isDark && s.textDark]}>{t("common.back")}</Text>
        </TouchableOpacity>
        <Text style={[s.title, isDark && s.textDark]} numberOfLines={1}>{title}</Text>
        {hunks.length > 0 && <View style={s.navigation}>
          <TouchableOpacity disabled={currentHunkIndex <= 0} onPress={() => navigate(-1)} hitSlop={8}>
            <Ionicons name="chevron-up" size={20} color={currentHunkIndex <= 0 ? "#999999" : isDark ? "#c4b5fd" : "#6d28d9"} />
          </TouchableOpacity>
          <Text style={[s.position, isDark && s.positionDark]}>{currentHunkIndex + 1}/{hunks.length}</Text>
          <TouchableOpacity disabled={currentHunkIndex >= hunks.length - 1} onPress={() => navigate(1)} hitSlop={8}>
            <Ionicons name="chevron-down" size={20} color={currentHunkIndex >= hunks.length - 1 ? "#999999" : isDark ? "#c4b5fd" : "#6d28d9"} />
          </TouchableOpacity>
        </View>}
        {onCopy && <TouchableOpacity onPress={onCopy} style={s.toolbarButton} hitSlop={8}>
          <Ionicons name="copy-outline" size={20} color={isDark ? "#c4b5fd" : "#6d28d9"} />
          <Text style={[s.copyText, isDark && s.copyTextDark]}>{copied ? t("common.copied") : t("common.copy")}</Text>
        </TouchableOpacity>}
      </View>
      {headerLabel && <Text style={[s.language, isDark && s.languageDark]}>{headerLabel}</Text>}
      <View style={[s.content, isDark && s.contentDark]}>{children}</View>
      {footer}
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f5f5f5" }, screenDark: { backgroundColor: "#0a0a0a" },
  toolbar: { minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ddd" }, toolbarDark: { backgroundColor: "#151515", borderBottomColor: "#333" },
  toolbarButton: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 72 }, backText: { fontSize: 13, color: "#111" }, title: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "700", color: "#111" },
  navigation: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 72, justifyContent: "flex-end" }, position: { minWidth: 28, textAlign: "center", fontSize: 11, color: "#666" }, positionDark: { color: "#aaa" },
  copyText: { fontSize: 12, color: "#6d28d9" }, copyTextDark: { color: "#c4b5fd" }, language: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 11, fontWeight: "700", color: "#666", textTransform: "uppercase", backgroundColor: "#e8e8e8" }, languageDark: { color: "#aaa", backgroundColor: "#2a2a2a" },
  content: { flex: 1, margin: 10, alignSelf: "stretch", borderRadius: 8, overflow: "hidden", backgroundColor: "#fff" }, contentDark: { backgroundColor: "#1a1a1a" }, textDark: { color: "#fff" },
})
