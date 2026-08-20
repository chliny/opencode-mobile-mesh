import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { WideScroll } from "../WideScroll"
import { HighlightedCode } from "./HighlightedCode"

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

export interface SharedDiffLine {
  key: string
  type: "add" | "remove" | "context" | "header"
  text: string
  oldLine?: number
  newLine?: number
}

interface RowProps {
  line: SharedDiffLine
  isDark: boolean
  showLineNumbers?: boolean
  selected?: boolean
  onPress?: () => void
}

export function DiffLineRow({ line, isDark, showLineNumbers, selected, onPress }: RowProps) {
  const number = line.type === "remove" ? line.oldLine : line.newLine
  const content = (
    <View style={[
      s.line,
      line.type === "add" && (isDark ? s.addDark : s.add),
      line.type === "remove" && (isDark ? s.removeDark : s.remove),
      line.type === "header" && (isDark ? s.headerDark : s.header),
      selected && s.selected,
    ]}>
      {showLineNumbers && <Text style={[s.gutter, isDark && s.gutterDark]}>{number ?? ""}</Text>}
      <Text style={[s.prefix, isDark && s.prefixDark]}>
        {line.type === "add" ? "+" : line.type === "remove" ? "-" : line.type === "header" ? "@@" : " "}
      </Text>
      <View style={s.code}><HighlightedCode text={line.text || " "} isDark={isDark} /></View>
    </View>
  )
  return onPress ? <TouchableOpacity activeOpacity={0.75} onPress={onPress}>{content}</TouchableOpacity> : content
}

interface Props {
  lines: SharedDiffLine[]
  isDark: boolean
  maxHeight?: number
  showLineNumbers?: boolean
  selectedKeys?: ReadonlySet<string>
  onLinePress?: (line: SharedDiffLine) => void
}

export function DiffRenderer({ lines, isDark, maxHeight, showLineNumbers, selectedKeys, onLinePress }: Props) {
  if (lines.length === 0) return null
  return (
    <WideScroll style={maxHeight ? { maxHeight } : undefined} nestedScrollEnabled={maxHeight !== undefined} testID="diff-view-scroll">
      <View style={s.lines}>
        {lines.map((line) => (
          <DiffLineRow key={line.key} line={line} isDark={isDark} showLineNumbers={showLineNumbers} selected={selectedKeys?.has(line.key)} onPress={onLinePress ? () => onLinePress(line) : undefined} />
        ))}
      </View>
    </WideScroll>
  )
}

const s = StyleSheet.create({
  lines: { alignSelf: "flex-start", minWidth: "100%" },
  line: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 8, paddingVertical: 1, minHeight: 22 },
  add: { backgroundColor: "#dcfce7" }, addDark: { backgroundColor: "#052e16" },
  remove: { backgroundColor: "#fee2e2" }, removeDark: { backgroundColor: "#2a0a0a" },
  header: { backgroundColor: "#edf2ff" }, headerDark: { backgroundColor: "#182036" },
  selected: { backgroundColor: "#ddd6fe", borderLeftWidth: 3, borderLeftColor: "#8b5cf6" },
  gutter: { width: 48, paddingRight: 9, textAlign: "right", color: "#999999", fontFamily: mono, fontSize: 11, lineHeight: 20 }, gutterDark: { color: "#777777" },
  prefix: { width: 22, color: "#999999", fontFamily: mono, fontSize: 12, lineHeight: 20, textAlign: "center" }, prefixDark: { color: "#9a9a9a" },
  code: { flex: 1 },
})
