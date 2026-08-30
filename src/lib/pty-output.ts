export class PtyOutputDecoder {
  private readonly decoder = new TextDecoder()
  cursor = 0

  decode(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data)
    if (bytes.length === 0) return ""

    // PTY output is raw UTF-8. The only binary control frame currently sent by
    // the server is 0x00 followed by a JSON cursor metadata object.
    if (bytes[0] === 0) {
      const metadata = new TextDecoder().decode(bytes.slice(1))
      const match = metadata.match(/^\{"cursor":(-?\d+)\}$/)
      if (match) {
        this.cursor = Number(match[1])
        return ""
      }
    }
    return this.decoder.decode(bytes, { stream: true })
  }

  decodeText(data: string): string {
    return data
  }

  flush(): string {
    return this.decoder.decode()
  }
}
