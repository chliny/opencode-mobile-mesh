import { useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View, type ViewToken } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { DiffLineRow, type SharedDiffLine } from "../src/components/files/DiffRenderer"
import { FullScreenDiffReview } from "../src/components/files/FullScreenDiffReview"
import { diffHunkStarts, parseUnifiedPatch } from "../src/lib/file-review"
import { turnDiffsFromMessages, turnSummaryRecorded } from "../src/lib/review-diffs"
import { useConnections } from "../src/stores/connections"
import { useSessions } from "../src/stores/sessions"
import { cacheDiffs, cacheVcsDiffs, getCachedDiffs, getCachedVcsDiffs } from "../src/lib/session-file-cache"

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
  const [visibleLine, setVisibleLine] = useState<number | null>(null)
  const listRef = useRef<FlatList<DisplayLine>>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retriedIndices = useRef(new Set<number>())
  const targetLineRef = useRef<number | null>(null)
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const target = targetLineRef.current
    if (target !== null) {
      if (!viewableItems.some((item) => item.index === target)) return
      targetLineRef.current = null
      setVisibleLine(target)
      return
    }
    const index = viewableItems.reduce<number | null>((current, item) => {
      if (item.index == null) return current
      return current == null ? item.index : Math.min(current, item.index)
    }, null)
    if (index != null) setVisibleLine(index)
  }).current
  const onScrollToIndexFailed = useRef(({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    if (retriedIndices.current.has(index)) return
    retriedIndices.current.add(index)
    listRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false })
    retryRef.current = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.08 })
    }, 50)
  }).current

  const scrollToLine = (index: number, animated: boolean) => {
    retriedIndices.current.delete(index)
    targetLineRef.current = index
    setVisibleLine(index)
    listRef.current?.scrollToIndex({ index, animated, viewPosition: 0.08 })
  }

  useEffect(() => {
    if (!api || !path) return
    let active = true
    setVisibleLine(null)
    setLoading(true)
    setError(null)
    const request = async () => {
      if (mode === "diff") {
        const diffSource: "git" | "branch" = source === "branch" ? "branch" : "git"
        let diffs = source === "turn" ? getCachedDiffs(directory, id, "turn") : getCachedDiffs(directory, id, diffSource)
        if (source === "turn") {
          // /session/:id/diff returns [] without a messageID — derive from the
          // live transcript's last user message (upstream's source of truth).
          const local = useSessions.getState()
          diffs = local.currentSession?.id === id ? turnDiffsFromMessages(local.messages, local.currentSession.revert?.messageID) : undefined
          if (!diffs) diffs = getCachedDiffs(directory, id, "turn")
          if (!diffs) {
            const transcript = await api.session.messages(id)
            const infos = (transcript || []).map((item) => item.info)
            diffs = turnDiffsFromMessages(infos) ?? []
            if (diffs.length > 0 || turnSummaryRecorded(infos)) cacheDiffs(directory, id, "turn", diffs)
          }
        } else if (!diffs) {
          diffs = getCachedVcsDiffs(directory, diffSource)
          if (!diffs) {
            diffs = await api.vcs.diff({ mode: diffSource, context: 10 })
            cacheVcsDiffs(directory, diffSource, diffs)
          }
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

  useEffect(() => {
    if (mode !== "diff" || lines.length === 0) return
    const first = diffHunkStarts(lines)[0]
    if (first === undefined) return
    const frame = requestAnimationFrame(() => {
      scrollToLine(first, false)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [lines, mode])

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
    setAnchor(null)
    setFocus(null)
    setComment("")
    Alert.alert(t("files.commentAddedTitle"), t("files.commentAddedMessage"))
  }

  return (
    <KeyboardAvoidingView style={[s.container, isDark && s.containerDark]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: path?.split("/").pop() || t("files.fileTitle") }} />
      <FullScreenDiffReview title={path || t("files.fileTitle")} lines={mode === "diff" ? lines : []} isDark={isDark} visibleLineIndex={mode === "diff" ? visibleLine : null} onBack={() => router.back()} onNavigateHunk={(index) => scrollToLine(index, true)} headerLabel={mode === "diff" ? "DIFF" : "FILE"} footer={start !== null && end !== null ? (
        <View style={[s.commentBox, isDark && s.commentBoxDark]}>
          <View style={s.selectionHead}><Text style={[s.selectionText, isDark && s.textDark]}>{t("files.selectedLines", { start, end })}</Text><TouchableOpacity onPress={() => { setAnchor(null); setFocus(null); setComment("") }}><Text style={s.clear}>{t("common.cancel")}</Text></TouchableOpacity></View>
          <TextInput style={[s.commentInput, isDark && s.commentInputDark]} value={comment} onChangeText={setComment} placeholder={t("files.commentPlaceholder")} placeholderTextColor="#777777" multiline maxLength={2000} />
          <TouchableOpacity style={[s.addComment, !comment.trim() && s.disabled]} disabled={!comment.trim()} onPress={addComment}><Ionicons name="chatbox-ellipses" size={17} color="#ffffff" /><Text style={s.addCommentText}>{t("files.addComment")}</Text></TouchableOpacity>
        </View>
      ) : undefined}>
        {loading ? <View style={s.center}><ActivityIndicator size="large" color="#8b5cf6" /></View> : error ? <View style={s.center}><Ionicons name="alert-circle-outline" size={40} color="#ef4444" /><Text style={s.error}>{error}</Text></View> : (
          <FlatList
            ref={listRef}
            style={s.codeList}
            data={lines}
            keyExtractor={(item) => item.key}
            extraData={`${start}-${end}`}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onScrollToIndexFailed={onScrollToIndexFailed}
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
      </FullScreenDiffReview>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" }, containerDark: { backgroundColor: "#0a0a0a" }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }, error: { color: "#ef4444", textAlign: "center" },
  pathBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#f2f2ef", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#dddddd" }, pathBarDark: { backgroundColor: "#151515", borderBottomColor: "#292929" }, path: { flex: 1, fontFamily: "monospace", fontSize: 12, color: "#333333" }, textDark: { color: "#eeeeee" }, mode: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: "#8b5cf6" }, modeText: { color: "#ffffff", fontSize: 9, fontWeight: "800" },
  navigation: { flexDirection: "row", alignItems: "center", gap: 5 }, position: { fontSize: 11, color: "#666666" },
  codeList: { width: "100%", flex: 1, paddingVertical: 6 },
  commentBox: { padding: 12, gap: 9, borderTopWidth: 1, borderTopColor: "#dddddd", backgroundColor: "#ffffff" }, commentBoxDark: { borderTopColor: "#292929", backgroundColor: "#111111" }, selectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, selectionText: { color: "#222222", fontSize: 12, fontWeight: "700" }, clear: { color: "#8b5cf6", fontSize: 12 }, commentInput: { minHeight: 58, maxHeight: 110, borderRadius: 10, padding: 10, backgroundColor: "#f3f3f0", color: "#111111", textAlignVertical: "top" }, commentInputDark: { backgroundColor: "#242424", color: "#ffffff" }, addComment: { height: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 10, backgroundColor: "#8b5cf6" }, disabled: { opacity: 0.45 }, addCommentText: { color: "#ffffff", fontWeight: "700", fontSize: 14 },
})
