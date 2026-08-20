import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { FileDiff, FileEntry } from "../src/lib/sdk"
import { groupDiffs } from "../src/lib/file-review"
import { cacheDiffs, clearCachedDiffs, getCachedDiffs } from "../src/lib/session-file-cache"
import { cacheFileEntries, clearCachedFileEntries, getCachedFileEntries } from "../src/lib/file-tree-cache"
import { useConnections } from "../src/stores/connections"

type Mode = "git" | "turn" | "branch" | "all"
type DiffItem =
  | { type: "section"; key: string; status: "added" | "modified" | "deleted"; count: number }
  | { type: "file"; key: string; diff: FileDiff }

function parent(path: string): string {
  const parts = path.split("/").filter(Boolean)
  parts.pop()
  return parts.join("/") || "."
}

export default function SessionFilesScreen() {
  const { id, directory } = useLocalSearchParams<{ id: string; directory: string }>()
  const router = useRouter()
  const { t } = useTranslation()
  const isDark = useColorScheme() === "dark"
  const { client, clientForDirectory } = useConnections()
  const api = useMemo(() => clientForDirectory(directory) ?? client, [clientForDirectory, directory, client])
  const [mode, setMode] = useState<Mode>("git")
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [path, setPath] = useState(".")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestID = useRef(0)

  const load = useCallback(async () => {
    if (!api || !id) return
    const currentRequest = ++requestID.current
    setLoading(true)
    setError(null)
    try {
      if (mode === "all") {
        const cached = getCachedFileEntries(directory, path)
        if (cached) setEntries(cached)
        const value = await api.file.list({ path })
        if (currentRequest !== requestID.current) return
        cacheFileEntries(directory, path, value)
        setEntries(value)
        return
      }
      const cached = getCachedDiffs(directory, id, mode)
      if (cached) {
        if (currentRequest !== requestID.current) return
        setDiffs(cached)
        return
      }
      if (mode === "git" || mode === "branch") {
        const value = await api.vcs.diff({ mode, context: 10 })
        if (currentRequest !== requestID.current) return
        cacheDiffs(directory, id, mode, value)
        setDiffs(value)
        return
      }
      const messages = await api.session.messages(id, { limit: 50 })
      if (currentRequest !== requestID.current) return
      const user = [...messages].reverse().find((item) => item.info.role === "user" && item.info.summary?.diffs)
      const value = user?.info.summary?.diffs || []
      cacheDiffs(directory, id, mode, value)
      setDiffs(value)
    } catch (err) {
      if (currentRequest !== requestID.current) return
      setError(err instanceof Error ? err.message : t("files.loadFailed"))
    } finally {
      if (currentRequest === requestID.current) setLoading(false)
    }
  }, [api, directory, id, mode, path, t])

  const refresh = useCallback(() => {
    if (mode === "all") clearCachedFileEntries(directory)
    else if (id) clearCachedDiffs(directory, id, mode)
    void load()
  }, [directory, id, load, mode])

  useEffect(() => { void load() }, [load])

  const open = useCallback((file: string, view: "diff" | "file") => {
    router.push({ pathname: "/session-file", params: { id, directory, path: file, mode: view, source: mode } })
  }, [router, id, directory, mode])

  const items = useMemo<DiffItem[]>(() => groupDiffs(diffs).flatMap((group) => [
    { type: "section" as const, key: `section-${group.status}`, status: group.status, count: group.files.length },
    ...group.files.map((diff) => ({ type: "file" as const, key: `file-${diff.file}`, diff })),
  ]), [diffs])

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      <Stack.Screen options={{ title: t("files.title") }} />
      <View style={[s.tabs, isDark && s.tabsDark]}>
        {(["git", "turn", "branch", "all"] as const).map((item) => (
          <TouchableOpacity key={item} style={[s.tab, mode === item && s.tabActive]} onPress={() => setMode(item)}>
            <Text style={[s.tabText, isDark && s.textDark, mode === item && s.tabTextActive]}>{t(`files.tabs.${item}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === "all" && (
        <View style={s.browserHead}>
          <TouchableOpacity disabled={path === "."} onPress={() => setPath(parent(path))} hitSlop={8}>
            <Ionicons name="arrow-up-circle-outline" size={24} color={path === "." ? "#777777" : "#8b5cf6"} />
          </TouchableOpacity>
          <Text style={[s.browserPath, isDark && s.textDark]} numberOfLines={1}>{path}</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder={t("files.filter")} placeholderTextColor="#777777" style={[s.search, isDark && s.searchDark]} autoCapitalize="none" autoCorrect={false} />
        </View>
      )}

      {loading && (mode !== "all" || entries.length === 0) ? (
        <View style={s.center}><ActivityIndicator size="large" color="#8b5cf6" /></View>
      ) : error ? (
        <View style={s.center}><Text style={s.error}>{error}</Text><TouchableOpacity onPress={load}><Text style={s.retry}>{t("common.retry")}</Text></TouchableOpacity></View>
      ) : mode === "all" ? (
        <FlatList
          data={entries.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))}
          keyExtractor={(item) => item.absolute}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          removeClippedSubviews
          initialNumToRender={24}
          maxToRenderPerBatch={24}
          windowSize={7}
          renderItem={({ item }) => (
            <TouchableOpacity style={[s.row, isDark && s.rowDark]} onPress={() => item.type === "directory" ? setPath(item.path) : open(item.path, "file")}>
              <Ionicons name={item.type === "directory" ? "folder-outline" : "document-text-outline"} size={20} color={item.ignored ? "#777777" : item.type === "directory" ? "#f59e0b" : "#8b5cf6"} />
              <Text style={[s.rowText, isDark && s.textDark, item.ignored && s.ignored]} numberOfLines={1}>{item.name}</Text>
              {item.type === "directory" && <Ionicons name="chevron-forward" size={16} color="#777777" />}
            </TouchableOpacity>
          )}
          contentContainerStyle={s.list}
          ListEmptyComponent={<Text style={s.empty}>{t("files.empty")}</Text>}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          removeClippedSubviews
          initialNumToRender={24}
          maxToRenderPerBatch={24}
          windowSize={7}
          contentContainerStyle={s.list}
          renderItem={({ item }) => item.type === "section" ? (
            <Text style={[s.section, isDark && s.sectionDark]}>{t(`files.status.${item.status}`)} · {item.count}</Text>
          ) : (
            <TouchableOpacity style={[s.row, isDark && s.rowDark]} onPress={() => open(item.diff.file!, "diff")}>
              <View style={[s.status, item.diff.status === "added" ? s.added : item.diff.status === "deleted" ? s.deleted : s.modified]}><Text style={s.statusText}>{item.diff.status === "added" ? "A" : item.diff.status === "deleted" ? "D" : "M"}</Text></View>
              <Text style={[s.rowText, isDark && s.textDark]} numberOfLines={1}>{item.diff.file}</Text>
              <Text style={s.additions}>+{item.diff.additions}</Text><Text style={s.deletions}>-{item.diff.deletions}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={s.empty}>{t("files.noChanges")}</Text>}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f6f6f3" }, containerDark: { backgroundColor: "#0a0a0a" },
  tabs: { flexDirection: "row", gap: 6, padding: 10, backgroundColor: "#ffffff", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#dddddd" }, tabsDark: { backgroundColor: "#111111", borderBottomColor: "#2a2a2a" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 }, tabActive: { backgroundColor: "#8b5cf6" }, tabText: { color: "#555555", fontSize: 12, fontWeight: "600" }, tabTextActive: { color: "#ffffff" },
  browserHead: { padding: 10, gap: 8, flexDirection: "row", alignItems: "center" }, browserPath: { maxWidth: 100, color: "#222222", fontFamily: "monospace", fontSize: 12 }, search: { flex: 1, height: 38, borderRadius: 9, paddingHorizontal: 11, backgroundColor: "#ffffff", color: "#111111" }, searchDark: { backgroundColor: "#202020", color: "#ffffff" },
  list: { padding: 10, paddingBottom: 30 }, section: { color: "#666666", fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 4, paddingTop: 12, paddingBottom: 7 }, sectionDark: { color: "#999999" },
  row: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, paddingHorizontal: 12, borderRadius: 11, backgroundColor: "#ffffff" }, rowDark: { backgroundColor: "#191919" }, rowText: { flex: 1, color: "#171717", fontFamily: "monospace", fontSize: 13 }, textDark: { color: "#eeeeee" }, ignored: { color: "#888888" },
  status: { width: 23, height: 23, alignItems: "center", justifyContent: "center", borderRadius: 6 }, modified: { backgroundColor: "#f59e0b" }, added: { backgroundColor: "#16a34a" }, deleted: { backgroundColor: "#dc2626" }, statusText: { color: "#ffffff", fontSize: 11, fontWeight: "800" }, additions: { color: "#16a34a", fontSize: 12 }, deletions: { color: "#dc2626", fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }, error: { color: "#ef4444", textAlign: "center" }, retry: { color: "#8b5cf6", fontWeight: "700" }, empty: { color: "#888888", textAlign: "center", padding: 40 },
})
