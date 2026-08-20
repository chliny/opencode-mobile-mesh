import type { FileDiff, FileSelection, PromptFileReference, PromptPartInput } from "./sdk"

export interface ReviewLine {
  key: string
  type: "add" | "remove" | "context" | "header"
  text: string
  oldLine?: number
  newLine?: number
}

export function diffHunkStarts(lines: Array<{ type: "add" | "remove" | "context" | "header" }>): number[] {
  const starts: number[] = []
  let changed = false
  for (const [index, line] of lines.entries()) {
    if ((line.type === "add" || line.type === "remove") && !changed) {
      starts.push(index)
      changed = true
    } else if (line.type === "context" || line.type === "header") {
      changed = false
    }
  }
  return starts
}

export interface MentionRange {
  start: number
  end: number
  query: string
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const MAX_LINES = 1200

export function parseUnifiedPatch(patch: string): ReviewLine[] {
  const result: ReviewLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const [index, text] of patch.split(/\r?\n/).entries()) {
    if (result.length >= MAX_LINES) {
      result.push({ key: "truncated", type: "header", text: `... ${index + 1} lines, display truncated` })
      break
    }

    const match = text.match(HUNK)
    if (match) {
      oldLine = Number(match[1])
      newLine = Number(match[3])
      inHunk = true
      result.push({ key: `h-${index}`, type: "header", text })
      continue
    }
    if (!inHunk || text.startsWith("--- ") || text.startsWith("+++ ") || text.startsWith("diff ")) {
      if (text) result.push({ key: `m-${index}`, type: "header", text })
      continue
    }
    if (text.startsWith("\\ No newline")) continue
    if (text.startsWith("+")) {
      result.push({ key: `a-${newLine}-${index}`, type: "add", text: text.slice(1), newLine })
      newLine++
      continue
    }
    if (text.startsWith("-")) {
      result.push({ key: `r-${oldLine}-${index}`, type: "remove", text: text.slice(1), oldLine })
      oldLine++
      continue
    }
    result.push({ key: `c-${oldLine}-${newLine}-${index}`, type: "context", text: text.startsWith(" ") ? text.slice(1) : text, oldLine, newLine })
    oldLine++
    newLine++
  }
  return result
}

export function activeMention(text: string, cursor: number): MentionRange | null {
  const before = text.slice(0, cursor)
  const match = before.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null
  const query = match[1]
  const start = cursor - query.length - 1
  return { start, end: cursor, query }
}

export function insertMention(text: string, range: MentionRange, path: string): { text: string; cursor: number } {
  const value = `@${path}`
  const suffix = text.slice(range.end).startsWith(" ") ? "" : " "
  const next = text.slice(0, range.start) + value + suffix + text.slice(range.end)
  return { text: next, cursor: range.start + value.length + suffix.length }
}

export function groupDiffs(diffs: FileDiff[]): Array<{ status: "added" | "modified" | "deleted"; files: FileDiff[] }> {
  const order = ["modified", "added", "deleted"] as const
  return order
    .map((status) => ({ status, files: diffs.filter((diff) => (diff.status || "modified") === status && diff.file) }))
    .filter((group) => group.files.length > 0)
}

function fileUrl(directory: string, path: string, selection?: FileSelection): string {
  const absolute = path.startsWith("/") ? path : `${directory.replace(/\/$/, "")}/${path}`
  const encoded = absolute.split("/").map(encodeURIComponent).join("/")
  const query = selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""
  return `file://${encoded}${query}`
}

export function buildReferenceParts(directory: string, references: PromptFileReference[]): PromptPartInput[] {
  const parts: PromptPartInput[] = []
  for (const reference of references) {
    if (reference.comment && reference.selection) {
      const start = reference.selection.startLine
      const end = reference.selection.endLine
      parts.push({
        type: "text",
        text: `The user made the following comment regarding lines ${start} through ${end} of ${reference.path}: ${reference.comment}`,
        synthetic: true,
        metadata: {
          opencodeComment: {
            path: reference.path,
            selection: reference.selection,
            comment: reference.comment,
            preview: reference.preview,
            origin: reference.origin,
          },
        },
      })
    }
    parts.push({
      type: "file",
      mime: "text/plain",
      filename: reference.path.split("/").pop(),
      url: fileUrl(directory, reference.path, reference.selection),
      source: {
        type: "file",
        path: reference.path,
        text: { value: reference.text, start: reference.start, end: reference.end },
      },
    })
  }
  return parts
}
