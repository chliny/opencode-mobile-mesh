import { useMemo } from "react"
import { Modal, FlatList, Text, TouchableOpacity, View, StyleSheet } from "react-native"
import { useTranslation } from "react-i18next"
import type { Message } from "../../lib/sdk"

interface Props {
  visible: boolean
  messages: Message[]
  textFor: (messageID: string) => string
  isDark: boolean
  onSelect: (message: Message) => void
  onClose: () => void
}

export function ForkMessageSheet({ visible, messages, textFor, isDark, onSelect, onClose }: Props) {
  const { t } = useTranslation()
  const items = useMemo(() => messages.slice().reverse(), [messages])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, isDark && s.sheetDark]}>
          <View style={s.header}>
            <Text style={[s.title, isDark && s.textWhite]}>{t("session.alerts.forkTitle")}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button">
              <Text style={[s.close, isDark && s.textWhite]}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.hint, isDark && s.hintDark]}>{t("session.alerts.forkMessage")}</Text>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={[s.item, isDark && s.itemDark]} onPress={() => onSelect(item)}>
                <Text style={[s.itemText, isDark && s.textWhite]} numberOfLines={3}>
                  {textFor(item.id) || t("session.titleFallback")}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "82%", backgroundColor: "#ffffff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 },
  sheetDark: { backgroundColor: "#1a1a1a" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "700", color: "#0a0a0a" },
  close: { fontSize: 14, color: "#8b5cf6", fontWeight: "600" },
  hint: { color: "#666666", fontSize: 13, marginBottom: 10 },
  hintDark: { color: "#9a9a9a" },
  item: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#f5f5f5", marginBottom: 8 },
  itemDark: { backgroundColor: "#2a2a2a" },
  itemText: { color: "#0a0a0a", fontSize: 14, lineHeight: 20 },
  textWhite: { color: "#ffffff" },
})
