import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import type { PromptFileReference } from "../../lib/sdk"

interface Props {
  contexts: PromptFileReference[]
  isDark: boolean
  onRemove: (index: number) => void
}

export function FileContextChips({ contexts, isDark, onRemove }: Props) {
  if (contexts.length === 0) return null
  return (
    <View style={[s.wrap, isDark && s.wrapDark]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.content}>
        {contexts.map((context, index) => (
          <View key={`${context.path}-${context.selection?.startLine || 0}-${index}`} style={[s.chip, isDark && s.chipDark]}>
            <Ionicons name="chatbox-ellipses-outline" size={14} color="#8b5cf6" />
            <Text style={[s.label, isDark && s.labelDark]} numberOfLines={1}>
              {context.path}{context.selection ? `:${context.selection.startLine}-${context.selection.endLine}` : ""}
            </Text>
            <TouchableOpacity onPress={() => onRemove(index)} hitSlop={8}>
              <Ionicons name="close" size={15} color={isDark ? "#999999" : "#666666"} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5e5", backgroundColor: "#ffffff" },
  wrapDark: { borderTopColor: "#292929", backgroundColor: "#0a0a0a" },
  content: { paddingHorizontal: 12, paddingVertical: 7, gap: 7 },
  chip: { maxWidth: 260, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: "#f3e8ff" },
  chipDark: { backgroundColor: "#291a3b" },
  label: { flexShrink: 1, color: "#6d28d9", fontSize: 12, fontFamily: "monospace" },
  labelDark: { color: "#c4b5fd" },
})
