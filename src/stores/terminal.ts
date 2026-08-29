import { create } from "zustand"
import type { PtyInfo } from "../lib/sdk"
import { useConnections } from "./connections"

interface TerminalState {
  sessions: PtyInfo[]
  activeID: string | null
  output: Record<string, string>
  loading: boolean
  error: string | null
  load: () => Promise<void>
  create: () => Promise<void>
  remove: (id: string) => Promise<void>
  select: (id: string) => void
  append: (id: string, text: string) => void
  clear: (id: string) => void
}

const MAX_OUTPUT = 100_000

export const useTerminal = create<TerminalState>((set, get) => ({
  sessions: [],
  activeID: null,
  output: {},
  loading: false,
  error: null,
  load: async () => {
    const client = useConnections.getState().client
    if (!client) return
    set({ loading: true, error: null })
    try {
      const sessions = (await client.pty.list()).filter((item) => item.status === "running")
      const currentID = get().activeID
      const activeID = currentID && sessions.some((item) => item.id === currentID) ? currentID : sessions[0]?.id || null
      set({ sessions, activeID, loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
  create: async () => {
    const client = useConnections.getState().client
    if (!client) return
    try {
      const info = await client.pty.create({ title: `Terminal ${get().sessions.length + 1}` })
      set((state) => ({ sessions: [...state.sessions, info], activeID: info.id, output: { ...state.output, [info.id]: "" }, error: null }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  remove: async (id) => {
    const client = useConnections.getState().client
    if (!client) return
    try {
      await client.pty.remove(id)
      set((state) => {
        const sessions = state.sessions.filter((item) => item.id !== id)
        return { sessions, activeID: state.activeID === id ? sessions[0]?.id || null : state.activeID }
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  select: (activeID) => set({ activeID }),
  append: (id, text) => set((state) => ({ output: { ...state.output, [id]: `${(state.output[id] || "") + text}`.slice(-MAX_OUTPUT) } })),
  clear: (id) => set((state) => ({ output: { ...state.output, [id]: "" } })),
}))
