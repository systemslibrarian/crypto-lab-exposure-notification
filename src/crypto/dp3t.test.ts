/**
 * CHECK C — the DP-3T designs, under this lab's declared choices for the
 * primitives the white paper leaves open.
 */
import { describe, expect, it } from 'vitest'
import {
  BROADCAST_KEY_STRING,
  EPOCHS_PER_DAY,
  EPOCH_MINUTES,
  advanceSeed,
  broadcastKey,
  chainFrom,
  dayIdentifiers,
  unlinkableIdentifier,
} from './dp3t'
import { sha256 } from './primitives'
import { concatBytes, fromHex, toHex } from './bytes'
import { randomBelow, randomBytes, shuffle } from './random'
import { DP3T_SCHEDULE } from './vectors'

const SK0 = fromHex(DP3T_SCHEDULE.seed0)

describe('epoch parameters', () => {
  it('uses L = 15 minutes, so n = (24 * 60) / L = 96', () => {
    expect(EPOCH_MINUTES).toBe(15)
    expect(EPOCHS_PER_DAY).toBe(96)
    expect(EPOCHS_PER_DAY).toBe((24 * 60) / EPOCH_MINUTES)
  })

  it('uses the white paper’s fixed public string verbatim', () => {
    expect(BROADCAST_KEY_STRING).toBe('broadcast key')
  })
})

describe('the day-seed hash chain', () => {
  it('matches the schedule at day 1', async () => {
    expect(toHex(await advanceSeed(SK0))).toBe(DP3T_SCHEDULE.seed1)
  })

  it('matches the schedule at day 2', async () => {
    expect(toHex(await advanceSeed(await advanceSeed(SK0)))).toBe(DP3T_SCHEDULE.seed2)
  })

  it('is exactly SHA-256, re-derived independently of the module', async () => {
    expect(toHex(await advanceSeed(SK0))).toBe(toHex(await sha256(SK0)))
  })

  it('really advances — SK_1 is not SK_0', async () => {
    expect(toHex(await advanceSeed(SK0))).not.toBe(toHex(SK0))
  })

  it('walks forward from a published seed, one hash per day', async () => {
    const chain = await chainFrom(SK0, 3)
    expect(chain.map(toHex)).toEqual([
      DP3T_SCHEDULE.seed0,
      DP3T_SCHEDULE.seed1,
      DP3T_SCHEDULE.seed2,
    ])
  })

  it('refuses a seed that is not 32 bytes', async () => {
    await expect(advanceSeed(new Uint8Array(16))).rejects.toThrow(/32 bytes/)
    await expect(advanceSeed(new Uint8Array(33))).rejects.toThrow(/32 bytes/)
  })
})

describe('the broadcast key (the PRF step)', () => {
  it('matches the schedule for SK_0', async () => {
    expect(toHex(await broadcastKey(SK0))).toBe(DP3T_SCHEDULE.broadcastKey0)
  })

  it('is not the seed itself — the PRF is not skippable', async () => {
    expect(toHex(await broadcastKey(SK0))).not.toBe(toHex(SK0))
  })

  it('refuses a seed that is not 32 bytes', async () => {
    await expect(broadcastKey(new Uint8Array(31))).rejects.toThrow(/32 bytes/)
  })
})

describe('low-cost design identifiers', () => {
  it('matches the schedule at day 0', async () => {
    const ids = await dayIdentifiers(SK0)
    expect(ids).toHaveLength(96)
    expect(toHex(ids[0] as Uint8Array)).toBe(DP3T_SCHEDULE.day0First)
    expect(toHex(ids[1] as Uint8Array)).toBe(DP3T_SCHEDULE.day0Second)
    expect(toHex(ids[95] as Uint8Array)).toBe(DP3T_SCHEDULE.day0Last)
  })

  it('matches the schedule digest over all 96 in generation order', async () => {
    const ids = await dayIdentifiers(SK0)
    expect(toHex(await sha256(concatBytes(...ids)))).toBe(DP3T_SCHEDULE.day0Digest)
  })

  it('matches the schedule at day 1, reached through the chain', async () => {
    const ids = await dayIdentifiers(await advanceSeed(SK0))
    expect(toHex(ids[0] as Uint8Array)).toBe(DP3T_SCHEDULE.day1First)
  })

  it('produces 96 distinct 16-byte identifiers', async () => {
    const ids = await dayIdentifiers(SK0)
    expect(new Set(ids.map(toHex)).size).toBe(96)
    for (const id of ids) expect(id.length).toBe(16)
  })

  it('gives different days completely different identifiers', async () => {
    const day0 = new Set((await dayIdentifiers(SK0)).map(toHex))
    const day1 = (await dayIdentifiers(await advanceSeed(SK0))).map(toHex)
    expect(day1.some((id) => day0.has(id))).toBe(false)
  })
})

describe('unlinkable design identifiers', () => {
  it('matches the schedule vector', async () => {
    expect(toHex(await unlinkableIdentifier(fromHex(DP3T_SCHEDULE.unlinkableSeed)))).toBe(
      DP3T_SCHEDULE.unlinkableId,
    )
  })

  it('is the leftmost 128 bits of the hash, re-derived independently', async () => {
    const seed = fromHex(DP3T_SCHEDULE.unlinkableSeed)
    const full = await sha256(seed)
    expect(toHex(await unlinkableIdentifier(seed))).toBe(toHex(full).slice(0, 32))
  })

  it('is 16 bytes', async () => {
    expect((await unlinkableIdentifier(randomBytes(32))).length).toBe(16)
  })

  it('refuses a seed that is not 32 bytes', async () => {
    await expect(unlinkableIdentifier(new Uint8Array(16))).rejects.toThrow(/32 bytes/)
  })

  it('links nothing across epochs: independent seeds, independent identifiers', async () => {
    const ids = await Promise.all([1, 2, 3, 4].map(() => unlinkableIdentifier(randomBytes(32))))
    expect(new Set(ids.map(toHex)).size).toBe(4)
  })
})

describe('the random broadcast order', () => {
  it('is a permutation: sorted equals generated', async () => {
    const ids = (await dayIdentifiers(SK0)).map(toHex)
    const order = shuffle(ids)
    expect(order).toHaveLength(96)
    expect([...order].sort()).toEqual([...ids].sort())
  })

  it('differs across runs, so generation index is not broadcast time', async () => {
    const ids = (await dayIdentifiers(SK0)).map(toHex)
    // Two independent shuffles of 96 items collide with probability 1/96!.
    const a = shuffle(ids).join(',')
    const b = shuffle(ids).join(',')
    expect(a).not.toBe(b)
    expect(a).not.toBe(ids.join(','))
  })

  it('leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5]
    shuffle(input)
    expect(input).toEqual([1, 2, 3, 4, 5])
  })

  it('reaches every position — no element is pinned', () => {
    const seen = new Set<number>()
    for (let run = 0; run < 200; run++) seen.add(shuffle([0, 1, 2, 3]).indexOf(0))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })
})

describe('the random source', () => {
  it('stays inside its bound', () => {
    for (let i = 0; i < 500; i++) {
      const v = randomBelow(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })

  it('covers its whole range', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(randomBelow(5))
    expect(seen.size).toBe(5)
  })

  it('handles a bound of one without consuming a biased sample', () => {
    expect(randomBelow(1)).toBe(0)
  })

  it('refuses a non-positive bound', () => {
    expect(() => randomBelow(0)).toThrow(/positive integer/)
    expect(() => randomBelow(-3)).toThrow(/positive integer/)
  })

  it('produces different bytes each call', () => {
    expect(toHex(randomBytes(32))).not.toBe(toHex(randomBytes(32)))
  })
})
