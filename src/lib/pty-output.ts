export class PtyOutputDecoder {
  private readonly decoder = new TextDecoder()
  private control = ""

  decode(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data)
    if (bytes.length === 0) return ""

    // PTY output is raw UTF-8. The only binary control frame currently sent by
    // the server is 0x00 followed by a JSON cursor metadata object.
    if (bytes[0] === 0) {
      const metadata = new TextDecoder().decode(bytes.slice(1))
      if (/^\{"cursor":-?\d+\}$/.test(metadata)) return ""
    }
    return this.clean(this.decoder.decode(bytes, { stream: true }))
  }

  decodeText(data: string): string {
    return this.clean(data)
  }

  flush(): string {
    return this.clean(this.decoder.decode()) + this.clean(this.control, true)
  }

  private clean(text: string, final = false): string {
    let value = this.control + text
    this.control = ""
    let output = ""
    for (let index = 0; index < value.length; index++) {
      const char = value[index]
      if (char === "\u001b") {
        const next = value[index + 1]
        if (!next) {
          this.control = value.slice(index)
          break
        }
        if (next === "[") {
          const end = value.slice(index + 2).search(/[@-~]/)
          if (end < 0) {
            this.control = value.slice(index)
            break
          }
          index += end + 2
          continue
        }
        if (next === "]") {
          const end = value.indexOf("\u0007", index + 2)
          const st = value.indexOf("\u001b\\", index + 2)
          if (end < 0 && st < 0) {
            this.control = value.slice(index)
            break
          }
          index = (end >= 0 && (st < 0 || end < st) ? end : st + 1)
          continue
        }
        index += 1
        continue
      }
      if (char === "\u0000" || (char < " " && char !== "\n" && char !== "\r" && char !== "\t") || char === "\u007f") continue
      output += char
    }
    if (final) this.control = ""
    return output
  }
}
