/**
 * Byte and hex helpers.
 *
 * Every identifier in this lab is 16 raw bytes. Hex is only ever a rendering of
 * them — nothing in the crypto path ever round-trips through a hex string, so a
 * casing or padding slip cannot change a derived value.
 */

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * Parse hex, strictly.
 *
 * Fails closed on odd length, on any non-hex character, and on whitespace other
 * than the separators a reader is likely to paste (spaces, newlines, tabs).
 * `0x` prefixes are NOT accepted: this lab's inputs are raw byte strings, and
 * silently eating a prefix is how a 16-byte field quietly becomes 15.
 */
export function fromHex(hex: string): Uint8Array {
  const compact = hex.replace(/[\s_:-]/g, '')
  if (compact.length % 2 !== 0) {
    throw new RangeError(`hex has an odd number of digits (${compact.length})`)
  }
  if (!/^[0-9a-fA-F]*$/.test(compact)) {
    throw new RangeError('hex contains a character that is not 0-9 or a-f')
  }
  const out = new Uint8Array(compact.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Constant-ish-time full-width equality. Length mismatch is never a match. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** UTF-8 encode. The spec's `info` strings and DP-3T's `"broadcast key"` are ASCII. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Shorten an identifier for display, keeping both ends.
 *
 * The full value always travels alongside this in the DOM for assistive
 * technology — see `ui/render.ts`. Never use the result as data.
 */
export function shortHex(bytes: Uint8Array, keep = 4): string {
  const hex = toHex(bytes)
  if (hex.length <= keep * 4) return hex
  return `${hex.slice(0, keep * 2)}…${hex.slice(-keep * 2)}`
}
