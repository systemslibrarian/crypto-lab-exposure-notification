/**
 * The real primitives, all from WebCrypto: SHA-256, HMAC-SHA-256, AES-128 and
 * AES-256 in counter mode, and one AES-128 block.
 *
 * Nothing here is simulated. The only thing this file hand-rolls is the *shape*
 * of a single AES block out of counter mode, because WebCrypto exposes no ECB —
 * see `aesBlock` for why that identity is exact rather than an approximation.
 */

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto
  if (!c?.subtle) {
    throw new Error('WebCrypto SubtleCrypto is unavailable (a secure context is required)')
  }
  return c.subtle
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', data as BufferSource))
}

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await subtle().sign('HMAC', k, message as BufferSource))
}

/**
 * AES in counter mode. `counter` is the full 16-byte initial counter block and
 * the whole 128 bits increment, which is what OpenSSL, Java's `AES/CTR/NoPadding`
 * and the reference implementation all do. Key length picks AES-128 or AES-256.
 */
export async function aesCtr(
  key: Uint8Array,
  counter: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (counter.length !== 16) {
    throw new RangeError(`AES-CTR needs a 16-byte counter block, got ${counter.length}`)
  }
  if (key.length !== 16 && key.length !== 32) {
    throw new RangeError(`AES-CTR needs a 16- or 32-byte key, got ${key.length}`)
  }
  const k = await subtle().importKey('raw', key as BufferSource, 'AES-CTR', false, ['encrypt'])
  const out = await subtle().encrypt(
    { name: 'AES-CTR', counter: counter as BufferSource, length: 128 },
    k,
    data as BufferSource,
  )
  return new Uint8Array(out)
}

/**
 * One AES-128 block: `AES128(key, block)`, the spec's `AES128(RPIK, PaddedData)`.
 *
 * WebCrypto has no ECB, so this uses counter mode with the block ITSELF as the
 * initial counter and a single block of zeros as the plaintext. Counter mode
 * emits `C = P XOR AES(key, counter)`, so with `P = 0^128` the output is exactly
 * `AES(key, block)` — an identity, not an approximation, and it never increments
 * the counter because only one block is consumed.
 *
 * (AES-CBC with a zero IV gives the same first block. Either is fine; this lab
 * uses the counter-mode route so the page runs one AES mode throughout.)
 */
export async function aesBlock(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  if (block.length !== 16) {
    throw new RangeError(`AES needs a 16-byte block, got ${block.length}`)
  }
  return aesCtr(key, block, new Uint8Array(16))
}
