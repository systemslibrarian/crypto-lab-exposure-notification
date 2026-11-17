/**
 * The only source of randomness in this lab, and an unbiased shuffle over it.
 *
 * Invariant 4: keys and seeds come from `crypto.getRandomValues`. Fixed vectors
 * reach the crypto only through tests and through the page's clearly labelled
 * "use test vector" control, which supplies bytes rather than replacing this.
 */

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  const c = globalThis.crypto
  if (!c?.getRandomValues) {
    throw new Error('crypto.getRandomValues is unavailable; refusing to invent key material')
  }
  c.getRandomValues(out)
  return out
}

/**
 * A uniform integer in [0, bound), by rejection sampling.
 *
 * `getRandomValues() % bound` is biased whenever `bound` does not divide 2^32,
 * and the bias is largest for the small bounds a 96-element shuffle uses most.
 * Rejecting the short tail removes it exactly.
 */
export function randomBelow(bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError(`bound must be a positive integer, got ${bound}`)
  }
  if (bound === 1) return 0
  const limit = Math.floor(0x1_0000_0000 / bound) * bound
  const buf = new Uint32Array(1)
  const c = globalThis.crypto
  for (;;) {
    c.getRandomValues(buf)
    const v = buf[0] as number
    if (v < limit) return v % bound
  }
}

/**
 * Fisher-Yates, using `randomBelow`, returning a new array.
 *
 * Used for the broadcast order: "Smartphones pick a random order in which to
 * broadcast the EphIDs during the day" (DP-3T white paper, p.15). The white
 * paper leans on that order — a published seed does not reveal WHEN within the
 * day each identifier went out, only that they are all one person's.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1)
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}
