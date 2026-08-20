import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { DiffLineRow, type SharedDiffLine } from "../src/components/files/DiffRenderer"
import { parseUnifiedPatch } from "../src/lib/file-review"
import { useConnections } from "../src/stores/connections"
import { useSessions } from "../src/stores/sessions"
import { cacheDiffs, getCachedDiffs } from "../src/lib/session-file-cache"

interface DisplayLine extends SharedDiffLine {
  number: number
}

function selectionLine(line: DisplayLine, mode: string): number | undefined {
  if (mode !== "diff") return line.number
  return line.newLine ?? line.oldLine
}

export default function SessionFileScreen() {
  const { id, directory, path, mode = "file", source = "git" } = useLocalSearchParams<{ id: string; directory: string; path: string; mode?: "file" | "diff"; source?: "git" | "turn" | "branch" | "all" }>()
  const router = useRouter()
  const { t } = useTranslation()
  const isDark = useColorScheme() === "dark"
  const { client, clientForDirectory } = useConnections()
  const api = useMemo(() => clientForDirectory(directory) ?? client, [clientForDirectory, directory, client])
  const [lines, setLines] = useState<DisplayLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [comment, setComment] = useState("")

  useEffect(() => {
    if (!api || !path) return
    let active = true
    setLoading(true)
    setError(null)
    const request = async () => {
      if (mode === "diff") {
        const diffSource: "git" | "branch" = source === "branch" ? "branch" : "git"
        let diffs = source === "turn" ? getCachedDiffs(directory, id, "turn") : getCachedDiffs(directory, id, diffSource)
        if (source === "turn") {
          if (!diffs) {
            const messages = await api.session.messages(id, { limit: 50 })
            const user = [...messages].reverse().find((item) => item.info.role === "user" && item.info.summary?.diffs)
            diffs = user?.info.summary?.diffs || []
            cacheDiffs(directory, id, "turn", diffs)
          }
        } else if (!diffs) {
          diffs = await api.vcs.diff({ mode: diffSource, context: 10 })
          cacheDiffs(directory, id, diffSource, diffs)
        }
        diffs = diffs || []
        const diff = diffs.find((item) => item.file === path)
        if (!diff?.patch) throw new Error(t("files.diffUnavailable"))
        return parseUnifiedPatch(diff.patch).map((line, index) => ({ ...line, number: index + 1 }))
      }
      const content = await api.file.read(path)
      if (content.type !== "text") throw new Error(t("files.binaryUnsupported"))
      return content.content.split(/\r?\n/).slice(0, 5000).map((text, index) => ({ key: `f-${index + 1}`, type: "context" as const, text, number: index + 1, oldLine: index + 1, newLine: index + 1 }))
    }
    request().then((result) => { if (active) setLines(result) }).catch((err) => { if (active) setError(err instanceof Error ? err.message : t("files.loadFailed")) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, id, path, mode, source, t])

  const start = anchor === null || focus === null ? null : Math.min(anchor, focus)
  const end = anchor === null || focus === null ? null : Math.max(anchor, focus)
  const selected = start === null || end === null ? [] : lines.filter((line) => {
    const number = selectionLine(line, mode)
    return number !== undefined && number >= start && number <= end
  })

  const select = (line: DisplayLine) => {
    const number = selectionLine(line, mode)
    if (number === undefined || line.type === "header") return
    if (anchor === null || focus === null) { setAnchor(number); setFocus(number); return }
    setFocus(number)
  }

  const addComment = () => {
    if (!id || !path || start === null || end === null || !comment.trim()) return
    useSessions.getState().addFileContext(id, {
      path,
      text: `@${path}`,
      start: 0,
      end: path.length + 1,
      selection: { startLine: start, startChar: 0, endLine: end, endChar: 0 },
      comment: comment.trim(),
      preview: selected.slice(0, 2).map((line) => line.text).join("\n"),
      origin: mode === "diff" ? "review" : "file",
    })
    Alert.alert(t("files.commentAddedTitle"), t("files.commentAddedMessage"), [{ text: t("common.ok"), onPress: () => router.back() }])
  }

  return (
    <KeyboardAvoidingView style={[s.container, isDark && s.containerDark]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: path?.split("/").pop() || t("files.fileTitle") }} />
      <View style={[s.pathBar, isDark && s.pathBarDark]}><Text style={[s.path, isDark && s.textDark]} numberOfLines={1}>{path}</Text><View style={s.mode}><Text style={s.modeText}>{mode === "diff" ? "DIFF" : "FILE"}</Text></View></View>
      {loading ? <View style={s.center}><ActivityIndicator size="large" color="#8b5cf6" /></View> : error ? <View style={s.center}><Ionicons name="alert-circle-outline" size={40} color="#ef4444" /><Text style={s.error}>{error}</Text></View> : (
        <FlatList
          data={lines}
          keyExtractor={(item) => item.key}
          extraData={`${start}-${end}`}
          renderItem={({ item }) => {
            const number = selectionLine(item, mode)
            const isSelected = number !== undefined && start !== null && end !== null && number >= start && number <= end
             return <DiffLineRow line={item} isDark={isDark} showLineNumbers selected={isSelected} onPress={() => select(item)} />
          }}
          contentContainerStyle={s.codeList}
          horizontal={false}
          initialNumToRender={60}
          windowSize={8}
        />
      )}
      {start !== null && end !== null && (
        <View style={[s.commentBox, isDark && s.commentBoxDark]}>
          <View style={s.selectionHead}><Text style={[s.selectionText, isDark && s.textDark]}>{t("files.selectedLines", { start, end })}</Text><TouchableOpacity onPress={() => { setAnchor(null); setFocus(null); setComment("") }}><Text style={s.clear}>{t("common.cancel")}</Text></TouchableOpacity></View>
          <TextInput style={[s.commentInput, isDark && s.commentInputDark]} value={comment} onChangeText={setComment} placeholder={t("files.commentPlaceholder")} placeholderTextColor="#777777" multiline maxLength={2000} />
          <TouchableOpacity style={[s.addComment, !comment.trim() && s.disabled]} disabled={!comment.trim()} onPress={addComment}><Ionicons name="chatbox-ellipses" size={17} color="#ffffff" /><Text style={s.addCommentText}>{t("files.addComment")}</Text></TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" }, containerDark: { backgroundColor: "#0a0a0a" }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }, error: { color: "#ef4444", textAlign: "center" },
  pathBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#f2f2ef", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#dddddd" }, pathBarDark: { backgroundColor: "#151515", borderBottomColor: "#292929" }, path: { flex: 1, fontFamily: "monospace", fontSize: 12, color: "#333333" }, textDark: { color: "#eeeeee" }, mode: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: "#8b5cf6" }, modeText: { color: "#ffffff", fontSize: 9, fontWeight: "800" },
  codeList: { paddingVertical: 6 },
  commentBox: { padding: 12, gap: 9, borderTopWidth: 1, borderTopColor: "#dddddd", backgroundColor: "#ffffff" }, commentBoxDark: { borderTopColor: "#292929", backgroundColor: "#111111" }, selectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, selectionText: { color: "#222222", fontSize: 12, fontWeight: "700" }, clear: { color: "#8b5cf6", fontSize: 12 }, commentInput: { minHeight: 58, maxHeight: 110, borderRadius: 10, padding: 10, backgroundColor: "#f3f3f0", color: "#111111", textAlignVertical: "top" }, commentInputDark: { backgroundColor: "#242424", color: "#ffffff" }, addComment: { height: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 10, backgroundColor: "#8b5cf6" }, disabled: { opacity: 0.45 }, addCommentText: { color: "#ffffff", fontWeight: "700", fontSize: 14 },
})
