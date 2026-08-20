import { Platform, StyleSheet, Text } from "react-native"

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"
const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "do", "else", "enum",
  "export", "extends", "false", "finally", "for", "from", "function", "if", "implements", "import", "in", "interface",
  "let", "new", "null", "of", "package", "private", "protected", "public", "return", "static", "super", "switch", "this",
  "throw", "true", "try", "type", "undefined", "var", "void", "while", "with", "yield",
])

interface Props {
  text: string
  isDark: boolean
}

export function HighlightedCode({ text, isDark }: Props) {
  const tokens = text.split(/(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g)
  return (
    <Text style={[s.base, isDark && s.baseDark]}>
      {tokens.map((token, index) => {
        const comment = token.startsWith("//") || token.startsWith("#")
        const string = /^["'`]/.test(token)
        const number = /^\d/.test(token)
        const keyword = KEYWORDS.has(token)
        return <Text key={index} style={comment ? s.comment : string ? s.string : number ? s.number : keyword ? s.keyword : undefined}>{token}</Text>
      })}
    </Text>
  )
}

const s = StyleSheet.create({
  base: { color: "#202020", fontFamily: mono, fontSize: 12, lineHeight: 20 },
  baseDark: { color: "#e5e5e5" },
  keyword: { color: "#8b5cf6", fontWeight: "600" },
  string: { color: "#059669" },
  number: { color: "#d97706" },
  comment: { color: "#7c8b7c", fontStyle: "italic" },
})
