import { useCallback, useEffect, useRef, useState } from "react"
import { Alert, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTerminal } from "../../src/stores/terminal"
import { useConnections } from "../../src/stores/connections"
import { PtyOutputDecoder } from "../../src/lib/pty-output"
import { terminalRuns } from "../../src/lib/terminal-screen"

function controlCode(char: string): string {
  const code = char.toUpperCase().charCodeAt(0)
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64)
  if (char === "?") return "\u007f"
  return char
}

export default function TerminalScreen() {
  const isDark = useColorScheme() === "dark"
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const landscape = width > height
  const { t } = useTranslation()
  const client = useConnections((state) => state.client)
  const currentProject = useConnections((state) => state.currentProject)
  const activeConnection = useConnections((state) => state.activeConnection)
  const serverDirectory = useConnections((state) => state.serverDirectory)
  const sessions = useTerminal((state) => state.sessions)
  const activeID = useTerminal((state) => state.activeID)
  const output = useTerminal((state) => state.output)
  const load = useTerminal((state) => state.load)
  const open = useTerminal((state) => state.open)
  const create = useTerminal((state) => state.create)
  const remove = useTerminal((state) => state.remove)
  const append = useTerminal((state) => state.append)
  const clear = useTerminal((state) => state.clear)
  const [input, setInput] = useState("")
  const [ctrl, setCtrl] = useState(false)
  const [keyboardBottom, setKeyboardBottom] = useState(0)
  const [shortcutHeight, setShortcutHeight] = useState(0)
  const [outputHeight, setOutputHeight] = useState(0)
  const [outputWidth, setOutputWidth] = useState(0)
  const socket = useRef<WebSocket | null>(null)
  const inputRef = useRef<TextInput>(null)
  const terminalRef = useRef<View>(null)
  const keyboardScreenY = useRef(0)
  const inputValue = useRef("")
  const scroll = useRef<ScrollView>(null)
  const cursors = useRef<Record<string, number>>({})

  const cwd = currentProject?.path?.absolute || activeConnection?.directory || serverDirectory

  const measureKeyboardBottom = () => {
    if (landscape) return
    if (Keyboard.isVisible()) {
      const metrics = Keyboard.metrics()
      if (metrics?.screenY) keyboardScreenY.current = metrics.screenY
    }
    if (!keyboardScreenY.current) return
    terminalRef.current?.measureInWindow((_, y, __, terminalHeight) => {
      setKeyboardBottom(Math.max(0, y + terminalHeight - keyboardScreenY.current + insets.top))
    })
  }

  useFocusEffect(useCallback(() => {
    if (!client) return
    if (cwd) {
      void open(cwd)
      return
    }
    void load()
  }, [client, cwd, load, open]))

  useEffect(() => {
    if (!client || !activeID) return
    let closed = false
    let current: WebSocket | null = null
    const decoder = new PtyOutputDecoder()
    const connect = async () => {
      const token = await client.pty.connectToken(activeID).catch(() => undefined)
      if (closed) return
      current = new WebSocket(client.pty.websocketUrl(activeID, cursors.current[activeID] || 0, token))
      socket.current = current
      current.binaryType = "arraybuffer"
      current.onmessage = (event) => {
        if (typeof event.data === "string") {
          append(activeID, decoder.decodeText(event.data))
          cursors.current[activeID] = decoder.cursor
          return
        }
        if (event.data instanceof ArrayBuffer) {
          append(activeID, decoder.decode(event.data))
          cursors.current[activeID] = decoder.cursor
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

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardScreenY.current = event.endCoordinates.screenY
      measureKeyboardBottom()
      requestAnimationFrame(measureKeyboardBottom)
    })
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardScreenY.current = 0
      setKeyboardBottom(0)
    })
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return
      requestAnimationFrame(measureKeyboardBottom)
      setTimeout(measureKeyboardBottom, 100)
    })
    return () => {
      show.remove()
      hide.remove()
      appState.remove()
    }
  }, [insets.top, landscape])

  const send = (value: string) => {
    if (!value || !socket.current || socket.current.readyState !== WebSocket.OPEN) return
    socket.current.send(value)
  }

  const sendInput = (value: string) => {
    const previous = inputValue.current
    let start = 0
    while (start < previous.length && start < value.length && previous[start] === value[start]) start++
    if (value.length > start) {
      const text = value.slice(start)
      send(ctrl ? text.split("").map(controlCode).join("") : text)
    }
    if (previous.length > start) send("\u007f".repeat(previous.length - start))
    inputValue.current = value
    setInput(value)
    if (ctrl) setCtrl(false)
  }

  const shortcut = (value: string) => {
    send(value)
    inputRef.current?.focus()
  }

  const sendLine = () => {
    shortcut(ctrl ? "\n" : "\r")
    inputValue.current = ""
    setInput("")
    setCtrl(false)
  }

  const active = sessions.find((item) => item.id === activeID)
  const terminalWidth = outputWidth || width
  const columns = Math.max(20, Math.floor((terminalWidth - 28) / 7.8))
  const rows = Math.max(2, Math.floor((outputHeight - (landscape ? 0 : shortcutHeight)) / 19))

  useEffect(() => {
    if (!client || !activeID || !outputHeight) return
    void client.pty.update(activeID, { size: { rows, cols: columns } }).catch(() => undefined)
  }, [activeID, client, columns, outputHeight, rows])

  return (
    <KeyboardAvoidingView style={[styles.root, isDark && styles.rootDark]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.content}>
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
          <View ref={terminalRef} onLayout={() => {
            if (!landscape) requestAnimationFrame(measureKeyboardBottom)
          }} style={[styles.terminalArea, !landscape && keyboardBottom > 0 && { marginBottom: keyboardBottom }, landscape && styles.terminalAreaLandscape]}>
            <Pressable style={[styles.outputArea, landscape && styles.outputAreaLandscape]} onLayout={(event) => {
              setOutputHeight(event.nativeEvent.layout.height)
              setOutputWidth(event.nativeEvent.layout.width)
            }} onPress={() => inputRef.current?.focus()}>
              <ScrollView
                ref={scroll}
                onTouchStart={() => inputRef.current?.focus()}
                style={[styles.output, isDark && styles.outputDark]}
                contentContainerStyle={[styles.outputContent, { width: terminalWidth, paddingBottom: shortcutHeight + 14 }]}
              >
                <View style={{ width: terminalWidth - 28 }}>
                  {terminalRuns(output[active.id] || "", columns).map((line, index) => (
                    <Text key={index} selectable allowFontScaling={false} style={styles.outputText}>
                      {line.map((run, runIndex) => <Text key={runIndex} style={{ color: run.color, fontWeight: run.bold ? "700" : "400" }}>{run.text}</Text>)}
                    </Text>
                  ))}
                </View>
              </ScrollView>
            </Pressable>
          <TextInput ref={inputRef} value={input} onChangeText={sendInput} onSubmitEditing={sendLine} blurOnSubmit={false} style={styles.hiddenInput} autoCapitalize="none" autoCorrect={false} caretHidden />
          <View onLayout={(event) => setShortcutHeight(event.nativeEvent.layout.height)} style={[styles.shortcuts, landscape && styles.shortcutsLandscape, isDark && styles.shortcutsDark]}>
            <Pressable onPress={() => shortcut("\u001b[D")} style={[styles.shortcut, landscape && styles.shortcutLandscape]}><Text style={styles.shortcutText}>←</Text></Pressable>
            <Pressable onPress={() => shortcut("\u001b[C")} style={[styles.shortcut, landscape && styles.shortcutLandscape]}><Text style={styles.shortcutText}>→</Text></Pressable>
            <Pressable onPress={() => shortcut("\u001b")} style={[styles.shortcut, landscape && styles.shortcutLandscape]}><Text style={styles.shortcutText}>Esc</Text></Pressable>
            <Pressable onPress={() => shortcut("\t")} style={[styles.shortcut, landscape && styles.shortcutLandscape]}><Text style={styles.shortcutText}>Tab</Text></Pressable>
            <Pressable onPress={() => setCtrl((value) => !value)} style={[styles.shortcut, landscape && styles.shortcutLandscape, ctrl && styles.shortcutActive]}><Text style={styles.shortcutText}>Ctrl</Text></Pressable>
            <Pressable onPress={sendLine} style={[styles.shortcut, landscape && styles.shortcutLandscape]}><Text style={styles.shortcutText}>Enter</Text></Pressable>
            <Pressable onPress={() => clear(active.id)} style={[styles.shortcut, landscape && styles.shortcutLandscape]}><Ionicons name="trash-outline" size={20} color="#777" /></Pressable>
          </View>
          </View>
        </>
      )}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#fff" }, rootDark: { backgroundColor: "#0a0a0a" }, content: { flex: 1 }, toolbar: { borderBottomWidth: 1, borderBottomColor: "#e5e5e5" }, borderDark: { borderBottomColor: "#252525" }, tabs: { padding: 8, gap: 8, alignItems: "center" }, tab: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 7, backgroundColor: "#eeeeee" }, tabActive: { backgroundColor: "#8b5cf6" }, tabText: { color: "#222", maxWidth: 130 }, textDark: { color: "#fff" }, add: { padding: 6 }, terminalArea: { flex: 1, backgroundColor: "#111" }, terminalAreaLandscape: { flexDirection: "row" }, outputArea: { flex: 1 }, outputAreaLandscape: { marginRight: 56 }, output: { flex: 1, backgroundColor: "#111" }, outputDark: { backgroundColor: "#050505" }, outputContent: { padding: 14, flexGrow: 1 }, outputText: { color: "#d4d4d4", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, lineHeight: 19 }, hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0, left: 0, top: 0 }, shortcuts: { position: "absolute", left: 0, right: 0, bottom: 0, height: 48, flexDirection: "row", alignItems: "stretch", backgroundColor: "#f8f8f8", borderTopWidth: 1, borderTopColor: "#d8d8d8", paddingHorizontal: 4 }, shortcutsLandscape: { right: 0, top: 0, bottom: 0, width: 56, height: undefined, flexDirection: "column", borderTopWidth: 0, borderLeftWidth: 1, paddingHorizontal: 0 }, shortcutsDark: { backgroundColor: "#202020", borderTopColor: "#444", borderLeftColor: "#444" }, shortcut: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 2, borderRightWidth: 1, borderRightColor: "#dedede" }, shortcutLandscape: { borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: "#dedede" }, shortcutActive: { backgroundColor: "#d8d8d8" }, shortcutText: { color: "#222", fontSize: 15, textAlign: "center" }, empty: { flex: 1, textAlign: "center", textAlignVertical: "center", padding: 30, color: "#555" } })
