import assert from "node:assert/strict"
import test from "node:test"
import { PtyOutputDecoder } from "./pty-output.ts"
import { terminalRuns } from "./terminal-screen.ts"

function frame(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

test("decodes raw PTY output bytes", () => {
  const decoder = new PtyOutputDecoder()
  assert.equal(decoder.decode(frame("hello")), "hello")
})

test("preserves UTF-8 characters split across websocket frames", () => {
  const decoder = new PtyOutputDecoder()
  const bytes = new TextEncoder().encode("终端")
  const first = new Uint8Array([bytes[0], bytes[1]])
  const second = bytes.slice(2)
  assert.equal(decoder.decode(first.buffer), "")
  assert.equal(decoder.decode(second.buffer), "终端")
  assert.equal(decoder.flush(), "")
})

test("ignores non-output PTY frames", () => {
  const decoder = new PtyOutputDecoder()
  const metadata = new TextEncoder().encode('{"cursor":12}')
  assert.equal(decoder.decode(new Uint8Array([0, ...metadata]).buffer), "")
  assert.equal(decoder.cursor, 12)
})

test("preserves ANSI and OSC control sequences for terminal rendering", () => {
  const decoder = new PtyOutputDecoder()
  const text = "\u001b[1m➜\u001b[0m ~/project\u001b]2;title\u0007\n"
  assert.equal(decoder.decode(new TextEncoder().encode(text).buffer), text)
})

test("preserves ANSI sequences split across frames", () => {
  const decoder = new PtyOutputDecoder()
  assert.equal(decoder.decode(new TextEncoder().encode("hello\u001b[").buffer), "hello\u001b[")
  assert.equal(decoder.decode(new TextEncoder().encode("31mworld\u001b[0m").buffer), "31mworld\u001b[0m")
})

test("cleans text websocket frames", () => {
  const decoder = new PtyOutputDecoder()
  assert.equal(decoder.decodeText("\u001b[32m中文\u001b[0m\n"), "\u001b[32m中文\u001b[0m\n")
})

test("renders ANSI colors and terminal carriage returns", () => {
  const lines = terminalRuns("\u001b[31mred\u001b[0m\r\u001b[32mgreen\u001b[0m\n")
  assert.deepEqual(lines[0], [{ text: "green", color: "#4e9a06", bold: false }])
})

test("renders cursor movement without misaligning output", () => {
  const lines = terminalRuns("abc\u001b[2DXY")
  assert.deepEqual(lines[0], [{ text: "aXY", color: "#d4d4d4", bold: false }])
})

test("wraps printable output at the terminal column width", () => {
  const lines = terminalRuns("abcdef", 3)
  assert.deepEqual(lines.map((line) => line[0]?.text), ["abc", "def"])
})

test("starts a following newline at column zero after a wrapped line", () => {
  const lines = terminalRuns("abc\ndef", 3)
  assert.deepEqual(lines.map((line) => line[0]?.text), ["abc", "def"])
})

test("keeps wide CJK characters aligned to terminal cells", () => {
  const lines = terminalRuns("中ab", 4)
  assert.deepEqual(lines.map((line) => line.map((run) => run.text).join("")), ["中ab"])
})
