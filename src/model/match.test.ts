/**
 * CHECK D — matching, against the fixed schedule of check B.
 *
 * Expected outcomes come from the specification's rule, not from reading the
 * matcher: an identifier matches when all 16 bytes are equal AND it was heard
 * within the +/-2-hour tolerance of the interval it belongs to (spec v1.2, p.9).
 */
import { describe, expect, it } from 'vitest'
import { matchLog, exposureVerdict } from './match'
import { gaenDesign, dp3tLowCostDesign, dp3tUnlinkableDesign, idKey, type Published } from './design'
import { MATCH_TOLERANCE_INTERVALS, TEK_ROLLING_PERIOD } from '../crypto/gaen'
import { EPOCHS_PER_DAY } from '../crypto/dp3t'
import { fromHex, toHex } from '../crypto/bytes'
import { GAEN_SCHEDULE, DP3T_SCHEDULE } from '../crypto/vectors'

const TEK = fromHex(GAEN_SCHEDULE.tek)
const FIRST_RPI = fromHex(GAEN_SCHEDULE.firstRpi)

/**
 * The schedule vector's TEK, presented as a day-0 report.
 *
 * `gaenDesign` anchors day d at interval d*144, so day 0 starts at interval 0
 * and the identifiers are those of `paddedData(0..143)` — a different set from
 * check B's. To match against check B's own numbers the report has to sit at
 * day 2650032/144 = 18403.
 */
const SCHEDULE_DAY = GAEN_SCHEDULE.startInterval / TEK_ROLLING_PERIOD
const published: Published = {
  designId: 'gaen',
  items: [{ label: 'TEK under test', value: TEK, day: SCHEDULE_DAY }],
}
const DAYS = SCHEDULE_DAY + 1

describe('the time rule comes from the specification', () => {
  it('anchors the schedule vector at a whole number of days', () => {
    expect(Number.isInteger(SCHEDULE_DAY)).toBe(true)
    expect(SCHEDULE_DAY * TEK_ROLLING_PERIOD).toBe(GAEN_SCHEDULE.startInterval)
  })

  it('is +/- 12 intervals, which is +/- two hours', () => {
    expect(gaenDesign.timeRule).toContain('2 hours')
    expect(MATCH_TOLERANCE_INTERVALS).toBe(12)
  })
})

describe('CHECK D — matching the schedule vector', () => {
  it('matches an identifier heard in the interval it belongs to', async () => {
    const r = await matchLog(
      gaenDesign,
      [{ identifier: FIRST_RPI, heardAt: GAEN_SCHEDULE.startInterval }],
      published,
      DAYS,
    )
    expect(r.matches).toHaveLength(1)
    expect(exposureVerdict(r)).toBe('exposure')
    expect(toHex(r.matches[0]!.expanded.identifier)).toBe(GAEN_SCHEDULE.firstRpi)
  })

  it('matches at the far edge of the tolerance, and not one interval past it', async () => {
    const start = GAEN_SCHEDULE.startInterval
    const inside = await matchLog(
      gaenDesign,
      [{ identifier: FIRST_RPI, heardAt: start + MATCH_TOLERANCE_INTERVALS }],
      published,
      DAYS,
    )
    expect(inside.matches).toHaveLength(1)

    const outside = await matchLog(
      gaenDesign,
      [{ identifier: FIRST_RPI, heardAt: start + MATCH_TOLERANCE_INTERVALS + 1 }],
      published,
      DAYS,
    )
    expect(outside.matches).toHaveLength(0)
    expect(outside.rejectedByTime).toHaveLength(1)
    expect(exposureVerdict(outside)).toBe('none')
  })

  it('does not match the same identifier heard far outside the tolerance', async () => {
    const r = await matchLog(
      gaenDesign,
      [{ identifier: FIRST_RPI, heardAt: GAEN_SCHEDULE.startInterval + 100 }],
      published,
      DAYS,
    )
    expect(r.matches).toHaveLength(0)
    // The bytes DID match something; the page needs that distinction to explain why.
    expect(r.rejectedByTime).toHaveLength(1)
    expect(r.verdicts[0]!.rejectedByTime).toBe(true)
  })

  it('does not match an identifier with one bit changed', async () => {
    const flipped = Uint8Array.from(FIRST_RPI)
    flipped[0] = (flipped[0] as number) ^ 0x01
    const r = await matchLog(
      gaenDesign,
      [{ identifier: flipped, heardAt: GAEN_SCHEDULE.startInterval }],
      published,
      DAYS,
    )
    expect(r.matches).toHaveLength(0)
    expect(r.rejectedByTime).toHaveLength(0)
  })

  it('does not match an identifier of a different TEK', async () => {
    const other: Published = {
      designId: 'gaen',
      items: [{ label: 'a different TEK', value: fromHex('0f0e0d0c0b0a09080706050403020100'), day: SCHEDULE_DAY }],
    }
    const r = await matchLog(
      gaenDesign,
      [{ identifier: FIRST_RPI, heardAt: GAEN_SCHEDULE.startInterval }],
      other,
      DAYS,
    )
    expect(r.matches).toHaveLength(0)
  })

  it('compares all 16 bytes, not a prefix', async () => {
    // Same first 8 bytes as the real RPI, different last 8. A prefix comparison
    // would call this a match; mutation 9 is exactly that change.
    const halfRight = Uint8Array.from(FIRST_RPI)
    for (let i = 8; i < 16; i++) halfRight[i] = 0
    const r = await matchLog(
      gaenDesign,
      [{ identifier: halfRight, heardAt: GAEN_SCHEDULE.startInterval }],
      published,
      DAYS,
    )
    expect(toHex(halfRight).slice(0, 16)).toBe(GAEN_SCHEDULE.firstRpi.slice(0, 16))
    expect(r.matches).toHaveLength(0)
  })

  it('expands a report to exactly 144 identifiers', async () => {
    const r = await matchLog(gaenDesign, [], published, DAYS)
    expect(r.expandedCount).toBe(144)
  })
})

describe('idKey is the single point of comparison (invariant 5)', () => {
  it('is all 32 hex digits, so equality of the key is equality of 16 bytes', () => {
    expect(idKey(FIRST_RPI)).toHaveLength(32)
    expect(idKey(FIRST_RPI)).toBe(GAEN_SCHEDULE.firstRpi)
  })

  it('separates two identifiers that differ only in their LAST byte', () => {
    // The case a prefix comparison would merge. Mutation 9 truncates `idKey`,
    // and this is the assertion that notices.
    const other = Uint8Array.from(FIRST_RPI)
    other[15] = (other[15] as number) ^ 0xff
    expect(idKey(other)).not.toBe(idKey(FIRST_RPI))
    expect(idKey(other).slice(0, 16)).toBe(idKey(FIRST_RPI).slice(0, 16))
  })

  it('refuses anything that is not 16 bytes rather than keying a prefix', () => {
    expect(() => idKey(FIRST_RPI.subarray(0, 8))).toThrow(/16 bytes/)
  })
})

describe('fail-closed paths (CHECK I)', () => {
  it('refuses a 15-byte log entry rather than comparing a prefix', async () => {
    await expect(
      matchLog(gaenDesign, [{ identifier: FIRST_RPI.subarray(0, 15), heardAt: 0 }], published, DAYS),
    ).rejects.toThrow(/15 bytes.*is 16/)
  })

  it('refuses a 17-byte log entry', async () => {
    const long = new Uint8Array(17)
    long.set(FIRST_RPI, 0)
    await expect(matchLog(gaenDesign, [{ identifier: long, heardAt: 0 }], published, DAYS)).rejects.toThrow(
      /17 bytes.*is 16/,
    )
  })

  it('reports no exposure for a published key with no heard identifiers', async () => {
    const r = await matchLog(gaenDesign, [], published, DAYS)
    expect(r.matches).toHaveLength(0)
    expect(exposureVerdict(r)).toBe('none')
  })

  it('reports no exposure when nothing was published', async () => {
    const r = await matchLog(
      gaenDesign,
      [{ identifier: FIRST_RPI, heardAt: GAEN_SCHEDULE.startInterval }],
      { designId: 'gaen', items: [] },
      DAYS,
    )
    expect(r.matches).toHaveLength(0)
    expect(r.expandedCount).toBe(0)
  })

  it('does not match an identifier heard on the wrong day', async () => {
    // The same slot offset, one day later: a different interval entirely, and
    // far outside the tolerance.
    const r = await matchLog(
      gaenDesign,
      [{ identifier: FIRST_RPI, heardAt: GAEN_SCHEDULE.startInterval + TEK_ROLLING_PERIOD }],
      published,
      DAYS + 1,
    )
    expect(r.matches).toHaveLength(0)
  })

  it('stores both identifiers when two phones broadcast in one slot, and matches per identifier', async () => {
    const otherRpi = fromHex(GAEN_SCHEDULE.secondRpi)
    const r = await matchLog(
      gaenDesign,
      [
        { identifier: FIRST_RPI, heardAt: GAEN_SCHEDULE.startInterval },
        { identifier: fromHex('ffffffffffffffffffffffffffffffff'), heardAt: GAEN_SCHEDULE.startInterval },
        { identifier: otherRpi, heardAt: GAEN_SCHEDULE.startInterval + 1 },
      ],
      published,
      DAYS,
    )
    expect(r.verdicts).toHaveLength(3)
    expect(r.verdicts.map((v) => v.matched)).toEqual([true, false, true])
  })
})

describe('the DP-3T time rules differ, and the tests say how', () => {
  it('low-cost matches anywhere in the day, because broadcast order is random', async () => {
    const seed = fromHex(DP3T_SCHEDULE.seed0)
    const pub: Published = {
      designId: 'dp3t-lowcost',
      items: [{ label: 'SK_t day 0', value: seed, day: 0 }],
    }
    const ids = await dp3tLowCostDesign.expand(pub, 1)
    const generatedFirst = ids[0]!
    // Heard in slot 90, though it was generated first: still a match.
    const r = await matchLog(dp3tLowCostDesign, [{ identifier: generatedFirst.identifier, heardAt: 90 }], pub, 1)
    expect(r.matches).toHaveLength(1)
  })

  it('low-cost does NOT match the next day', async () => {
    const seed = fromHex(DP3T_SCHEDULE.seed0)
    const pub: Published = {
      designId: 'dp3t-lowcost',
      items: [{ label: 'SK_t day 0', value: seed, day: 0 }],
    }
    const ids = await dp3tLowCostDesign.expand(pub, 1)
    const r = await matchLog(
      dp3tLowCostDesign,
      [{ identifier: ids[0]!.identifier, heardAt: EPOCHS_PER_DAY + 3 }],
      pub,
      2,
    )
    expect(r.matches).toHaveLength(0)
    expect(r.rejectedByTime).toHaveLength(1)
  })

  it('unlinkable requires the exact epoch — no tolerance at all', async () => {
    const keys = await dp3tUnlinkableDesign.createKeys(1)
    const pub = dp3tUnlinkableDesign.publish(keys, 0, 1)
    const id = await dp3tUnlinkableDesign.identifierAt(keys, 5)
    expect((await matchLog(dp3tUnlinkableDesign, [{ identifier: id, heardAt: 5 }], pub, 1)).matches).toHaveLength(1)
    expect((await matchLog(dp3tUnlinkableDesign, [{ identifier: id, heardAt: 6 }], pub, 1)).matches).toHaveLength(0)
  })
})
