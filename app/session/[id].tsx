import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  InteractionManager,
  type AlertButton,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native"
import { useLocalSearchParams, Stack, useRouter, useFocusEffect } from "expo-router"
import { useIsFocused } from "@react-navigation/native"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTranslation } from "react-i18next"
import * as ImagePicker from "expo-image-picker"
import * as ImageManipulator from "expo-image-manipulator"
import * as Clipboard from "expo-clipboard"
import type BottomSheet from "@gorhom/bottom-sheet"
import {
  MessageBubble,
  PermissionPrompt,
  QuestionPrompt,
  StatusIndicator,
  SlashPopover,
  ModelPicker,
  VariantPicker,
  ImageAttachments,
  SessionInfo,
  SelectableTextModal,
  FileMentionPopover,
  FileContextChips,
  type SlashCommand,
  type Attachment,
} from "../../src/components/chat"
import { useSessions } from "../../src/stores/sessions"
import { useEvents, refreshPending } from "../../src/stores/events"
import { useConnections } from "../../src/stores/connections"
import { useAuth } from "../../src/stores/auth"
import { useCatalog } from "../../src/stores/catalog"
import { useSpeech } from "../../src/lib/speech"
import { reviewDiffsForMessage } from "../../src/lib/review-diffs"
import { sessionRouteState } from "../../src/lib/session-route-binding"
import { isAtBottom, shouldAutoScroll, shouldShowScrollButton, transcriptSignature } from "../../src/lib/auto-scroll"
import { extractCopyText, hasCopyableText } from "../../src/lib/message-copy-text"
import { modelNameFor } from "../../src/lib/model-display"
import { activeMention, insertMention } from "../../src/lib/file-review"
import { childSessionTitle } from "../../src/lib/subagent"
import type { PromptFileReference } from "../../src/lib/sdk"
import { cacheDiffs, cacheVcsDiffs, getCachedDiffs, getCachedVcsDiffs } from "../../src/lib/session-file-cache"
import { turnDiffsFromMessages, turnSummaryRecorded } from "../../src/lib/review-diffs"

// --- Builtin slash commands ---
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    trigger: "new",
    title: "New Session",
    description: "Start a new session",
    icon: "add-circle-outline",
    type: "builtin",
  },
  {
    trigger: "model",
    title: "Switch Model",
    description: "Choose a different model",
    icon: "hardware-chip-outline",
    type: "builtin",
  },
  {
    trigger: "agent",
    title: "Switch Agent",
    description: "Cycle to next agent",
    icon: "person-outline",
    type: "builtin",
  },
]

const EMPTY_PROMPT_REFERENCES: PromptFileReference[] = []
const EMPTY_LIST: never[] = []
const EMPTY_PARTS: Record<string, never[]> = {}
const EMPTY_RECORD: Record<string, never> = {}

function getShortDir(dir?: string): string | null {
  if (!dir) return null
  const parts = dir.split("/").filter(Boolean)
  return parts[parts.length - 1] || null
}

export default function SessionScreen() {
  const { id, directory } = useLocalSearchParams<{ id: string; directory?: string }>()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const isFocused = useIsFocused()

  const flatListRef = useRef<FlatList>(null)
  const scrollOffsetRef = useRef(0)
  const previousSignatureRef = useRef<string | null>(null)
  const followFrameRef = useRef<number | null>(null)
  const modelSheetRef = useRef<BottomSheet>(null)
  const variantSheetRef = useRef<BottomSheet>(null)
  const [input, setInputState] = useState(() => (id ? useSessions.getState().drafts[id] || "" : ""))
  const inputRef = useRef(input)
  inputRef.current = input
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [selection, setSelection] = useState({ start: input.length, end: input.length })
  const [mentionFiles, setMentionFiles] = useState<string[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [selectedMentions, setSelectedMentions] = useState<string[]>([])
  const [showInfo, setShowInfo] = useState(false)

  const currentSession = useSessions((state) => (isFocused ? state.currentSession : null))
  const messages = useSessions((state) => (isFocused ? state.messages : EMPTY_LIST))
  const parts = useSessions((state) => (isFocused ? state.parts : EMPTY_PARTS))
  const transcriptRevision = useSessions((state) => (isFocused ? state.transcriptRevision : EMPTY_RECORD))
  const loadingMore = useSessions((state) => (isFocused ? state.loadingMore : false))
  const hasMore = useSessions((state) => (isFocused ? state.hasMore : false))
  const error = useSessions((state) => (isFocused ? state.error : null))
  const selectSession = useSessions((state) => state.selectSession)
  const setDraft = useSessions((state) => state.setDraft)
  const clearDraft = useSessions((state) => state.clearDraft)
  const removeFileContext = useSessions((state) => state.removeFileContext)
  const clearFileContexts = useSessions((state) => state.clearFileContexts)
  const sendMessage = useSessions((state) => state.sendMessage)
  const abortSession = useSessions((state) => state.abortSession)
  const loadOlderMessages = useSessions((state) => state.loadOlderMessages)
  const revertToMessage = useSessions((state) => state.revertToMessage)
  const unrevertSession = useSessions((state) => state.unrevertSession)

  const bindingAttempt = useRef(0)
  const [failedSessionID, setFailedSessionID] = useState<string | null>(null)
  const routeState = sessionRouteState(id, currentSession?.id, failedSessionID)
  const transcriptBound = routeState === "bound"

  const setInput = useCallback(
    (value: string | ((current: string) => string)) => {
      const next = typeof value === "function" ? value(inputRef.current) : value
      inputRef.current = next
      setInputState(next)
      if (id) setDraft(id, next)
    },
    [id, setDraft],
  )

  // The local flag bridges the prompt request until SSE reports busy. The
  // server status is also required here because leaving and re-entering the
  // screen resets the local flag while the session may still be running.
  const isSending = useSessions((s) => !!(transcriptBound && id && s.sending[id]))
  const isSessionBusy = useEvents((s) => {
    if (!transcriptBound || !id) return false
    const status = s.sessionStatus[id]?.type
    return status === "busy" || status === "retry"
  })
  const canStop = isSending || isSessionBusy
  const fileContexts = useSessions((s) => (id ? s.fileContexts[id] || EMPTY_PROMPT_REFERENCES : EMPTY_PROMPT_REFERENCES))

  const { authenticateForMessage } = useAuth()
  const client = useConnections((state) => (isFocused ? state.client : null))
  const clientForDirectory = useConnections((state) => state.clientForDirectory)

  // Use directory-aware client for sessions that belong to a project other than the active one
  const sessionClient = useMemo(
    () => {
      if (!transcriptBound) return null
      if (!currentSession?.directory) return client
      return clientForDirectory(currentSession.directory) ?? client
    },
    [transcriptBound, currentSession?.directory, clientForDirectory, client],
  )

  useEffect(() => {
    if (!transcriptBound || !sessionClient || !currentSession?.id) return
    const sessionID = currentSession.id
    const dir = currentSession.directory || directory
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const interaction = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        const warm = async () => {
          if (!active || useSessions.getState().sending[sessionID]) return
          // Turn diffs come from the last user message's summary (the server
          // returns [] for /session/:id/diff without a messageID) — sync the
          // cache from the live transcript instead of hitting the endpoint.
          const local = useSessions.getState()
          const turn = turnDiffsFromMessages(local.messages, currentSession.revert?.messageID)
          if (turn && active && !local.sending[sessionID] && (turn.length > 0 || turnSummaryRecorded(local.messages, currentSession.revert?.messageID))) {
            cacheDiffs(dir, sessionID, "turn", turn)
          }
          if (!active || useSessions.getState().sending[sessionID] || getCachedDiffs(dir, sessionID, "git")) return
          const git = getCachedVcsDiffs(dir, "git")
          if (git) {
            cacheDiffs(dir, sessionID, "git", git)
          } else {
            try {
              const value = await sessionClient.vcs.diff({ mode: "git", context: 10 })
              if (active) {
                cacheVcsDiffs(dir, "git", value)
                cacheDiffs(dir, sessionID, "git", value)
              }
            } catch {
              return
            }
          }
          if (!active || useSessions.getState().sending[sessionID] || getCachedDiffs(dir, sessionID, "branch")) return
          const branch = getCachedVcsDiffs(dir, "branch")
          if (branch) {
            cacheDiffs(dir, sessionID, "branch", branch)
          } else {
            try {
              const value = await sessionClient.vcs.diff({ mode: "branch", context: 10 })
              if (active) {
                cacheVcsDiffs(dir, "branch", value)
                cacheDiffs(dir, sessionID, "branch", value)
              }
            } catch {
              return
            }
          }
        }
        void warm()
      }, 2500)
    })
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      interaction.cancel()
    }
  }, [currentSession?.directory, currentSession?.id, directory, sessionClient, transcriptBound])

  // Catalog
  const agents = useCatalog((state) => (isFocused ? state.agents : EMPTY_LIST))
  const serverCommands = useCatalog((state) => (isFocused ? state.commands : EMPTY_LIST))
  const providers = useCatalog((state) => (isFocused ? state.providers : EMPTY_LIST))
  const agent = useCatalog((state) => (isFocused ? state.agent : ""))
  const model = useCatalog((state) => (isFocused ? state.model : null))
  const setModel = useCatalog((state) => state.setModel)
  const sessionModels = useCatalog((state) => (isFocused ? state.sessionModels : EMPTY_RECORD))
  const setSessionModel = useCatalog((state) => state.setSessionModel)
  const variant = useCatalog((state) => (isFocused ? state.variant : null))
  const setVariant = useCatalog((state) => state.setVariant)
  const cycleAgent = useCatalog((state) => state.cycleAgent)

  // Permission & question state
  const sessionID = transcriptBound ? currentSession?.id : undefined
  const permissions = useEvents((s) => (sessionID ? s.permissions[sessionID] : undefined)) || EMPTY_LIST
  const questions = useEvents((s) => (sessionID ? s.questions[sessionID] : undefined)) || EMPTY_LIST

  const shortDir = transcriptBound ? getShortDir(currentSession?.directory) : null
  // Subagent (child) sessions are created by the task tool — read-only here:
  // they can't be prompted, and the header shows the clean task title.
  const isChildSession = transcriptBound && !!currentSession?.parentID
  const [showScrollButton, setShowScrollButton] = useState(false)

  // SSE reconnect banner
  const reconnectAttempts = useEvents((s) => s.reconnectAttempts)
  const [showConnectedFlash, setShowConnectedFlash] = useState(false)
  const prevReconnecting = useRef(false)

  // Selectable text modal — keeps assistant text out of the nested FlatList
  // where RN Android selectable conflicts with virtualized scrolling.
  const [selectableText, setSelectableText] = useState<string | null>(null)

  // Voice input — transcript appends to the text input on completion
  const speech = useSpeech(
    useCallback((text: string) => {
      setInput((prev) => (prev ? prev + " " + text : text))
    }, []),
  )

  // A native-stack back gesture can blur this screen before React unmounts it.
  // Cancel immediately so recognition cannot survive navigation.
  useFocusEffect(
    useCallback(() => {
      return () => speech.cancel()
    }, [speech.cancel]),
  )

  // Surface speech recognition failures (e.g. mic permission denied). Keyed
  // on the error value itself so it only fires once per distinct error, not
  // on every re-render while it remains set.
  useEffect(() => {
    if (!speech.error) return
    const message = {
      permission: "session.alerts.speechErrorPermission",
      network: "session.alerts.speechErrorNetwork",
      service: "session.alerts.speechErrorService",
      audio: "session.alerts.speechErrorAudio",
      busy: "session.alerts.speechErrorBusy",
      client: "session.alerts.speechErrorClient",
      unknown: "session.alerts.speechErrorMessage",
    }[speech.error.kind]
    Alert.alert(t("session.alerts.speechErrorTitle"), t(message))
  }, [speech.error, t])

  // Slash command state
  const slashActive = input.startsWith("/") && !input.includes(" ")
  const slashQuery = slashActive ? input.slice(1) : ""
  const mention = activeMention(input, selection.start)

  useEffect(() => {
    if (!mention || !sessionClient) {
      setMentionFiles([])
      setMentionLoading(false)
      return
    }
    let active = true
    const timer = setTimeout(() => {
      setMentionLoading(true)
      sessionClient.find.files({ query: mention.query, type: "file", limit: 40 })
        .then((files) => { if (active) setMentionFiles(files) })
        .catch(() => { if (active) setMentionFiles([]) })
        .finally(() => { if (active) setMentionLoading(false) })
    }, 180)
    return () => { active = false; clearTimeout(timer) }
  }, [mention?.start, mention?.end, mention?.query, sessionClient])

  const allCommands = useMemo<SlashCommand[]>(() => {
    const custom: SlashCommand[] = serverCommands.map((cmd) => ({
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      icon: "code-slash-outline",
      type: "custom",
    }))
    return [...custom, ...BUILTIN_COMMANDS]
  }, [serverCommands])

  // While a revert is pending, the reverted message and everything after it
  // still exist server-side (cleanup only runs on the next prompt/unrevert)
  // — hide them client-side so editing feels immediate. Message IDs are
  // lexicographically sortable, same comparison the TUI uses. Optimistic
  // "temp-" IDs (assigned client-side before the server responds, see
  // sendMessage) aren't part of that sort order — always keep them so a
  // message sent concurrently with a revert isn't hidden.
  const revertMessageID = transcriptBound ? currentSession?.revert?.messageID : undefined

  // Inverted FlatList: data is reversed (newest first) so newest renders at bottom
  const messageData = useMemo(
    () => {
      if (!transcriptBound) return []
      const visible = (messages || [])
        .filter((msg) => !revertMessageID || msg.id.startsWith("temp-") || msg.id < revertMessageID)
      return visible
        .map((msg) => ({
          message: msg,
          parts: (parts && parts[msg.id]) || [],
          reviewDiffs: reviewDiffsForMessage(msg, visible),
        }))
        .reverse()
    },
    [transcriptBound, messages, parts, revertMessageID],
  )

  const newest = messageData[0]
  const contentSignature = transcriptSignature({
    revision: id ? transcriptRevision[id] || 0 : 0,
    messageCount: messageData.length,
    newestMessageID: newest?.message.id || null,
    newestPartCount: newest?.parts.length || 0,
    newestTextLength:
      newest?.parts.reduce((length, part) => length + (typeof part.text === "string" ? part.text.length : 0), 0) || 0,
  })

  // Tracks the latest composer text without pulling `input` into
  // handleMessageLongPress's deps — kept as a plain ref assignment (not
  // state) so the callback below stays referentially stable across
  // keystrokes for MessageBubble's custom memo comparator.
  const applyRevertResult = useCallback((result: Awaited<ReturnType<typeof revertToMessage>>) => {
    if (!result.ok) {
      if (result.reason === "unsupported") {
        Alert.alert(t("session.alerts.notSupportedTitle"), t("session.alerts.notSupportedMessage"))
      } else if (result.reason === "auth") {
        Alert.alert(t("session.alerts.revertAuthFailedTitle"), t("session.alerts.revertAuthFailedMessage"))
      } else {
        Alert.alert(t("session.alerts.editFailedTitle"), t("session.alerts.editFailedMessage"))
      }
      return
    }
    setInput(result.text)
    // Restore attachments in the same shape the composer's own picker
    // functions (pickFromLibrary/pickFromCamera/pasteFromClipboard) use.
    setAttachments(
      result.files
        .filter((f): f is typeof f & { url: string; mime: string } => !!f.url && !!f.mime)
        .map((f) => ({ uri: f.url, mime: f.mime, filename: f.filename })),
    )
  }, [t])

  // Stable across renders (reads fresh state via getState() rather than
  // closing over props) so MessageBubble's custom memo comparator can bail
  // safely without risking a stale handler.
  const handleMessageLongPress = useCallback((messageID: string) => {
    const state = useSessions.getState()
    const message = (state.messages || []).find((m) => m.id === messageID)
    const messageParts = (state.parts && state.parts[messageID]) || []
    const isUser = message?.role === "user"
    const copyable = hasCopyableText(messageParts)
    const copyText = extractCopyText(messageParts)

    const actions: AlertButton[] = []

    if (copyable) {
      actions.push({
        text: t("session.actions.copyMessage"),
        onPress: async () => {
          await Clipboard.setStringAsync(copyText)
        },
      })
      actions.push({
        text: t("session.actions.selectText"),
        onPress: () => {
          setSelectableText(copyText)
        },
      })
    }

    if (isUser) {
      actions.push({
        text: t("session.actions.editMessage"),
        onPress: () => {
          const doRevert = async () => {
            const result = await useSessions.getState().revertToMessage(messageID)
            applyRevertResult(result)
          }
          // Editing overwrites the composer — don't silently clobber an
          // in-progress unsent draft.
          if (inputRef.current.trim()) {
            Alert.alert(
              t("session.alerts.replaceDraftTitle"),
              t("session.alerts.replaceDraftMessage"),
              [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("session.actions.replace"), style: "destructive", onPress: doRevert },
              ],
              { cancelable: false },
            )
            return
          }
          doRevert()
        },
      })
    }

    // No actions to show (e.g. tool-only assistant message) — skip the sheet.
    if (actions.length === 0) return

    Alert.alert(t("session.alerts.messageActionsTitle"), undefined, [
      ...actions,
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [applyRevertResult, t])

  const scrollToBottom = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated })
  }, [])

  useEffect(() => {
    scrollOffsetRef.current = 0
    previousSignatureRef.current = null
    setShowScrollButton(false)
    if (followFrameRef.current !== null) cancelAnimationFrame(followFrameRef.current)
    followFrameRef.current = null
  }, [id])

  useEffect(() => {
    if (!transcriptBound) return
    const follow = shouldAutoScroll({
      offsetY: scrollOffsetRef.current,
      previousSignature: previousSignatureRef.current,
      currentSignature: contentSignature,
    })
    previousSignatureRef.current = contentSignature
    if (!follow || followFrameRef.current !== null) return

    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null
      if (isAtBottom(scrollOffsetRef.current)) scrollToBottom(false)
    })
  }, [transcriptBound, contentSignature, scrollToBottom])

  useEffect(
    () => () => {
      if (followFrameRef.current !== null) cancelAnimationFrame(followFrameRef.current)
    },
    [],
  )

  // Re-select on every focus, not just mount. currentSession/messages/
  // permissions are a single global store, and the native stack keeps screens
  // underneath a pushed one mounted. Without re-selecting on focus, navigating
  // to another session and back would leave this screen bound to the *other*
  // session's data (and its permission/question prompts) — so a user could
  // approve the wrong session's tool call. useFocusEffect re-binds this screen
  // to its own session whenever it becomes visible again.
  const bindSession = useCallback(async () => {
    if (!id) return
    const attempt = ++bindingAttempt.current
    setFailedSessionID(null)
    await selectSession(id, directory)
    if (attempt !== bindingAttempt.current) return

    if (useSessions.getState().currentSession?.id !== id) {
      setFailedSessionID(id)
      return
    }

    // Re-fetch pending permissions/questions from the server to recover from
    // missed SSE events or failed optimistic removals.
    const connState = useConnections.getState()
    const c = directory ? (connState.clientForDirectory(directory) ?? connState.client) : connState.client
    if (c) refreshPending(c, id)
  }, [id, directory, selectSession])

  useFocusEffect(
    useCallback(() => {
      if (!id) return
      const draft = useSessions.getState().drafts[id] || ""
      inputRef.current = draft
      setInputState(draft)
      void bindSession()
      return () => {
        bindingAttempt.current++
      }
    }, [id, bindSession]),
  )

  // Sync model chip from latest assistant message
  useEffect(() => {
    if (!transcriptBound) return
    if (id && sessionModels[id]) {
      setModel(sessionModels[id])
      return
    }
    if (!messages || messages.length === 0) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant" && msg.providerID && msg.modelID) {
        const selection = { providerID: msg.providerID, modelID: msg.modelID }
        setModel(selection)
        if (id) setSessionModel(id, selection)
        return
      }
      if (msg.role === "user" && msg.model) {
        setModel(msg.model)
        if (id) setSessionModel(id, msg.model)
        return
      }
    }
  }, [transcriptBound, id, currentSession?.id, messages?.length, sessionModels, setModel, setSessionModel])

  // Slash command handler
  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.type === "builtin") {
        switch (cmd.trigger) {
          case "new":
            router.back()
            return
          case "model":
            setInput("")
            modelSheetRef.current?.expand()
            return
          case "agent":
            setInput("")
            cycleAgent()
            return
        }
      }
      setInput(`/${cmd.trigger} `)
    },
    [router, cycleAgent],
  )

  const handleMentionSelect = useCallback((path: string) => {
    const range = activeMention(inputRef.current, selection.start)
    if (!range) return
    const result = insertMention(inputRef.current, range, path)
    setInput(result.text)
    setSelection({ start: result.cursor, end: result.cursor })
    setSelectedMentions((current) => current.includes(path) ? current : [...current, path])
    setMentionFiles([])
  }, [selection.start, setInput])

  // --- Image picking ---

  // Convert any image (including HEIC/HEIF from iOS) to guaranteed JPEG bytes
  const MAX_DIMENSION = 1568 // Anthropic recommended max
  async function toJpeg(uri: string, width: number, height: number): Promise<Attachment> {
    const actions: ImageManipulator.Action[] = []
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height)
      actions.push({ resize: { width: Math.round(width * scale), height: Math.round(height * scale) } })
    }
    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.8,
      base64: true,
    })
    return {
      uri: result.uri,
      mime: "image/jpeg",
      filename: "image.jpg",
      width: result.width,
      height: result.height,
      base64: result.base64 || undefined,
    }
  }

  const pickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 1, // full quality - we compress in manipulator
    })
    if (result.canceled) return
    const settled = await Promise.allSettled(result.assets.map((a) => toJpeg(a.uri, a.width, a.height)))
    const items = settled.filter((r) => r.status === "fulfilled").map((r) => r.value)
    if (items.length) setAttachments((prev) => [...prev, ...items])
    if (settled.some((r) => r.status === "rejected")) {
      console.error(
        "Failed to process image(s):",
        settled.filter((r) => r.status === "rejected").map((r) => r.reason),
      )
      Alert.alert(t("session.alerts.imageFailedTitle"), t("session.alerts.imageFailedMessage"))
    }
  }, [t])

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t("session.alerts.cameraPermissionTitle"), t("session.alerts.cameraPermissionMessage"))
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 })
    if (result.canceled) return
    const a = result.assets[0]
    try {
      const item = await toJpeg(a.uri, a.width, a.height)
      setAttachments((prev) => [...prev, item])
    } catch (err) {
      console.error("Failed to process photo:", err)
      Alert.alert(t("session.alerts.imageFailedTitle"), t("session.alerts.imageFailedMessage"))
    }
  }, [t])

  const pasteFromClipboard = useCallback(async () => {
    // Try image first
    const hasImage = await Clipboard.hasImageAsync()
    if (hasImage) {
      const img = await Clipboard.getImageAsync({ format: "png" })
      if (img?.data) {
        const uri = img.data.startsWith("data:") ? img.data : `data:image/png;base64,${img.data}`
        const item = await toJpeg(uri, img.size.width, img.size.height)
        setAttachments((prev) => [...prev, item])
        return
      }
    }
    // Fall back to text
    const hasText = await Clipboard.hasStringAsync()
    if (hasText) {
      const text = await Clipboard.getStringAsync()
      if (text) {
        setInput((prev) => prev + text)
        return
      }
    }
    Alert.alert(t("session.alerts.emptyClipboardTitle"), t("session.alerts.emptyClipboardMessage"))
  }, [t])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // --- Send ---
  const handleSend = async () => {
    if (!transcriptBound) return
    if (!input.trim() && attachments.length === 0 && fileContexts.length === 0) return
    const authenticated = await authenticateForMessage()
    if (!authenticated) {
      Alert.alert(t("session.alerts.authRequiredTitle"), t("session.alerts.authRequiredMessage"))
      return
    }

    const text = input.trim()
    const files = [...attachments]
    const comments = [...fileContexts]
    const references: PromptFileReference[] = []
    for (const path of selectedMentions) {
      const value = `@${path}`
      let offset = 0
      while (true) {
        const start = text.indexOf(value, offset)
        if (start < 0) break
        references.push({ path, text: value, start, end: start + value.length })
        offset = start + value.length
      }
    }
    references.push(...comments)
    setInput("")
    if (id) clearDraft(id)
    setAttachments([])
    setSelectedMentions([])

    // Server slash commands (no attachments for commands)
    if (text.startsWith("/") && files.length === 0 && references.length === 0) {
      const [cmdName, ...args] = text.split(" ")
      const name = cmdName.slice(1)
      const match = serverCommands.find((c) => c.name === name)
      if (match && sessionClient && currentSession) {
        sessionClient.session
          .command(currentSession.id, {
            command: name,
            arguments: args.join(" "),
            agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined,
          })
          .catch((err) => console.error("Command failed:", err))
        return
      }
    }

    // Messages are queued server-side when the session is busy.
    // No need to abort - just send and it will be processed after current response.
    try {
      await sendMessage(text, model || undefined, agent || undefined, files, variant || undefined, references)
      if (id) clearFileContexts(id)
    } catch (err) {
      console.error("Send failed:", err)
      // Restore the user's text and attachments so their input isn't lost.
      setInput((prev) => (prev ? prev : text))
      setAttachments((prev) => (prev.length ? prev : files))
      setSelectedMentions((prev) => prev.length ? prev : references.filter((item) => !item.comment).map((item) => item.path))
      const detail = err instanceof Error ? err.message : String(err)
      Alert.alert(t("session.alerts.sendFailedTitle"), `${t("session.alerts.sendFailedMessage")}\n\n${detail}`)
    }
  }

  // In inverted mode, offset 0 = bottom. Show scroll button when scrolled away from bottom.
  const handleScroll = useCallback((event: any) => {
    const { contentOffset } = event.nativeEvent
    scrollOffsetRef.current = contentOffset.y
    setShowScrollButton(shouldShowScrollButton(contentOffset.y))
  }, [])

  // Debounce: onEndReached can fire multiple times during a single scroll gesture
  const loadingTriggered = useRef(false)
  const handleLoadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loadingTriggered.current) {
      loadingTriggered.current = true
      loadOlderMessages()
    }
  }, [hasMore, loadingMore, loadOlderMessages])

  // Reset trigger when loading finishes
  useEffect(() => {
    if (!loadingMore) loadingTriggered.current = false
  }, [loadingMore])

  // Detect reconnecting → stable transition for the "Connected ✓" flash.
  // reconnectAttempts and lastDisconnectAt reset in the same set() call, so we
  // can't use lastDisconnectAt alone; a useRef tracks the prior reconnecting state.
  useEffect(() => {
    const isReconnecting = reconnectAttempts > 0
    if (prevReconnecting.current && !isReconnecting) {
      setShowConnectedFlash(true)
      const t = setTimeout(() => setShowConnectedFlash(false), 2000)
      return () => clearTimeout(t)
    }
    prevReconnecting.current = isReconnecting
  }, [reconnectAttempts])

  const handlePermissionReply = async (requestID: string, reply: "once" | "always" | "reject") => {
    if (!sessionClient || !sessionID) return
    // Snapshot for rollback
    const snapshot = useEvents.getState().permissions[sessionID] || []
    // Optimistically remove from UI
    useEvents.setState((state) => ({
      permissions: {
        ...state.permissions,
        [sessionID]: snapshot.filter((p) => p.id !== requestID),
      },
    }))
    try {
      await sessionClient.permission.reply(requestID, reply)
    } catch (err) {
      console.error("Permission reply failed:", err)
      // Restore the prompt so the user can retry
      useEvents.setState((state) => ({
        permissions: { ...state.permissions, [sessionID]: snapshot },
      }))
      Alert.alert(t("session.alerts.replyFailedTitle"), t("session.alerts.replyFailedMessage"))
    }
  }

  const handleQuestionReply = async (requestID: string, answers: string[][]) => {
    if (!sessionClient || !sessionID) return
    const snapshot = useEvents.getState().questions[sessionID] || []
    useEvents.setState((state) => ({
      questions: {
        ...state.questions,
        [sessionID]: snapshot.filter((q) => q.id !== requestID),
      },
    }))
    try {
      await sessionClient.question.reply(requestID, answers)
    } catch (err) {
      console.error("Question reply failed:", err)
      useEvents.setState((state) => ({
        questions: { ...state.questions, [sessionID]: snapshot },
      }))
      Alert.alert(t("session.alerts.replyFailedTitle"), t("session.alerts.replyFailedMessage"))
    }
  }

  const handleQuestionReject = async (requestID: string) => {
    if (!sessionClient || !sessionID) return
    const snapshot = useEvents.getState().questions[sessionID] || []
    useEvents.setState((state) => ({
      questions: {
        ...state.questions,
        [sessionID]: snapshot.filter((q) => q.id !== requestID),
      },
    }))
    try {
      await sessionClient.question.reject(requestID)
    } catch (err) {
      console.error("Question reject failed:", err)
      useEvents.setState((state) => ({
        questions: { ...state.questions, [sessionID]: snapshot },
      }))
      Alert.alert(t("session.alerts.rejectFailedTitle"), t("session.alerts.rejectFailedMessage"))
    }
  }

  const handleModelSelect = useCallback(
    (providerID: string, modelID: string) => {
      const selection = { providerID, modelID }
      setModel(selection)
      if (id) setSessionModel(id, selection)
    },
    [id, setModel, setSessionModel],
  )

  // Current agent display
  const currentAgent = agents.find((a) => a.name === agent)
  const agentColor = currentAgent?.color || "#8b5cf6"
  const modelLabel = model
    ? modelNameFor(providers, model.providerID, model.modelID) ||
      model.modelID.split("/").pop() ||
      model.modelID
    : "default"

  // Variants for current model (for reasoning effort picker)
  const currentModelVariants = useMemo(() => {
    if (!model) return undefined
    const provider = providers.find((p) => p.id === model.providerID)
    const found = provider?.models.find((m) => m.id === model.modelID)
    return found?.variants
  }, [model, providers])

  // "Back to main session" from a subagent transcript. Popping returns to the
  // parent screen we were pushed from; deep links (no history) push it instead.
  const backToParent = useCallback(() => {
    const parentID = currentSession?.parentID
    if (!parentID) return
    if (router.canGoBack()) {
      router.back()
      return
    }
    const directory = currentSession?.directory || ""
    router.push({ pathname: "/session/[id]", params: { id: parentID, ...(directory ? { directory } : {}) } })
  }, [currentSession?.parentID, currentSession?.directory, router])

  const headerRight = useCallback(
    () => (
      <View style={s.headerRight}>
        {shortDir && (
          <TouchableOpacity
            style={[s.dirBadge, isDark && s.dirBadgeDark]}
            onPress={() => router.push({ pathname: "/session-files", params: { id, directory: currentSession?.directory || directory || "" } })}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t("files.title")}
          >
            <Ionicons name="folder-outline" size={14} color={isDark ? "#888888" : "#666666"} />
            <Text style={[s.dirText, isDark && s.dirTextDark]}>{shortDir}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => {
            setShowInfo((value) => !value)
          }}
          hitSlop={8}
        >
          <Ionicons
            name={showInfo ? "stats-chart" : "stats-chart-outline"}
            size={20}
            color={showInfo ? "#3b82f6" : isDark ? "#888888" : "#666666"}
          />
        </TouchableOpacity>
      </View>
    ),
    [currentSession?.directory, directory, id, isDark, router, shortDir, showInfo],
  )

  const screenOptions = useMemo(
    () => ({
      title: transcriptBound
        ? childSessionTitle(currentSession?.title) || t("session.titleFallback")
        : t("session.titleFallback"),
      headerRight: transcriptBound ? headerRight : undefined,
    }),
    [currentSession?.title, headerRight, t, transcriptBound],
  )

  return (
    <>
      <Stack.Screen options={screenOptions} />

      <KeyboardAvoidingView
        style={[s.container, isDark && s.containerDark]}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "android" ? 48 : 90}
      >
        {/* Session info pulldown */}
        {transcriptBound && (
          <SessionInfo
            session={currentSession}
            messages={messages || []}
            providers={providers}
            visible={showInfo}
            isDark={isDark}
            hasMore={hasMore}
            loadingAll={loadingMore}
            onLoadAll={() => {
              if (hasMore && !loadingMore) loadOlderMessages()
            }}
            onScrollToTop={() => {
              flatListRef.current?.scrollToEnd({ animated: true })
            }}
            onClose={() => setShowInfo(false)}
            client={sessionClient}
          />
        )}

        {/* SSE reconnect/connected banner */}
        {reconnectAttempts > 0 && (
          <View style={[s.banner, s.bannerReconnecting]}>
            <Text style={s.bannerText}>{t("session.banners.reconnecting", { attempt: reconnectAttempts })}</Text>
          </View>
        )}
        {showConnectedFlash && reconnectAttempts === 0 && (
          <View style={[s.banner, s.bannerConnected]}>
            <Text style={s.bannerText}>{t("session.banners.connected")}</Text>
          </View>
        )}

        {/* Pending revert (from "Edit message") — offer a way back before it's
            cleaned up by the next prompt. */}
        {transcriptBound && revertMessageID && (
          <View style={[s.banner, s.bannerRevert]}>
            <Text style={s.bannerText}>{t("session.banners.reverted")}</Text>
            <TouchableOpacity
              onPress={() => {
                unrevertSession()
                // The composer was prefilled with the reverted message's text/
                // attachments (see applyRevertResult) — clear it so Undo doesn't
                // leave a stale draft that could be sent as a duplicate.
                setInput("")
                setAttachments([])
              }}
              hitSlop={8}
            >
              <Text style={s.bannerAction}>{t("session.banners.undo")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {routeState === "binding" ? (
          <View style={s.loading}>
            <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
          </View>
        ) : routeState === "failed" ? (
          <View style={s.loadFailed}>
            <Ionicons name="alert-circle-outline" size={44} color="#ef4444" />
            <Text style={[s.loadFailedText, isDark && s.textWhite]}>{error || t("common.error")}</Text>
            <View style={s.loadFailedActions}>
              <TouchableOpacity style={[s.loadFailedButton, isDark && s.loadFailedButtonDark]} onPress={bindSession}>
                <Text style={[s.loadFailedButtonText, isDark && s.textWhite]}>{t("common.retry")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.loadFailedButton, isDark && s.loadFailedButtonDark]} onPress={() => router.back()}>
                <Text style={[s.loadFailedButtonText, isDark && s.textWhite]}>{t("common.back")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={s.listWrap}>
            <FlatList
              ref={flatListRef}
              data={messageData}
              inverted
              keyExtractor={(item) => item.message.id}
              renderItem={({ item }) => (
                <MessageBubble
                  message={item.message}
                  parts={item.parts}
                  isDark={isDark}
                  reviewDiffs={item.reviewDiffs}
                  onLongPress={handleMessageLongPress}
                />
              )}
              contentContainerStyle={s.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              // Prevent jump when older messages are prepended
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              ListFooterComponent={
                loadingMore ? (
                  <View style={s.loadingMore}>
                    <ActivityIndicator size="small" color={isDark ? "#888888" : "#666666"} />
                    <Text style={[s.loadingMoreText, isDark && s.metaDark]}>{t("session.loadingOlder")}</Text>
                  </View>
                ) : null
              }
            />
            {/* Empty state rendered OUTSIDE the inverted list to avoid the
                inverted transform mirroring its text/icon (see #ui-mirror). */}
            {messageData.length === 0 && (
              <View style={s.emptyOverlay} pointerEvents="none">
                <Ionicons name="chatbubble-outline" size={48} color={isDark ? "#444444" : "#cccccc"} />
                <Text style={[s.emptyText, isDark && s.metaDark]}>{t("session.empty.title")}</Text>
                <Text style={[s.emptyHint, isDark && s.metaDark]}>{t("session.empty.hint")}</Text>
              </View>
            )}
            {showScrollButton && (
              <TouchableOpacity style={[s.scrollBtn, isDark && s.scrollBtnDark]} onPress={() => scrollToBottom(true)}>
                <Ionicons name="chevron-down" size={24} color={isDark ? "#ffffff" : "#0a0a0a"} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Status */}
        {transcriptBound && currentSession && <StatusIndicator sessionID={currentSession.id} isDark={isDark} />}

        {/* Permissions */}
        {transcriptBound && permissions.map((perm) => (
          <PermissionPrompt
            key={perm.id}
            permission={perm}
            isDark={isDark}
            onReply={(reply) => handlePermissionReply(perm.id, reply)}
          />
        ))}

        {/* Questions */}
        {transcriptBound && questions.map((q) => (
          <QuestionPrompt
            key={q.id}
            request={q}
            isDark={isDark}
            onReply={(answers) => handleQuestionReply(q.id, answers)}
            onReject={() => handleQuestionReject(q.id)}
          />
        ))}

        {/* Slash popover */}
        {transcriptBound && slashActive && (
          <SlashPopover query={slashQuery} commands={allCommands} isDark={isDark} onSelect={handleSlashSelect} />
        )}
        {transcriptBound && !slashActive && mention && (
          <FileMentionPopover files={mentionFiles} loading={mentionLoading} isDark={isDark} onSelect={handleMentionSelect} />
        )}

        {/* Subagent session — composer replaced by a read-only notice */}
        {transcriptBound && isChildSession && (
          <View style={[s.childBar, isDark && s.childBarDark, { paddingBottom: Math.max(12, insets.bottom) }]}>
            <Ionicons name="git-network-outline" size={14} color={isDark ? "#9a9a9a" : "#666666"} />
            <Text style={[s.childText, isDark && s.metaDark]} numberOfLines={2}>
              {t("session.child.promptDisabled")}
            </Text>
            <TouchableOpacity style={[s.childBackBtn, isDark && s.childBackBtnDark]} onPress={backToParent}>
              <Ionicons name="arrow-undo-outline" size={13} color={isDark ? "#e5e5e5" : "#0a0a0a"} />
              <Text style={[s.childBackText, isDark && s.textWhite]}>{t("session.child.backToParent")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Agent/model toolbar */}
        {transcriptBound && !isChildSession && (
          <View style={[s.toolbar, isDark && s.toolbarDark]}>
            <TouchableOpacity
              style={[s.agentChip, { borderColor: agentColor }]}
              onPress={() => cycleAgent()}
              onLongPress={() => cycleAgent(-1)}
            >
              <View style={[s.agentDot, { backgroundColor: agentColor }]} />
              <Text style={[s.agentLabel, isDark && s.textWhite]}>{agent || "build"}</Text>
              <Ionicons name="swap-horizontal-outline" size={12} color={isDark ? "#9a9a9a" : "#666666"} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.modelChip, isDark && s.modelChipDark]}
              onPress={() => modelSheetRef.current?.expand()}
              testID="model-chip"
            >
              <Ionicons name="hardware-chip-outline" size={14} color={isDark ? "#9a9a9a" : "#666666"} />
              <Text style={[s.modelLabel, isDark && s.metaDark]} numberOfLines={1}>
                {modelLabel}
              </Text>
            </TouchableOpacity>

            {currentModelVariants && Object.keys(currentModelVariants).length > 0 && (
              <TouchableOpacity
                style={[s.variantChip, isDark && s.variantChipDark, variant && s.variantChipActive]}
                onPress={() => variantSheetRef.current?.expand()}
                testID="variant-chip"
              >
                <Ionicons
                  name="flash-outline"
                  size={14}
                  color={variant ? "#8b5cf6" : isDark ? "#888888" : "#666666"}
                />
                <Text
                  style={[s.variantLabel, isDark && s.metaDark, variant && s.variantLabelActive]}
                  numberOfLines={1}
                >
                  {variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : t("session.toolbar.auto")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Attachment preview */}
        {transcriptBound && <ImageAttachments attachments={attachments} isDark={isDark} onRemove={removeAttachment} />}
        {transcriptBound && <FileContextChips contexts={fileContexts} isDark={isDark} onRemove={(index) => id && removeFileContext(id, index)} />}

        {/* Input */}
        {transcriptBound && !isChildSession && (
          <View
            style={[s.inputContainer, isDark && s.inputContainerDark, { paddingBottom: Math.max(12, insets.bottom) }]}
          >
            <View style={s.inputRow}>
            {/* Attach button */}
            <TouchableOpacity style={s.attachBtn} onPress={pickFromLibrary} onLongPress={pickFromCamera}>
              <Ionicons name="add-circle-outline" size={26} color={isDark ? "#888888" : "#666666"} />
            </TouchableOpacity>

            {/* Clipboard paste button */}
            <TouchableOpacity style={s.attachBtn} onPress={pasteFromClipboard}>
              <Ionicons name="clipboard-outline" size={22} color={isDark ? "#888888" : "#666666"} />
            </TouchableOpacity>

            <TextInput
              style={[s.input, isDark && s.inputDark, speech.listening && s.inputListening]}
              placeholder={
                speech.listening
                  ? t("session.input.placeholderListening")
                  : isSending
                    ? t("session.input.placeholderFollowUp")
                    : t("session.input.placeholderDefault")
              }
              placeholderTextColor={speech.listening ? "#ef4444" : isDark ? "#666666" : "#999999"}
              value={speech.listening ? speech.transcript : input}
              onChangeText={speech.listening ? undefined : setInput}
              selection={selection}
              onSelectionChange={(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => setSelection(event.nativeEvent.selection)}
              editable={!speech.listening}
              multiline
              maxLength={10000}
              testID="chat-message-input"
            />
            {/* Stop button: only when busy and no input */}
            {canStop && !input.trim() && attachments.length === 0 && !speech.listening && (
              <TouchableOpacity style={s.stopBtn} onPress={abortSession}>
                <Ionicons name="stop" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
            {/* Mic button: when no input, not sending, and not listening */}
            {!isSending && !input.trim() && attachments.length === 0 && !speech.listening && (
              <TouchableOpacity style={s.micBtn} onPress={speech.start}>
                <Ionicons name="mic" size={22} color={isDark ? "#888888" : "#666666"} />
              </TouchableOpacity>
            )}
            {/* Listening indicator: tap to stop */}
            {speech.listening && (
              <TouchableOpacity style={s.micBtnActive} onPress={speech.stop}>
                <Ionicons name="mic" size={22} color="#ffffff" />
              </TouchableOpacity>
            )}
            {/* Send button: when there's input */}
            {!speech.listening && (input.trim() || attachments.length > 0 || fileContexts.length > 0) && (
              <TouchableOpacity style={s.sendBtn} onPress={handleSend} testID="chat-send-button">
                <Ionicons name="send" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Model picker bottom sheet */}
      <ModelPicker
        sheetRef={modelSheetRef}
        providers={providers}
        selected={model}
        isDark={isDark}
        onSelect={handleModelSelect}
      />

      {/* Reasoning effort (variant) picker bottom sheet */}
      <VariantPicker
        sheetRef={variantSheetRef}
        variants={currentModelVariants}
        selected={variant}
        isDark={isDark}
        onSelect={setVariant}
      />

      {/* Selectable text modal for assistant copy */}
      <SelectableTextModal
        visible={selectableText !== null}
        text={selectableText ?? ""}
        onClose={() => setSelectableText(null)}
      />
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadFailed: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  loadFailedText: { color: "#0a0a0a", fontSize: 16, textAlign: "center" },
  loadFailedActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  loadFailedButton: {
    minWidth: 96,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#e5e5e5",
  },
  loadFailedButtonDark: { backgroundColor: "#2a2a2a" },
  loadFailedButtonText: { color: "#0a0a0a", fontSize: 15, fontWeight: "600" },
  listWrap: { flex: 1, position: "relative" },

  // Messages
  messageList: { padding: 16, paddingBottom: 8 },

  // Scroll button
  scrollBtn: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollBtnDark: { backgroundColor: "#2a2a2a" },

  // Loading more (appears at top in inverted list = ListFooterComponent)
  loadingMore: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  loadingMoreText: { fontSize: 13, color: "#999999" },

  // Empty state overlay — sits on top of the (empty) inverted list, untransformed,
  // so its text/icon render upright and un-mirrored on Android.
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },

  // Empty
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 64 },
  emptyText: { fontSize: 16, color: "#999999", marginTop: 12 },
  emptyHint: { fontSize: 13, color: "#bbbbbb", marginTop: 4 },
  metaDark: { color: "#9a9a9a" },
  textWhite: { color: "#ffffff" },

  // Toolbar
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  toolbarDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  agentDot: { width: 8, height: 8, borderRadius: 4 },
  agentLabel: { fontSize: 12, fontWeight: "600", color: "#0a0a0a" },
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modelChipDark: { backgroundColor: "#1a1a1a" },
  modelLabel: { fontSize: 12, color: "#666666", maxWidth: 160 },

  // Variant (reasoning effort) chip
  variantChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  variantChipDark: { backgroundColor: "#1a1a1a" },
  variantChipActive: { backgroundColor: "#f5f3ff" },
  variantLabel: { fontSize: 12, color: "#666666" },
  variantLabelActive: { color: "#8b5cf6" },

  // Subagent (child session) read-only bar
  childBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  childBarDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  childText: { fontSize: 12, color: "#666666", flex: 1 },
  childBackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  childBackBtnDark: { backgroundColor: "#1a1a1a" },
  childBackText: { fontSize: 12, fontWeight: "600", color: "#0a0a0a" },

  // Input
  inputContainer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  inputContainerDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  attachBtn: {
    width: 36,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
    color: "#0a0a0a",
  },
  inputDark: { backgroundColor: "#1a1a1a", color: "#ffffff" },
  inputListening: { borderWidth: 1, borderColor: "#ef4444" },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: "#cccccc" },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  micBtnActive: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  // Header
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  dirBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dirBadgeDark: { backgroundColor: "#1a1a1a" },
  dirText: { fontSize: 12, color: "#666666", fontWeight: "500" },
  dirTextDark: { color: "#888888" },

  // SSE reconnect/connected banner
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignItems: "center",
  },
  bannerReconnecting: { backgroundColor: "#92400e" },
  bannerConnected: { backgroundColor: "#065f46" },
  bannerText: { color: "#ffffff", fontSize: 13, fontWeight: "500" },

  // Pending revert (edit message) banner
  bannerRevert: {
    backgroundColor: "#1e3a8a",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  bannerAction: { color: "#93c5fd", fontSize: 13, fontWeight: "700" },
})
