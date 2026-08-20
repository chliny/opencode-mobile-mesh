import { View, StyleSheet } from "react-native"
import { computeDiff } from "./diff-compute"
import { ContentViewerButton } from "./ContentViewerButton"
import { DiffRenderer, type SharedDiffLine } from "../files/DiffRenderer"

export interface DiffLinesProps {
  lines: ReturnType<typeof computeDiff>
  isDark: boolean
  title?: string
  maxHeight?: number
}

interface Props {
  before: string
  after: string
  isDark: boolean
}

export function DiffView({ before, after, isDark }: Props) {
  const lines = computeDiff(before, after)

  return <DiffLinesView lines={lines} isDark={isDark} title="diff" />
}

export function DiffLinesView({ lines, isDark, title, maxHeight }: DiffLinesProps) {

  if (lines.length === 0) return null

  const fullDiff = lines.map((line) => `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.text}`).join("\n")

  const sharedLines: SharedDiffLine[] = lines.map((line, index) => ({ ...line, key: `${line.type}-${index}` }))
  return (
    <View style={[s.container, isDark && s.containerDark]}>
      <View style={s.header}>
        <ContentViewerButton title={title || "diff"} content={fullDiff} language="diff" isDark={isDark} />
      </View>
      <DiffRenderer lines={sharedLines} isDark={isDark} maxHeight={maxHeight} />
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#f8f8f8",
    marginTop: 6,
  },
  containerDark: { backgroundColor: "#1a1a1a" },
  header: { alignItems: "flex-end", paddingHorizontal: 8, paddingTop: 6 },

})
