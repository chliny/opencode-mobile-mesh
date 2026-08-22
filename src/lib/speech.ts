import { useState, useCallback, useRef, useEffect } from "react"
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition"

interface SpeechState {
  listening: boolean
  transcript: string
  error: SpeechError | null
}

export type SpeechErrorKind = "permission" | "network" | "service" | "audio" | "busy" | "client" | "unknown"

interface SpeechError {
  kind: SpeechErrorKind
  id: number
}

interface SpeechActions {
  start: () => Promise<void>
  stop: () => void
  cancel: () => void
}

export function useSpeech(onResult: (text: string) => void): SpeechState & SpeechActions {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState<SpeechError | null>(null)
  const pending = useRef("")
  const alive = useRef(true)
  const starting = useRef(false)
  const requestID = useRef(0)
  const errorID = useRef(0)

  const reportError = useCallback((kind: SpeechErrorKind) => {
    setError({ kind, id: ++errorID.current })
  }, [])

  useSpeechRecognitionEvent("start", () => {
    setListening(true)
    setError(null)
    setTranscript("")
    pending.current = ""
  })

  useSpeechRecognitionEvent("end", () => {
    setListening(false)
    // Deliver final transcript
    if (pending.current.trim()) {
      onResult(pending.current.trim())
    }
    setTranscript("")
    pending.current = ""
  })

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript || ""
    pending.current = text
    setTranscript(text)
  })

  useSpeechRecognitionEvent("error", (event) => {
    // These are expected when the user stops, cancels, or says nothing.
    if (event.error === "aborted" || event.error === "no-speech" || event.error === "speech-timeout") {
      setListening(false)
      return
    }
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      reportError("permission")
    } else if (event.error === "network") {
      reportError("network")
    } else if (event.error === "audio-capture") {
      reportError("audio")
    } else if (event.error === "busy") {
      reportError("busy")
    } else if (event.error === "client") {
      reportError("client")
    } else {
      reportError("unknown")
    }
    setListening(false)
  })

  const start = useCallback(async () => {
    if (!alive.current || starting.current) return
    setError(null)
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      reportError("service")
      return
    }
    const request = ++requestID.current
    starting.current = true
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    starting.current = false
    // Do not start native recognition after the screen was dismissed while
    // the permission prompt was open.
    if (!alive.current || request !== requestID.current) return
    if (!result.granted) {
      reportError("permission")
      return
    }
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
    })
  }, [reportError])

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop()
  }, [])

  const cancel = useCallback(() => {
    requestID.current += 1
    starting.current = false
    pending.current = ""
    ExpoSpeechRecognitionModule.abort()
    setListening(false)
    setTranscript("")
  }, [])

  // Stop the native recognition session when the screen unmounts — otherwise
  // the mic stays hot in the background. abort() is a no-op when not listening.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      requestID.current += 1
      starting.current = false
      ExpoSpeechRecognitionModule.abort()
    }
  }, [])

  return { listening, transcript, error, start, stop, cancel }
}
