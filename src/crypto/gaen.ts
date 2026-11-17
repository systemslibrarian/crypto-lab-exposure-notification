/**
 * The Apple/Google Exposure Notification key schedule.
 *
 * Sources, both read in full for this lab:
 *   - Apple and Google, "Exposure Notification — Cryptography Specification",
 *     v1.2, April 2020. Every formula below is that document's.
 *   - Google's reference implementation, `CRYPTO.md` in
 *     google/exposure-notifications-internals, which agrees with it.
 *
 * The four facts that are easy to get wrong, and where each is pinned:
 *   1. ENIntervalNumber = floor(unix seconds / 600).            (spec, p.6)
 *   2. A TEK is valid for TEKRollingPeriod = 144 intervals, and its start
 *      interval is a multiple of 144.                           (spec, p.6)
 *   3. The interval number goes into PaddedData LITTLE-endian — "ENIntervalNumber
 *      is encoded as a 32-bit (uint32_t) unsigned little-endian value" (spec,
 *      p.6), which the reference implementation's `ByteBuffer.allocate(16)
 *      .order(ByteOrder.LITTLE_ENDIAN)` matches.
 *   4. The six zero bytes sit BETWEEN "EN-RPI" and the interval number:
 *      PaddedData[0..5] = UTF8("EN-RPI"), [6..11] = 0, [12..15] = ENIN. (spec, p.7)
 */

import { aesBlock, aesCtr } from './primitives'
import { hkdf16, type Hkdf16Trace } from './hkdf'
import { utf8 } from './bytes'

/** TEKRollingPeriod. 144 ten-minute intervals = 24 hours. (spec, p.6) */
export const TEK_ROLLING_PERIOD = 144

/** Ten minutes, in seconds. The width of one ENIntervalNumber. */
export const INTERVAL_SECONDS = 600

/**
 * The matching tolerance, in intervals.
 *
 * NOT a parameter this lab invented: the specification fixes it on p.9, under
 * "Value Matching of Positive Users" — "A +/- two-hour tolerance window is
 * allowed between when a Rolling Proximity Identifier derived from the Diagnosis
 * Key was supposed to be broadcast, and the time at which it was scanned."
 * Two hours is 12 intervals of ten minutes.
 */
export const MATCH_TOLERANCE_INTERVALS = 12

const RPIK_INFO = utf8('EN-RPIK')
const AEMK_INFO = utf8('EN-AEMK')
const RPI_PREFIX = utf8('EN-RPI')

/** floor(unix seconds / 600). (spec, p.6) */
export function enIntervalNumber(unixSeconds: number): number {
  return Math.floor(unixSeconds / INTERVAL_SECONDS)
}

/** The start of the TEK period containing `interval`: floor(i/144)*144. (spec, p.6) */
export function alignToRollingPeriod(interval: number): number {
  return Math.floor(interval / TEK_ROLLING_PERIOD) * TEK_ROLLING_PERIOD
}

export interface TemporaryExposureKey {
  /** 16 bytes from a cryptographic RNG. (spec, p.6) */
  key: Uint8Array
  /** The ENIntervalNumber from which the key is valid. A multiple of 144. */
  startInterval: number
}

/**
 * Build a TEK record, refusing a start interval the spec does not allow.
 *
 * Fails closed rather than rounding: "All devices sharing the same
 * TEKRollingPeriod roll keys at the same time — at the beginning of an interval
 * whose ENIntervalNumber is a multiple of TEKRollingPeriod" (spec, p.5). A key
 * whose start is not aligned is not a key any device would have produced, and
 * quietly aligning it would hide the error in every identifier derived from it.
 */
export function temporaryExposureKey(key: Uint8Array, startInterval: number): TemporaryExposureKey {
  if (key.length !== 16) {
    throw new RangeError(`a Temporary Exposure Key is 16 bytes, got ${key.length}`)
  }
  if (!Number.isInteger(startInterval) || startInterval < 0) {
    throw new RangeError(`start interval must be a non-negative integer, got ${startInterval}`)
  }
  if (startInterval % TEK_ROLLING_PERIOD !== 0) {
    throw new RangeError(
      `start interval ${startInterval} is not a multiple of TEKRollingPeriod (${TEK_ROLLING_PERIOD}); ` +
        `the nearest aligned interval is ${alignToRollingPeriod(startInterval)}`,
    )
  }
  return { key, startInterval }
}

/** RPIK = HKDF(tek, NULL, UTF8("EN-RPIK"), 16). (spec, p.6) */
export async function rpiKey(tek: Uint8Array): Promise<Hkdf16Trace> {
  return hkdf16(tek, RPIK_INFO)
}

/** AEMK = HKDF(tek, NULL, UTF8("EN-AEMK"), 16). (spec, p.7) */
export async function aemKey(tek: Uint8Array): Promise<Hkdf16Trace> {
  return hkdf16(tek, AEMK_INFO)
}

/**
 * PaddedData for one interval. (spec, p.7)
 *
 * [0..5]   UTF8("EN-RPI")
 * [6..11]  six zero bytes
 * [12..15] the interval number, little-endian uint32
 */
export function paddedData(interval: number): Uint8Array {
  if (!Number.isInteger(interval) || interval < 0 || interval > 0xffffffff) {
    throw new RangeError(`interval number must fit a uint32, got ${interval}`)
  }
  const block = new Uint8Array(16)
  block.set(RPI_PREFIX, 0)
  // Bytes 6..11 are already zero. The interval occupies the last four, LE.
  new DataView(block.buffer).setUint32(12, interval, /* littleEndian */ true)
  return block
}

/** RPI(i,j) = AES128(RPIK, PaddedData(j)). (spec, p.7) */
export async function rollingProximityId(rpik: Uint8Array, interval: number): Promise<Uint8Array> {
  return aesBlock(rpik, paddedData(interval))
}

/** The 144 identifiers a TEK produces, in interval order. */
export async function dayOfIdentifiers(
  tek: TemporaryExposureKey,
): Promise<{ rpik: Uint8Array; aemk: Uint8Array; ids: Uint8Array[] }> {
  const rpik = (await rpiKey(tek.key)).okm
  const aemk = (await aemKey(tek.key)).okm
  const ids: Uint8Array[] = []
  for (let k = 0; k < TEK_ROLLING_PERIOD; k++) {
    ids.push(await rollingProximityId(rpik, tek.startInterval + k))
  }
  return { rpik, aemk, ids }
}

/**
 * Associated Encrypted Metadata = AES128-CTR(AEMK, RPI, Metadata). (spec, p.7)
 *
 * The RPI is the initial counter block. Counter mode is its own inverse here, so
 * the same call decrypts — which is exactly the point of exhibit 6: there is no
 * tag, no padding and no length check, so any 4 bytes decrypt to some other
 * 4 bytes and nothing can raise an error. The spec says as much on p.9: "the
 * data has to be appropriately sanitized and validated as the Associated
 * Encrypted Metadata isn't authenticated."
 */
export async function associatedEncryptedMetadata(
  aemk: Uint8Array,
  rpi: Uint8Array,
  metadata: Uint8Array,
): Promise<Uint8Array> {
  return aesCtr(aemk, rpi, metadata)
}

/**
 * The 4 metadata bytes, as the Bluetooth Specification v1.2.2 lays them out
 * ("Advertising Payload", LSB first):
 *   byte 0 — versioning: bits 7:6 major (01), bits 5:4 minor (00), 3:0 reserved
 *   byte 1 — transmit power level, a signed dBm value in [-127, +127]
 *   bytes 2,3 — reserved for future use
 */
export interface Metadata {
  versionByte: number
  /** Signed dBm, as byte 1 is interpreted. */
  txPowerDbm: number
}

export function encodeMetadata(m: Metadata): Uint8Array {
  if (m.txPowerDbm < -127 || m.txPowerDbm > 127) {
    throw new RangeError(`transmit power must be within -127..+127 dBm, got ${m.txPowerDbm}`)
  }
  return Uint8Array.of(m.versionByte & 0xff, m.txPowerDbm & 0xff, 0, 0)
}

export function decodeMetadata(bytes: Uint8Array): Metadata {
  if (bytes.length !== 4) {
    throw new RangeError(`metadata is 4 bytes, got ${bytes.length}`)
  }
  const raw = bytes[1] as number
  return {
    versionByte: bytes[0] as number,
    txPowerDbm: raw > 127 ? raw - 256 : raw,
  }
}

/** Major.minor from the version byte, per the Bluetooth spec's bit layout. */
export function metadataVersion(versionByte: number): string {
  return `${(versionByte >> 6) & 0b11}.${(versionByte >> 4) & 0b11}`
}
