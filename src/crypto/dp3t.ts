/**
 * The two DP-3T designs this lab builds.
 *
 * Source: DP-3T Project, "Decentralized Privacy-Preserving Proximity Tracing",
 * white paper of 25 May 2020. The low-cost design is pp.14-17, the unlinkable
 * design pp.17-19.
 *
 * THE WHITE PAPER DOES NOT FIX THE PRIMITIVES. It writes
 *
 *     EphID_1 || ... || EphID_n = PRG( PRF(SK_t, "broadcast key") )
 *
 * and names HMAC-SHA256 and "AES in counter mode" only as examples ("e.g."),
 * leaving H, PRF and PRG unspecified — which Vaudenay's analysis (ePrint
 * 2020/399) points out. So this lab CHOOSES, and the page says so:
 *
 *     H   = SHA-256
 *     PRF = HMAC-SHA-256, key SK_t, message the ASCII bytes "broadcast key"
 *     PRG = AES-256 in counter mode, keyed with the 32-byte PRF output,
 *           initial counter block of 16 zero bytes, encrypting zeros
 *     L   = 15 minutes, so n = (24*60)/15 = 96
 *
 * These choices are this lab's and match no deployed app. Nothing here should
 * be read as what any country's software did.
 */

import { sha256, hmacSha256, aesCtr } from './primitives'
import { utf8 } from './bytes'

/** Epoch length in minutes, the white paper's L. */
export const EPOCH_MINUTES = 15

/** n = (24 * 60) / L. (white paper, p.15) */
export const EPOCHS_PER_DAY = (24 * 60) / EPOCH_MINUTES

/** The white paper's fixed, public string. */
export const BROADCAST_KEY_STRING = 'broadcast key'

const BROADCAST_KEY = utf8(BROADCAST_KEY_STRING)

/** SK_t = H(SK_{t-1}), with H = SHA-256. (white paper, p.14) */
export async function advanceSeed(seed: Uint8Array): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new RangeError(`a DP-3T day seed is 32 bytes, got ${seed.length}`)
  }
  return sha256(seed)
}

/** PRF(SK_t, "broadcast key") — the 32-byte key the generator runs under. */
export async function broadcastKey(seed: Uint8Array): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new RangeError(`a DP-3T day seed is 32 bytes, got ${seed.length}`)
  }
  return hmacSha256(seed, BROADCAST_KEY)
}

/**
 * One day of identifiers in GENERATION order, low-cost design.
 *
 * The generator emits n*16 bytes and they are split into 16-byte chunks
 * (white paper, p.15). Generation order is not broadcast order — see
 * `randomBroadcastOrder`.
 */
export async function dayIdentifiers(
  seed: Uint8Array,
  count: number = EPOCHS_PER_DAY,
): Promise<Uint8Array[]> {
  const key = await broadcastKey(seed)
  const stream = await aesCtr(key, new Uint8Array(16), new Uint8Array(16 * count))
  const ids: Uint8Array[] = []
  for (let i = 0; i < count; i++) ids.push(stream.subarray(i * 16, i * 16 + 16))
  return ids
}

/**
 * The hash chain from a published seed forward.
 *
 * This is the whole of the linkage exhibit: a reporter uploads the seed of the
 * FIRST contagious day, and "everyone can compute all ephemeral identifiers
 * EphID broadcast by the COVID-19 positive user, starting from day t" (white
 * paper, p.16) — every later day included, because each day's seed is the hash
 * of the one before.
 */
export async function chainFrom(seed: Uint8Array, days: number): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  let current = seed
  for (let d = 0; d < days; d++) {
    out.push(current)
    current = await advanceSeed(current)
  }
  return out
}

/**
 * Unlinkable design: EphID_i = LEFTMOST128( H( seed_i ) ), with a fresh random
 * 32-byte seed for every epoch. (white paper, p.18)
 *
 * The server side is a Cuckoo filter over H(EphID || i); this lab does not build
 * it — see the page's "not built here" list.
 */
export async function unlinkableIdentifier(epochSeed: Uint8Array): Promise<Uint8Array> {
  if (epochSeed.length !== 32) {
    throw new RangeError(`an unlinkable-design epoch seed is 32 bytes, got ${epochSeed.length}`)
  }
  return (await sha256(epochSeed)).subarray(0, 16)
}
