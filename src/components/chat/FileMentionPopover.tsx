import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

interface Props {
  files: string[]
  loading: boolean
  isDark: boolean
  onSelect: (path: string) => void
}

export function FileMentionPopover({ files, loading, isDark, onSelect }: Props) {
  const { t } = useTranslation()
  if (!loading && files.length === 0) return null

  return (
    <View style={[s.popover, isDark && s.popoverDark]}>
      {loading && files.length === 0 ? (
        <View style={s.loading}>
          <ActivityIndicator size="small" color={isDark ? "#ffffff" : "#0a0a0a"} />
          <Text style={[s.hint, isDark && s.hintDark]}>{t("files.searching")}</Text>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="always" style={s.scroll}>
          {files.map((path) => (
            <TouchableOpacity key={path} style={s.item} onPress={() => onSelect(path)}>
              <Ionicons name="document-text-outline" size={17} color={isDark ? "#a78bfa" : "#7c3aed"} />
              <Text style={[s.path, isDark && s.pathDark]} numberOfLines={1}>{path}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  popover: { maxHeight: 230, borderTopWidth: 1, borderTopColor: "#e5e5e5", backgroundColor: "#ffffff" },
  popoverDark: { borderTopColor: "#2a2a2a", backgroundColor: "#161616" },
  scroll: { paddingVertical: 4 },
  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 },
  hint: { color: "#666666", fontSize: 13 },
  hintDark: { color: "#999999" },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  path: { flex: 1, color: "#171717", fontFamily: "monospace", fontSize: 13 },
  pathDark: { color: "#eeeeee" },
})
