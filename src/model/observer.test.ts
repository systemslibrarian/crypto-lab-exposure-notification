/**
 * CHECK F — linkage after a report.
 *
 * The observer is handed its own logs and the published report, nothing else.
 * What "linked" means is settled here by comparing its grouping with the
 * world's presence record AFTERWARDS — the observer never sees that record.
 */
import { describe, expect, it } from 'vitest'
import { linkageScenario } from './scenario'
import { dp3tLowCostDesign, dp3tUnlinkableDesign, gaenDesign, type Design } from './design'
import { group, trajectory, type Sighting } from './observer'
import { loggedBy, type Broadcast, type World } from './world'
import { toHex } from '../crypto/bytes'

const SEED = 20200521

/** The observer's whole input: every antenna's log, with place and time. */
function antennaLogs(world: World, broadcasts: readonly Broadcast[]): Sighting[] {
  const out: Sighting[] = []
  for (const r of world.receivers) {
    for (const e of loggedBy(r, broadcasts)) {
      out.push({ identifier: e.identifier, at: e.heardAt, place: r.place })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Ground truth, from presence only: where P0 actually was, in time order. */
function groundTruth(world: World, phone: string): { at: number; place: string }[] {
  return world.presence
    .filter((p) => p.phone === phone)
    .map((p) => ({ at: p.at, place: p.place }))
    .sort((a, b) => a.at - b.at)
}

async function setup(design: Design, days = 1) {
  const { world, broadcasts } = await linkageScenario(design, { seed: SEED, days })
  return { world, broadcasts, sightings: antennaLogs(world, broadcasts) }
}

describe('CHECK F — before the report, nothing groups', () => {
  for (const design of [gaenDesign, dp3tLowCostDesign, dp3tUnlinkableDesign]) {
    it(`${design.label}: no group larger than one`, async () => {
      const { world, sightings } = await setup(design)
      expect(sightings.length).toBeGreaterThan(10)
      const before = await group(design, sightings, null, world.days)
      expect(before.largestGroup).toBe(1)
      expect(before.recognised).toEqual([])
    })
  }
})

describe('CHECK F — after the report', () => {
  it('Apple/Google: the observer recovers exactly the reporter’s sightings, in time order', async () => {
    const { world, sightings } = await setup(gaenDesign)
    const reporter = world.phones[0]!
    const published = gaenDesign.publish(reporter.keys, 0, world.days)

    const after = await group(gaenDesign, sightings, published, world.days)
    const recovered = trajectory(after)
    const truth = groundTruth(world, reporter.id)

    expect(recovered).not.toHaveLength(0)
    expect(recovered.map((s) => ({ at: s.at, place: s.place }))).toEqual(truth)
    expect(after.largestGroup).toBe(recovered.length)
    expect(after.largestGroup).toBeGreaterThan(1)
  })

  it('DP-3T low-cost: the same, from one published seed', async () => {
    const { world, sightings } = await setup(dp3tLowCostDesign)
    const reporter = world.phones[0]!
    const published = dp3tLowCostDesign.publish(reporter.keys, 0, world.days)
    expect(published.items).toHaveLength(1)

    const after = await group(dp3tLowCostDesign, sightings, published, world.days)
    expect(trajectory(after).map((s) => ({ at: s.at, place: s.place }))).toEqual(
      groundTruth(world, reporter.id),
    )
  })

  it('picks out the reporter and NOBODY else', async () => {
    const { world, sightings } = await setup(gaenDesign)
    const reporter = world.phones[0]!
    const published = gaenDesign.publish(reporter.keys, 0, world.days)
    const after = await group(gaenDesign, sightings, published, world.days)

    // Every other phone's identifiers must be absent from the recognised set.
    const recognised = new Set(after.recognised.map((s) => toHex(s.identifier)))
    for (const other of world.phones.slice(1)) {
      for (const at of world.slots) {
        const id = await gaenDesign.identifierAt(other.keys, at)
        expect(recognised.has(toHex(id))).toBe(false)
      }
    }
  })

  it('DP-3T unlinkable: every sighting is recognised, and still nothing groups', async () => {
    const { world, sightings } = await setup(dp3tUnlinkableDesign)
    const reporter = world.phones[0]!
    const published = dp3tUnlinkableDesign.publish(reporter.keys, 0, world.days)

    const after = await group(dp3tUnlinkableDesign, sightings, published, world.days)

    // The reporter's sightings ARE recognised, one at a time...
    expect(after.recognised.map((s) => ({ at: s.at, place: s.place }))).toEqual(
      groundTruth(world, reporter.id),
    )
    // ...but no published value covers two of them, so none are grouped.
    expect(after.largestGroup).toBe(1)
  })
})

describe('CHECK F — two days', () => {
  it('Apple/Google given only day 1’s key links day 1 only', async () => {
    const { world, sightings } = await setup(gaenDesign, 2)
    const reporter = world.phones[0]!
    // Publish from day 1 onwards: day 0's key stays on the phone.
    const published = gaenDesign.publish(reporter.keys, 1, world.days)
    expect(published.items).toHaveLength(1)
    expect(published.items[0]!.day).toBe(1)

    const after = await group(gaenDesign, sightings, published, world.days)
    const days = new Set(after.recognised.map((s) => Math.floor(s.at / gaenDesign.slotsPerDay)))
    expect([...days]).toEqual([1])

    const truthDay1 = groundTruth(world, reporter.id).filter(
      (p) => Math.floor(p.at / gaenDesign.slotsPerDay) === 1,
    )
    expect(after.recognised.map((s) => ({ at: s.at, place: s.place }))).toEqual(truthDay1)
  })

  it('DP-3T low-cost given the day-1 seed links day 1 AND every later day', async () => {
    const { world, sightings } = await setup(dp3tLowCostDesign, 3)
    const reporter = world.phones[0]!
    const published = dp3tLowCostDesign.publish(reporter.keys, 1, world.days)
    expect(published.items).toHaveLength(1)

    const after = await group(dp3tLowCostDesign, sightings, published, world.days)
    const days = new Set(after.recognised.map((s) => Math.floor(s.at / dp3tLowCostDesign.slotsPerDay)))
    expect([...days].sort()).toEqual([1, 2])
    expect(days.has(0)).toBe(false)
  })

  it('ONE published value: Apple/Google links one day, DP-3T links every later day', async () => {
    const gaen = await setup(gaenDesign, 3)
    const dp3t = await setup(dp3tLowCostDesign, 3)

    // Both reporters publish exactly ONE value, anchored at day 1. That is the
    // comparison: the same quantity of disclosure buys the observer different
    // amounts, and the difference is the hash chain.
    const gaenPublished = gaenDesign.publish(gaen.world.phones[0]!.keys, 1, 2)
    const dp3tPublished = dp3tLowCostDesign.publish(dp3t.world.phones[0]!.keys, 1, 3)
    expect(gaenPublished.items).toHaveLength(1)
    expect(dp3tPublished.items).toHaveLength(1)

    const gaenAfter = await group(gaenDesign, gaen.sightings, gaenPublished, 3)
    const dp3tAfter = await group(dp3tLowCostDesign, dp3t.sightings, dp3tPublished, 3)

    const daysOf = (r: Awaited<ReturnType<typeof group>>, d: Design): number[] =>
      [...new Set(r.recognised.map((s) => Math.floor(s.at / d.slotsPerDay)))].sort()

    expect(daysOf(gaenAfter, gaenDesign)).toEqual([1])
    expect(daysOf(dp3tAfter, dp3tLowCostDesign)).toEqual([1, 2])
  })
})

describe('the observer is isolated (invariant 3)', () => {
  it('receives only sightings and the published report', () => {
    // Structural: `group` takes four parameters and none of them is a World.
    expect(group.length).toBe(4)
  })

  it('a sighting carries no origin — the observer never learns whose it is', async () => {
    const { sightings } = await setup(gaenDesign)
    for (const s of sightings) {
      expect(Object.keys(s).sort()).toEqual(['at', 'identifier', 'place'])
    }
  })

  it('is replayable from its seed: the same seed gives the same movement', async () => {
    const a = await linkageScenario(gaenDesign, { seed: 1234 })
    const b = await linkageScenario(gaenDesign, { seed: 1234 })
    expect(a.world.presence).toEqual(b.world.presence)
  })

  it('but the KEYS are fresh every run — movement is seeded, key material is not', async () => {
    const a = await linkageScenario(gaenDesign, { seed: 1234 })
    const b = await linkageScenario(gaenDesign, { seed: 1234 })
    expect(toHex(a.world.phones[0]!.keys.days[0]!)).not.toBe(toHex(b.world.phones[0]!.keys.days[0]!))
  })
})

describe('after a report, the phone is not trackable (EDGE CASE)', () => {
  it('DP-3T: the next seed is NOT the hash of the reported one', async () => {
    const keys = await dp3tLowCostDesign.createKeys(3)
    const published = dp3tLowCostDesign.publish(keys, 0, 3)
    const fresh = await dp3tLowCostDesign.afterReport(keys, 3)

    // The reported seed expands to nothing the phone will broadcast from now on.
    const expanded = await dp3tLowCostDesign.expand(published, 3)
    const expandedIds = new Set(expanded.map((e) => toHex(e.identifier)))
    for (let at = 0; at < 5; at++) {
      expect(expandedIds.has(toHex(await dp3tLowCostDesign.identifierAt(fresh, at)))).toBe(false)
    }
    expect(toHex(fresh.days[0]!)).not.toBe(toHex(keys.days[0]!))
    expect(toHex(fresh.days[1]!)).not.toBe(toHex(keys.days[1]!))
  })

  it('Apple/Google keys were already independent, so nothing needs replacing', async () => {
    const keys = await gaenDesign.createKeys(3)
    const after = await gaenDesign.afterReport(keys, 3)
    expect(toHex(after.days[0]!)).toBe(toHex(keys.days[0]!))
    // Independence is the property that matters, and it is testable directly:
    // day 1's key is not derivable from day 0's.
    const published = gaenDesign.publish(keys, 0, 1)
    const expanded = new Set((await gaenDesign.expand(published, 1)).map((e) => toHex(e.identifier)))
    const day1Id = await gaenDesign.identifierAt(keys, gaenDesign.slotsPerDay)
    expect(expanded.has(toHex(day1Id))).toBe(false)
  })
})
