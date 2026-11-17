/**
 * CHECK B — the Apple/Google key schedule.
 *
 * The expected values come from `vectors.ts`, computed from the specification's
 * formulas with a different crypto stack (Node's OpenSSL) before this module was
 * written. Several tests additionally RE-DERIVE the answer here by a different
 * route than `gaen.ts` takes — a hand-built padded block, AES through CBC
 * instead of CTR — because a test that reruns the source's own expression
 * agrees with the source's own bugs.
 */
import { describe, expect, it } from 'vitest'
import {
  MATCH_TOLERANCE_INTERVALS,
  TEK_ROLLING_PERIOD,
  aemKey,
  alignToRollingPeriod,
  associatedEncryptedMetadata,
  dayOfIdentifiers,
  decodeMetadata,
  encodeMetadata,
  enIntervalNumber,
  metadataVersion,
  paddedData,
  rollingProximityId,
  rpiKey,
  temporaryExposureKey,
} from './gaen'
import { sha256 } from './primitives'
import { concatBytes, fromHex, toHex, utf8 } from './bytes'
import { GAEN_SCHEDULE } from './vectors'

const TEK = fromHex(GAEN_SCHEDULE.tek)

/**
 * An independent AES-128 single block: CBC with a zero IV, first block out.
 * `gaen.ts` reaches the same value through counter mode; if those two ever
 * disagree, one of them is wrong.
 */
async function aesBlockViaCbc(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt'])
  const out = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new Uint8Array(16) },
    k,
    block as BufferSource,
  )
  return new Uint8Array(out).subarray(0, 16)
}

/** The padded block built by hand, without DataView, little-endian by arithmetic. */
function paddedDataByHand(interval: number): Uint8Array {
  const block = new Uint8Array(16)
  block.set(utf8('EN-RPI'), 0)
  block[12] = interval & 0xff
  block[13] = (interval >>> 8) & 0xff
  block[14] = (interval >>> 16) & 0xff
  block[15] = (interval >>> 24) & 0xff
  return block
}

describe('ENIntervalNumber and the rolling period', () => {
  it('cuts time into 10-minute intervals from the Unix epoch', () => {
    expect(enIntervalNumber(0)).toBe(0)
    expect(enIntervalNumber(599)).toBe(0)
    expect(enIntervalNumber(600)).toBe(1)
    expect(enIntervalNumber(601)).toBe(1)
  })

  it('places the schedule vector at 2020-05-21T00:00:00Z', () => {
    const seconds = GAEN_SCHEDULE.startInterval * 600
    expect(new Date(seconds * 1000).toISOString()).toBe('2020-05-21T00:00:00.000Z')
    expect(enIntervalNumber(seconds)).toBe(GAEN_SCHEDULE.startInterval)
  })

  it('uses a rolling period of 144 intervals, which is 24 hours', () => {
    expect(TEK_ROLLING_PERIOD).toBe(144)
    expect((TEK_ROLLING_PERIOD * 600) / 3600).toBe(24)
  })

  it('aligns an interval down to its rolling-period boundary', () => {
    expect(alignToRollingPeriod(2650032)).toBe(2650032)
    expect(alignToRollingPeriod(2650100)).toBe(2650032)
    expect(alignToRollingPeriod(2650175)).toBe(2650032)
    expect(alignToRollingPeriod(2650176)).toBe(2650176)
  })

  it('takes its matching tolerance from the specification, not from this lab', () => {
    // "A +/- two-hour tolerance window is allowed" (spec v1.2, p.9).
    expect(MATCH_TOLERANCE_INTERVALS).toBe(12)
    expect((MATCH_TOLERANCE_INTERVALS * 600) / 3600).toBe(2)
  })
})

describe('Temporary Exposure Key validation', () => {
  it('accepts an aligned start interval', () => {
    expect(temporaryExposureKey(TEK, 2650032).startInterval).toBe(2650032)
  })

  it('REFUSES a start interval that is not a multiple of 144, and says the aligned one', () => {
    expect(() => temporaryExposureKey(TEK, 2650033)).toThrow(/not a multiple of TEKRollingPeriod/)
    expect(() => temporaryExposureKey(TEK, 2650033)).toThrow(/2650032/)
  })

  it('refuses a key that is not 16 bytes', () => {
    expect(() => temporaryExposureKey(new Uint8Array(15), 2650032)).toThrow(/16 bytes/)
    expect(() => temporaryExposureKey(new Uint8Array(17), 2650032)).toThrow(/16 bytes/)
  })

  it('refuses a negative or fractional start interval', () => {
    expect(() => temporaryExposureKey(TEK, -144)).toThrow(/non-negative integer/)
    expect(() => temporaryExposureKey(TEK, 1.5)).toThrow(/non-negative integer/)
  })
})

describe('the derived keys', () => {
  it('derives RPIK with info "EN-RPIK"', async () => {
    expect(toHex((await rpiKey(TEK)).okm)).toBe(GAEN_SCHEDULE.rpik)
  })

  it('derives AEMK with info "EN-AEMK"', async () => {
    expect(toHex((await aemKey(TEK)).okm)).toBe(GAEN_SCHEDULE.aemk)
  })

  it('gives RPIK and AEMK different values from the same TEK', async () => {
    expect(toHex((await rpiKey(TEK)).okm)).not.toBe(toHex((await aemKey(TEK)).okm))
  })

  it('shares one extract step between them, as HKDF does', async () => {
    expect(toHex((await rpiKey(TEK)).prk)).toBe(toHex((await aemKey(TEK)).prk))
  })

  it('produces 16-byte keys', async () => {
    expect((await rpiKey(TEK)).okm.length).toBe(16)
    expect((await aemKey(TEK)).okm.length).toBe(16)
  })
})

describe('PaddedData', () => {
  it('matches the schedule vector for the first interval of the day', () => {
    expect(toHex(paddedData(GAEN_SCHEDULE.startInterval))).toBe(GAEN_SCHEDULE.firstPaddedBlock)
  })

  it('matches the schedule vector for the last interval of the day', () => {
    expect(toHex(paddedData(GAEN_SCHEDULE.lastInterval))).toBe(GAEN_SCHEDULE.lastPaddedBlock)
  })

  it('agrees with a hand-built block, so the DataView write is little-endian', () => {
    for (const j of [0, 1, 255, 256, 2650032, 2650175, 0xffffffff]) {
      expect(toHex(paddedData(j))).toBe(toHex(paddedDataByHand(j)))
    }
  })

  it('writes the interval LITTLE-endian — 2650032 is 0x00286fb0, stored b0 6f 28 00', () => {
    // 2650032 = 0x00286FB0. Little-endian puts the low byte first. The big-endian
    // spelling would be 00 28 6f b0, which is the mutation this test exists to kill.
    const block = paddedData(2650032)
    expect([block[12], block[13], block[14], block[15]]).toEqual([0xb0, 0x6f, 0x28, 0x00])
    expect(2650032).toBe(0x00286fb0)
  })

  it('puts "EN-RPI" first and SIX zero bytes after it', () => {
    const block = paddedData(2650032)
    expect(toHex(block.subarray(0, 6))).toBe(toHex(utf8('EN-RPI')))
    expect(toHex(block.subarray(6, 12))).toBe('000000000000')
  })

  it('is 16 bytes', () => {
    expect(paddedData(2650032).length).toBe(16)
  })

  it('refuses an interval that does not fit a uint32', () => {
    expect(() => paddedData(-1)).toThrow(/uint32/)
    expect(() => paddedData(0x1_0000_0000)).toThrow(/uint32/)
  })
})

describe('Rolling Proximity Identifiers', () => {
  it('matches the schedule vector at the first interval', async () => {
    const rpik = (await rpiKey(TEK)).okm
    expect(toHex(await rollingProximityId(rpik, 2650032))).toBe(GAEN_SCHEDULE.firstRpi)
  })

  it('matches the schedule vector at the second interval', async () => {
    const rpik = (await rpiKey(TEK)).okm
    expect(toHex(await rollingProximityId(rpik, 2650033))).toBe(GAEN_SCHEDULE.secondRpi)
  })

  it('matches the schedule vector at the last interval of the day', async () => {
    const rpik = (await rpiKey(TEK)).okm
    expect(toHex(await rollingProximityId(rpik, 2650175))).toBe(GAEN_SCHEDULE.lastRpi)
  })

  it('agrees with AES through CBC, an independent route to one block', async () => {
    const rpik = (await rpiKey(TEK)).okm
    for (const j of [2650032, 2650033, 2650100, 2650175]) {
      const viaCtr = await rollingProximityId(rpik, j)
      const viaCbc = await aesBlockViaCbc(rpik, paddedDataByHand(j))
      expect(toHex(viaCtr)).toBe(toHex(viaCbc))
    }
  })

  it('produces 144 distinct identifiers whose digest matches the schedule', async () => {
    const day = await dayOfIdentifiers(temporaryExposureKey(TEK, GAEN_SCHEDULE.startInterval))
    expect(day.ids).toHaveLength(144)
    expect(new Set(day.ids.map(toHex)).size).toBe(144)
    expect(toHex(await sha256(concatBytes(...day.ids)))).toBe(GAEN_SCHEDULE.dayDigest)
  })

  it('gives unrelated TEKs unrelated identifiers', async () => {
    const otherRpik = (await rpiKey(fromHex('0f0e0d0c0b0a09080706050403020100'))).okm
    const rpik = (await rpiKey(TEK)).okm
    expect(toHex(await rollingProximityId(otherRpik, 2650032))).not.toBe(
      toHex(await rollingProximityId(rpik, 2650032)),
    )
  })
})

describe('Associated Encrypted Metadata', () => {
  it('matches the schedule vector', async () => {
    const aemk = (await aemKey(TEK)).okm
    const rpi = fromHex(GAEN_SCHEDULE.firstRpi)
    const ct = await associatedEncryptedMetadata(aemk, rpi, fromHex(GAEN_SCHEDULE.metadata))
    expect(toHex(ct)).toBe(GAEN_SCHEDULE.metadataCiphertext)
  })

  it('uses the RPI as the counter block, so a different RPI gives different bytes', async () => {
    const aemk = (await aemKey(TEK)).okm
    const md = fromHex(GAEN_SCHEDULE.metadata)
    const underFirst = await associatedEncryptedMetadata(aemk, fromHex(GAEN_SCHEDULE.firstRpi), md)
    const underZero = await associatedEncryptedMetadata(aemk, new Uint8Array(16), md)
    expect(toHex(underFirst)).not.toBe(toHex(underZero))
  })

  it('CHECK G: flipping one ciphertext bit silently changes the transmit power', async () => {
    const aemk = (await aemKey(TEK)).okm
    const rpi = fromHex(GAEN_SCHEDULE.firstRpi)
    const ct = await associatedEncryptedMetadata(aemk, rpi, fromHex(GAEN_SCHEDULE.metadata))
    const tampered = Uint8Array.from(ct)
    tampered[1] = (tampered[1] as number) ^ 0x10

    // No error is raised, and nothing reports a failure: there is no tag.
    const out = await associatedEncryptedMetadata(aemk, rpi, tampered)
    expect(toHex(out)).toBe(GAEN_SCHEDULE.metadataFlippedPlaintext)

    // What changed is a reading a receiver would act on: -8 dBm became -24 dBm.
    expect(decodeMetadata(fromHex(GAEN_SCHEDULE.metadata)).txPowerDbm).toBe(-8)
    expect(decodeMetadata(out).txPowerDbm).toBe(-24)
    // The version byte survived untouched, so the frame still parses as valid.
    expect(decodeMetadata(out).versionByte).toBe(0x40)
  })

  it('is its own inverse, which is why the flip above decrypts at all', async () => {
    const aemk = (await aemKey(TEK)).okm
    const rpi = fromHex(GAEN_SCHEDULE.firstRpi)
    const md = fromHex(GAEN_SCHEDULE.metadata)
    const ct = await associatedEncryptedMetadata(aemk, rpi, md)
    expect(toHex(await associatedEncryptedMetadata(aemk, rpi, ct))).toBe(toHex(md))
  })
})

describe('metadata layout (Bluetooth Specification v1.2.2)', () => {
  it('encodes the version byte as major 01 in bits 7:6', () => {
    expect(toHex(encodeMetadata({ versionByte: 0x40, txPowerDbm: -8 }))).toBe('40f80000')
    expect(metadataVersion(0x40)).toBe('1.0')
  })

  it('round-trips a signed transmit power', () => {
    for (const dbm of [-127, -24, -8, 0, 1, 127]) {
      const bytes = encodeMetadata({ versionByte: 0x40, txPowerDbm: dbm })
      expect(decodeMetadata(bytes).txPowerDbm).toBe(dbm)
    }
  })

  it('refuses a transmit power outside the specified range', () => {
    expect(() => encodeMetadata({ versionByte: 0x40, txPowerDbm: 128 })).toThrow(/-127/)
    expect(() => encodeMetadata({ versionByte: 0x40, txPowerDbm: -128 })).toThrow(/-127/)
  })

  it('refuses metadata that is not 4 bytes', () => {
    expect(() => decodeMetadata(new Uint8Array(3))).toThrow(/4 bytes/)
    expect(() => decodeMetadata(new Uint8Array(5))).toThrow(/4 bytes/)
  })

  it('leaves bytes 2 and 3 reserved and zero', () => {
    const bytes = encodeMetadata({ versionByte: 0x40, txPowerDbm: -8 })
    expect(bytes[2]).toBe(0)
    expect(bytes[3]).toBe(0)
  })
})
