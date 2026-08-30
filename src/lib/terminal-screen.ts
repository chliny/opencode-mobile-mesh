export interface TerminalRun {
  text: string
  color: string
  bold: boolean
}

interface Cell {
  char: string
  color: string
  bold: boolean
}

const DEFAULT_COLOR = "#d4d4d4"
const COLORS = ["#000000", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf"]
const BRIGHT_COLORS = ["#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec"]

function blank(): Cell {
  return { char: " ", color: DEFAULT_COLOR, bold: false }
}

function color256(value: number): string {
  if (value < 16) return value < 8 ? COLORS[value] : BRIGHT_COLORS[value - 8]
  if (value < 232) {
    const index = value - 16
    const channel = (part: number) => part === 0 ? 0 : 55 + part * 40
    return `rgb(${channel(Math.floor(index / 36))},${channel(Math.floor(index / 6) % 6)},${channel(index % 6)})`
  }
  const shade = 8 + (value - 232) * 10
  return `rgb(${shade},${shade},${shade})`
}

function colorRgb(red: number, green: number, blue: number): string {
  return `rgb(${red},${green},${blue})`
}

export function terminalRuns(output: string, cols = 120): TerminalRun[][] {
  const rows: Cell[][] = [[blank()]]
  let row = 0
  let col = 0
  let color = DEFAULT_COLOR
  let bold = false
  let escape = ""
  let osc = false

  const ensure = (targetRow: number, targetCol: number) => {
    while (!rows[targetRow]) rows.push([])
    while (rows[targetRow].length <= targetCol) rows[targetRow].push(blank())
  }
  const move = (nextRow: number, nextCol: number) => {
    row = Math.max(0, nextRow)
    col = Math.max(0, Math.min(cols - 1, nextCol))
    ensure(row, col)
  }
  const param = (value: string, fallback = 1) => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }
  const sgr = (params: number[]) => {
    if (params.length === 0) params.push(0)
    for (let index = 0; index < params.length; index++) {
      const code = params[index]
      if (code === 0) {
        color = DEFAULT_COLOR
        bold = false
      } else if (code === 1) bold = true
      else if (code === 22) bold = false
      else if (code === 39) color = DEFAULT_COLOR
      else if (code >= 30 && code <= 37) color = COLORS[code - 30]
      else if (code >= 90 && code <= 97) color = BRIGHT_COLORS[code - 90]
      else if (code === 38 && params[index + 1] === 5) {
        color = color256(params[index + 2] ?? 7)
        index += 2
      } else if (code === 38 && params[index + 1] === 2) {
        color = colorRgb(params[index + 2] ?? 255, params[index + 3] ?? 255, params[index + 4] ?? 255)
        index += 4
      }
    }
  }
  const eraseLine = (mode: number) => {
    ensure(row, Math.max(col, cols - 1))
    if (mode === 2) rows[row] = []
    else if (mode === 1) for (let index = 0; index <= col; index++) rows[row][index] = blank()
    else for (let index = col; index < rows[row].length; index++) rows[row][index] = blank()
  }
  const eraseDisplay = (mode: number) => {
    if (mode === 2 || mode === 3) {
      rows.splice(0, rows.length, [])
      row = 0
      col = 0
      return
    }
    if (mode === 0) {
      eraseLine(0)
      for (let index = row + 1; index < rows.length; index++) rows[index] = []
    } else {
      for (let index = 0; index < row; index++) rows[index] = []
      eraseLine(1)
    }
  }
  const control = (sequence: string) => {
    const final = sequence[sequence.length - 1]
    const values = sequence.slice(0, -1).replace(/^\?/, "").split(";").map((value) => Number(value || 0))
    const first = values[0] || 0
    if (final === "m") return sgr(values)
    if (final === "A") return move(row - param(sequence.slice(0, -1)), col)
    if (final === "B") return move(row + param(sequence.slice(0, -1)), col)
    if (final === "C" || final === "a") return move(row, col + param(sequence.slice(0, -1)))
    if (final === "D") return move(row, col - param(sequence.slice(0, -1)))
    if (final === "G" || final === "`") return move(row, param(sequence.slice(0, -1)) - 1)
    if (final === "d") return move(param(sequence.slice(0, -1)) - 1, col)
    if (final === "H" || final === "f") return move((values[0] || 1) - 1, (values[1] || 1) - 1)
    if (final === "J") return eraseDisplay(first)
    if (final === "K") return eraseLine(first)
    if (final === "s" || final === "u") return
    if (final === "P") {
      ensure(row, cols - 1)
      rows[row].splice(col, param(sequence.slice(0, -1)))
      while (rows[row].length < cols) rows[row].push(blank())
    }
  }

  for (let index = 0; index < output.length; index++) {
    const char = output[index]
    if (osc) {
      if (char === "\u0007") osc = false
      else if (char === "\u001b" && output[index + 1] === "\\") {
        osc = false
        index++
      }
      continue
    }
    if (escape) {
      escape += char
      if (escape === "\u001b]") {
        osc = true
        escape = ""
      } else if (escape[1] === "[" && escape.length > 2 && /[@-~]/.test(char)) {
        control(escape.slice(2))
        escape = ""
      } else if (escape.length === 2 && char !== "[") {
        escape = ""
      }
      continue
    }
    if (char === "\u001b") {
      escape = char
      continue
    }
    if (char === "\r") {
      col = 0
      continue
    }
    if (char === "\n") {
      move(row + 1, col)
      continue
    }
    if (char === "\b") {
      col = Math.max(0, col - 1)
      continue
    }
    if (char === "\t") {
      col = Math.min(cols - 1, col + (8 - (col % 8)))
      ensure(row, col)
      continue
    }
    if (char < " " || char === "\u007f") continue
    ensure(row, col)
    rows[row][col] = { char, color, bold }
    col = Math.min(cols - 1, col + 1)
  }

  return rows.map((line) => {
    let end = line.length
    while (end > 0 && line[end - 1].char === " ") end--
    const runs: TerminalRun[] = []
    for (let index = 0; index < end; index++) {
      const cell = line[index]
      const previous = runs[runs.length - 1]
      if (previous && previous.color === cell.color && previous.bold === cell.bold) previous.text += cell.char
      else runs.push({ text: cell.char, color: cell.color, bold: cell.bold })
    }
    return runs
  })
}
