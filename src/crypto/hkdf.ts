/**
 * HKDF-SHA-256, RFC 5869, hand-rolled from HMAC.
 *
 * Hand-rolled on purpose: the Apple/Google key schedule IS the teaching subject
 * here, so the two HMAC calls that turn a 16-byte Temporary Exposure Key into
 * RPIK and AEMK have to be inspectable rather than hidden behind
 * `subtle.deriveBits`. The HMAC underneath is WebCrypto's.
 */

import { hmacSha256 } from './primitives'
import { concatBytes } from './bytes'

const HASH_LEN = 32

/** RFC 5869 §2.2. An absent or empty salt becomes HashLen zero bytes. */
export async function hkdfExtract(salt: Uint8Array | null, ikm: Uint8Array): Promise<Uint8Array> {
  const key = salt && salt.length > 0 ? salt : new Uint8Array(HASH_LEN)
  return hmacSha256(key, ikm)
}

/** RFC 5869 §2.3. T(i) = HMAC(PRK, T(i-1) || info || i), output truncated to `length`. */
export async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const n = Math.ceil(length / HASH_LEN)
  if (n > 255) throw new RangeError(`HKDF-Expand cannot produce ${length} bytes (max 255*HashLen)`)
  const out = new Uint8Array(length)
  let t: Uint8Array = new Uint8Array(0)
  let at = 0
  for (let i = 1; i <= n; i++) {
    t = await hmacSha256(prk, concatBytes(t, info, Uint8Array.of(i)))
    const take = Math.min(HASH_LEN, length - at)
    out.set(t.subarray(0, take), at)
    at += take
  }
  return out
}

/** Extract-then-expand, the whole function. */
export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  return hkdfExpand(await hkdfExtract(salt, ikm), info, length)
}

/**
 * The 16-byte case, kept separate because it is the one the key schedule uses
 * and because its single expand round is what the reference implementation
 * inlines (`hkdfSha256ExpandLength16`: "For length being 16 cases, counter
 * always equals to 0x01").
 *
 * Returning the intermediate PRK as well is what lets the page show the two
 * HMAC calls rather than assert them.
 */
export interface Hkdf16Trace {
  /** HMAC-SHA-256(salt = 32 zero bytes, TEK) — the extract step. */
  prk: Uint8Array
  /** HMAC-SHA-256(PRK, info || 0x01), truncated to 16 bytes — the expand step. */
  okm: Uint8Array
}

export async function hkdf16(ikm: Uint8Array, info: Uint8Array): Promise<Hkdf16Trace> {
  const prk = await hkdfExtract(null, ikm)
  const okm = (await hmacSha256(prk, concatBytes(info, Uint8Array.of(0x01)))).subarray(0, 16)
  return { prk, okm }
}
