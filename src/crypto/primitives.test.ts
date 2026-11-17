/**
 * CHECK A — the primitives, against published vectors.
 *
 * These are the only answers in this lab that someone else computed. If one of
 * them fails, nothing further in the suite means anything.
 */
import { describe, expect, it } from 'vitest'
import { aesBlock, aesCtr, hmacSha256, sha256 } from './primitives'
import { hkdf, hkdfExtract, hkdf16 } from './hkdf'
import { fromHex, toHex, bytesEqual, concatBytes, utf8, shortHex } from './bytes'
import { FIPS197_C1, RFC5869_CASE1, RFC5869_CASE3, SP800_38A_F51 } from './vectors'

describe('HKDF-SHA-256 (RFC 5869)', () => {
  it('matches test case 1 (with salt and info)', async () => {
    const out = await hkdf(
      fromHex(RFC5869_CASE1.ikm),
      fromHex(RFC5869_CASE1.salt),
      fromHex(RFC5869_CASE1.info),
      RFC5869_CASE1.length,
    )
    expect(toHex(out)).toBe(RFC5869_CASE1.okm)
  })

  it('matches test case 3 (no salt, no info)', async () => {
    const out = await hkdf(
      fromHex(RFC5869_CASE3.ikm),
      null,
      new Uint8Array(0),
      RFC5869_CASE3.length,
    )
    expect(toHex(out)).toBe(RFC5869_CASE3.okm)
  })

  it('treats an absent salt and an empty salt alike (RFC 5869 section 2.2)', async () => {
    const ikm = fromHex(RFC5869_CASE3.ikm)
    expect(toHex(await hkdfExtract(null, ikm))).toBe(toHex(await hkdfExtract(new Uint8Array(0), ikm)))
  })

  it('expands more than one hash block, so the counter really counts', async () => {
    // 42 bytes needs two rounds; a single-round expand would truncate at 32 and
    // the case-1 vector above would not reach its final six bytes.
    const out = await hkdf(fromHex(RFC5869_CASE1.ikm), fromHex(RFC5869_CASE1.salt), fromHex(RFC5869_CASE1.info), 42)
    expect(out.length).toBe(42)
  })

  it('refuses an output longer than 255 * HashLen', async () => {
    await expect(hkdf(new Uint8Array(16), null, new Uint8Array(0), 255 * 32 + 1)).rejects.toThrow(
      /cannot produce/,
    )
  })

  it('hkdf16 agrees with the general function for a 16-byte output', async () => {
    const ikm = fromHex('000102030405060708090a0b0c0d0e0f')
    const info = utf8('EN-RPIK')
    const general = await hkdf(ikm, null, info, 16)
    const fast = await hkdf16(ikm, info)
    expect(toHex(fast.okm)).toBe(toHex(general))
  })
})

describe('AES-128 (FIPS 197)', () => {
  it('matches Appendix C.1 for a single block', async () => {
    const out = await aesBlock(fromHex(FIPS197_C1.key), fromHex(FIPS197_C1.plaintext))
    expect(toHex(out)).toBe(FIPS197_C1.ciphertext)
  })

  it('refuses a block that is not 16 bytes', async () => {
    await expect(aesBlock(fromHex(FIPS197_C1.key), new Uint8Array(15))).rejects.toThrow(/16-byte block/)
  })
})

describe('AES-CTR (NIST SP 800-38A)', () => {
  it('matches F.5.1 across four blocks, so the counter increments correctly', async () => {
    const out = await aesCtr(
      fromHex(SP800_38A_F51.key),
      fromHex(SP800_38A_F51.counter),
      fromHex(SP800_38A_F51.plaintext),
    )
    expect(toHex(out)).toBe(SP800_38A_F51.ciphertext)
  })

  it('is its own inverse', async () => {
    const key = fromHex(SP800_38A_F51.key)
    const ctr = fromHex(SP800_38A_F51.counter)
    const pt = fromHex(SP800_38A_F51.plaintext)
    expect(toHex(await aesCtr(key, ctr, await aesCtr(key, ctr, pt)))).toBe(toHex(pt))
  })

  it('refuses a counter block that is not 16 bytes', async () => {
    await expect(aesCtr(fromHex(SP800_38A_F51.key), new Uint8Array(8), new Uint8Array(4))).rejects.toThrow(
      /16-byte counter/,
    )
  })
})

describe('SHA-256 and HMAC-SHA-256', () => {
  it('hashes the empty string to the published digest', async () => {
    expect(toHex(await sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches RFC 4231 test case 1 for HMAC-SHA-256', async () => {
    const mac = await hmacSha256(fromHex('0b'.repeat(20)), utf8('Hi There'))
    expect(toHex(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  })
})

describe('byte helpers', () => {
  it('round-trips hex', () => {
    const b = fromHex('00ff10abCDef')
    expect(toHex(b)).toBe('00ff10abcdef')
  })

  it('accepts the separators a reader pastes', () => {
    expect(toHex(fromHex('40 f8 00 00'))).toBe('40f80000')
    expect(toHex(fromHex('40:f8-00_00'))).toBe('40f80000')
  })

  it('rejects an odd number of digits', () => {
    expect(() => fromHex('abc')).toThrow(/odd number/)
  })

  it('rejects a non-hex character rather than parsing around it', () => {
    expect(() => fromHex('00gg')).toThrow(/not 0-9/)
  })

  it('rejects a 0x prefix instead of silently eating it', () => {
    expect(() => fromHex('0xff')).toThrow(/not 0-9/)
  })

  it('never calls different lengths equal', () => {
    expect(bytesEqual(fromHex('0011'), fromHex('001100'))).toBe(false)
  })

  it('compares every byte, not a prefix', () => {
    expect(bytesEqual(fromHex('00112233'), fromHex('00112234'))).toBe(false)
    expect(bytesEqual(fromHex('00112233'), fromHex('00112233'))).toBe(true)
  })

  it('concatenates in order', () => {
    expect(toHex(concatBytes(fromHex('00'), fromHex('11'), fromHex('2233')))).toBe('00112233')
  })

  it('keeps both ends when shortening, and never returns data', () => {
    const full = fromHex('000102030405060708090a0b0c0d0e0f')
    expect(shortHex(full)).toBe('00010203…0c0d0e0f')
    expect(shortHex(full)).not.toBe(toHex(full))
  })
})
