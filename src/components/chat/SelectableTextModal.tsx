import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, useColorScheme } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTranslation } from "react-i18next"

interface Props {
  visible: boolean
  text: string
  onClose: () => void
}

export function SelectableTextModal({ visible, text, onClose }: Props) {
  const isDark = useColorScheme() === "dark"
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[s.overlay, isDark && s.overlayDark]}>
        <View style={[s.container, isDark && s.containerDark, { paddingTop: Math.max(20, insets.top) }]}>
          <View style={s.header}>
            <Text style={[s.title, isDark && s.titleDark]}>{t("session.actions.selectText")}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={s.close}>{t("common.done")}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            <Text style={[s.body, isDark && s.bodyDark]} selectable>
              {text}
            </Text>
          </ScrollView>
          <View style={[s.hint, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>
            <Text style={[s.hintText, isDark && s.hintTextDark]}>
              {t("session.actions.selectHint")}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  overlayDark: { backgroundColor: "rgba(0,0,0,0.6)" },
  container: {
    flex: 1,
    marginTop: 60,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  containerDark: { backgroundColor: "#1a1a1a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  title: { fontSize: 16, fontWeight: "600", color: "#0a0a0a" },
  titleDark: { color: "#ffffff" },
  close: { fontSize: 16, color: "#007aff", fontWeight: "500" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  body: { fontSize: 15, lineHeight: 24, color: "#0a0a0a" },
  bodyDark: { color: "#e0e0e0" },
  hint: { alignItems: "center", paddingTop: 8 },
  hintText: { fontSize: 12, color: "#999999" },
  hintTextDark: { color: "#9a9a9a" },
})
