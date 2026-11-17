/**
 * Fixed test vectors.
 *
 * Two kinds, and the page and README keep them apart:
 *
 *  - PUBLISHED vectors, from RFC 5869, FIPS 197 and NIST SP 800-38A. These are
 *    somebody else's answers and they pin the primitives.
 *
 *  - The two FIXED SCHEDULES below. Apple and Google's specification says its
 *    own test vectors are "available upon request" (v1.2, p.11) and publishes
 *    none, so there is no official schedule vector to check against. These were
 *    computed independently of this lab's code — with Node's `crypto` (OpenSSL)
 *    rather than WebCrypto — directly from the formulas in the specification and
 *    the white paper. They are a cross-implementation agreement, NOT an
 *    authority. If an official set ever appears and disagrees, it wins.
 */

/** RFC 5869 Appendix A.1, test case 1. */
export const RFC5869_CASE1 = {
  ikm: '0b'.repeat(22),
  salt: '000102030405060708090a0b0c',
  info: 'f0f1f2f3f4f5f6f7f8f9',
  length: 42,
  okm:
    '3cb25f25faacd57a90434f64d0362f2a' +
    '2d2d0a90cf1a5a4c5db02d56ecc4c5bf' +
    '34007208d5b887185865',
} as const

/** RFC 5869 Appendix A.3, test case 3 — no salt, no info. */
export const RFC5869_CASE3 = {
  ikm: '0b'.repeat(22),
  salt: '',
  info: '',
  length: 42,
  okm:
    '8da4e775a563c18f715f802a063c5a31' +
    'b8a11f5c5ee1879ec3454e5f3c738d2d' +
    '9d201395faa4b61a96c8',
} as const

/** FIPS 197 Appendix C.1 — AES-128 of one block. */
export const FIPS197_C1 = {
  key: '000102030405060708090a0b0c0d0e0f',
  plaintext: '00112233445566778899aabbccddeeff',
  ciphertext: '69c4e0d86a7b0430d8cdb78070b4c55a',
} as const

/** NIST SP 800-38A F.5.1, CTR-AES128.Encrypt — four blocks. */
export const SP800_38A_F51 = {
  key: '2b7e151628aed2a6abf7158809cf4f3c',
  counter: 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
  plaintext:
    '6bc1bee22e409f96e93d7e117393172a' +
    'ae2d8a571e03ac9c9eb76fac45af8e51' +
    '30c81c46a35ce411e5fbc1191a0a52ef' +
    'f69f2445df4f9b17ad2b417be66c3710',
  ciphertext:
    '874d6191b620e3261bef6864990db6ce' +
    '9806f66b7970fdff8617187bb9fffdff' +
    '5ae4df3edbd5d35e5b4f09020db03eab' +
    '1e031dda2fbe03d1792170a0f3009cee',
} as const

/**
 * The Apple/Google fixed schedule. Start interval 2650032 is a multiple of 144
 * and is 2020-05-21T00:00:00Z.
 */
export const GAEN_SCHEDULE = {
  tek: '000102030405060708090a0b0c0d0e0f',
  startInterval: 2650032,
  rpik: '4c3615250075e094e42e1b72e538ded2',
  aemk: '3454dd8d8c8c835029754c15df6d44d7',
  firstPaddedBlock: '454e2d525049000000000000b06f2800',
  firstRpi: '4b0cf5c1f7df9c034746e5d13e84de55',
  secondRpi: '8bb413946aadb7085c53e636b24f2892',
  lastInterval: 2650175,
  lastPaddedBlock: '454e2d5250490000000000003f702800',
  lastRpi: 'ab873398fbc3c137ccfb766a4da39e9f',
  /** SHA-256 over the 144 identifiers concatenated in interval order. */
  dayDigest: 'f094836c0232c429e42ff6f0430c54d21e97c8b0ceb54fec3941a9a8d4cf9437',
  /** Metadata 40 f8 00 00 = version 1.0, transmit power -8 dBm. */
  metadata: '40f80000',
  metadataCiphertext: '4472d2ef',
  /** Bit 0x10 of ciphertext byte 1, flipped: -8 dBm reads as -24 dBm. */
  metadataFlippedPlaintext: '40e80000',
} as const

/** The DP-3T low-cost schedule, under this lab's choices for H, PRF and PRG. */
export const DP3T_SCHEDULE = {
  seed0: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  seed1: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
  seed2: '2f287b4d3d4910f6cada9e1bd1b4648099e8c52c81aa4a6aebfa6fc86f19834e',
  broadcastKey0: 'b0912940a0c51ea8efb6d31397cab26767e95667f7ccca1b754c4cee774db972',
  day0First: '3a84e9f7ed7b85e0691d2b9fc9c23be1',
  day0Second: '741b0d80a98c8983ef8566f6434dd087',
  day0Last: '742721f7e38b53da157821c0a38036b7',
  /** SHA-256 over the 96 identifiers concatenated in GENERATION order. */
  day0Digest: '79f59d2f19942be50f61417ed31959ae7d3930e7e86d33b93cf93b441df202da',
  day1First: '00fd8dd699e9cdf4cfa5ff0b232c4f11',
  unlinkableSeed: '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f',
  unlinkableId: 'ca2a4fe727faaecf16ecd130a86e0885',
} as const
