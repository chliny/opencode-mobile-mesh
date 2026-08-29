import { useEffect, useRef, useState } from "react"
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated"
import { useTerminal } from "../../src/stores/terminal"
import { useConnections } from "../../src/stores/connections"
import { PtyOutputDecoder } from "../../src/lib/pty-output"

export default function TerminalScreen() {
  const isDark = useColorScheme() === "dark"
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const client = useConnections((state) => state.client)
  const sessions = useTerminal((state) => state.sessions)
  const activeID = useTerminal((state) => state.activeID)
  const output = useTerminal((state) => state.output)
  const load = useTerminal((state) => state.load)
  const create = useTerminal((state) => state.create)
  const remove = useTerminal((state) => state.remove)
  const append = useTerminal((state) => state.append)
  const clear = useTerminal((state) => state.clear)
  const [input, setInput] = useState("")
  const socket = useRef<WebSocket | null>(null)
  const scroll = useRef<ScrollView>(null)
  const keyboard = useAnimatedKeyboard()
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: Platform.OS === "android" ? Math.max(0, keyboard.height.value - insets.bottom) : 0,
  }))

  useFocusEffect(() => {
    void load()
  })

  useEffect(() => {
    if (!client || !activeID) return
    let closed = false
    let current: WebSocket | null = null
    const decoder = new PtyOutputDecoder()
    const connect = async () => {
      const token = await client.pty.connectToken(activeID).catch(() => undefined)
      if (closed) return
      current = new WebSocket(client.pty.websocketUrl(activeID, 0, token))
      socket.current = current
      current.binaryType = "arraybuffer"
      current.onmessage = (event) => {
        if (typeof event.data === "string") {
          append(activeID, decoder.decodeText(event.data))
          return
        }
        if (event.data instanceof ArrayBuffer) {
          append(activeID, decoder.decode(event.data))
        }
      }
    }
    void connect()
    return () => {
      closed = true
      decoder.flush()
      current?.close()
      socket.current = null
    }
  }, [activeID, client, append])

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: false })
  }, [activeID, output[activeID || ""]])

  const send = () => {
    if (!input || !socket.current || socket.current.readyState !== WebSocket.OPEN) return
    socket.current.send(`${input}\r`)
    setInput("")
  }

  const active = sessions.find((item) => item.id === activeID)
  return (
    <KeyboardAvoidingView style={[styles.root, isDark && styles.rootDark]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Animated.View style={[styles.content, keyboardStyle]}>
      <View style={[styles.toolbar, isDark && styles.borderDark]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {sessions.map((item) => (
            <Pressable key={item.id} onPress={() => useTerminal.getState().select(item.id)} style={[styles.tab, item.id === activeID && styles.tabActive]}>
              <Text style={[styles.tabText, isDark && styles.textDark]}>{item.title || item.id}</Text>
              <Pressable onPress={() => Alert.alert(t("terminal.deleteTitle"), t("terminal.deleteMessage"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("common.delete"), style: "destructive", onPress: () => void remove(item.id) }])} hitSlop={8}>
                <Ionicons name="close" size={15} color={isDark ? "#aaa" : "#666"} />
              </Pressable>
            </Pressable>
          ))}
          <Pressable onPress={() => void create()} style={styles.add} accessibilityLabel={t("terminal.new") }>
            <Ionicons name="add" size={22} color={isDark ? "#fff" : "#111"} />
          </Pressable>
        </ScrollView>
      </View>
      {!client ? <Text style={[styles.empty, isDark && styles.textDark]}>{t("terminal.noConnection")}</Text> : !active ? <Text style={[styles.empty, isDark && styles.textDark]}>{t("terminal.empty")}</Text> : (
        <>
          <ScrollView ref={scroll} style={[styles.output, isDark && styles.outputDark]} contentContainerStyle={styles.outputContent}>
            <Text selectable style={styles.outputText}>{output[active.id] || ""}</Text>
          </ScrollView>
          <View style={[styles.inputBar, isDark && styles.borderDark]}>
            <TextInput value={input} onChangeText={setInput} onSubmitEditing={send} returnKeyType="send" blurOnSubmit={false} placeholder={t("terminal.inputPlaceholder")} placeholderTextColor="#777" style={[styles.input, isDark && styles.textDark]} autoCapitalize="none" autoCorrect={false} />
            <Pressable onPress={() => clear(active.id)} style={styles.iconButton}><Ionicons name="trash-outline" size={20} color="#888" /></Pressable>
            <Pressable onPress={send} style={styles.send}><Ionicons name="arrow-up" size={20} color="#fff" /></Pressable>
          </View>
        </>
      )}
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#fff" }, rootDark: { backgroundColor: "#0a0a0a" }, content: { flex: 1 }, toolbar: { borderBottomWidth: 1, borderBottomColor: "#e5e5e5" }, borderDark: { borderBottomColor: "#252525" }, tabs: { padding: 8, gap: 8, alignItems: "center" }, tab: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 7, backgroundColor: "#eeeeee" }, tabActive: { backgroundColor: "#8b5cf6" }, tabText: { color: "#222", maxWidth: 130 }, textDark: { color: "#fff" }, add: { padding: 6 }, output: { flex: 1, backgroundColor: "#111" }, outputDark: { backgroundColor: "#050505" }, outputContent: { padding: 14, flexGrow: 1 }, outputText: { color: "#d4d4d4", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, lineHeight: 19 }, inputBar: { flexDirection: "row", alignItems: "center", padding: 8, gap: 8, borderTopWidth: 1, borderTopColor: "#e5e5e5" }, input: { flex: 1, minHeight: 42, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#eeeeee", color: "#111" }, iconButton: { padding: 9 }, send: { backgroundColor: "#7c3aed", borderRadius: 8, padding: 10 }, empty: { flex: 1, textAlign: "center", textAlignVertical: "center", padding: 30, color: "#555" } })
