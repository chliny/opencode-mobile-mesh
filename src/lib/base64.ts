export function isStandardBase64(value: string): boolean {
  const input = value.replace(/\s/g, "")
  return input.length > 0 && input.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(input)
}
