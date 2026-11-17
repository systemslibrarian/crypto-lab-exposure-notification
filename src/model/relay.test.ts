/**
 * CHECK E — the relay.
 *
 * The assertion that matters here is the one about the WORLD: A and B were
 * never co-located, in both runs, and that is computed from `world.presence`
 * by `wereColocated`, never from the matcher's answer. Mutation 11 is the
 * version that computes it from the matcher instead; if that mutation survives,
 * the negative claim on the page is circular and means nothing.
 */
import { describe, expect, it } from 'vitest'
import { relayScenario } from './scenario'
import { gaenDesign, dp3tLowCostDesign } from './design'
import { exposureVerdict, matchLog } from './match'
import { colocatedSlots, heardBy, wereColocated } from './world'
import { MATCH_TOLERANCE_INTERVALS } from '../crypto/gaen'

describe('CHECK E — a relayed identifier matches like a real encounter', () => {
  it('B is told of an exposure after A reports, with the relay live', async () => {
    const { world, broadcasts } = await relayScenario(gaenDesign, { delaySlots: 0 })

    // The world says they were never together. Asserted FIRST, from presence.
    expect(wereColocated(world, 'A', 'B')).toBe(false)
    expect(colocatedSlots(world, 'A', 'B')).toEqual([])

    const bLog = heardBy(world, 'B', broadcasts)
    expect(bLog.length).toBeGreaterThan(0)

    const a = world.phones.find((p) => p.id === 'A')!
    const published = gaenDesign.publish(a.keys, 0, world.days)
    const result = await matchLog(gaenDesign, bLog, published, world.days)

    expect(exposureVerdict(result)).toBe('exposure')
    expect(result.matches.length).toBeGreaterThan(0)

    // And the world still says they were never together, after the match.
    expect(wereColocated(world, 'A', 'B')).toBe(false)
  })

  it('every check the phone can make passes on the relayed identifier', async () => {
    const { world, broadcasts } = await relayScenario(gaenDesign, { delaySlots: 0 })
    const bLog = heardBy(world, 'B', broadcasts)
    const a = world.phones.find((p) => p.id === 'A')!
    const published = gaenDesign.publish(a.keys, 0, world.days)
    const result = await matchLog(gaenDesign, bLog, published, world.days)
    const match = result.matches[0]!

    expect(match.entry.identifier).toHaveLength(16)
    expect(gaenDesign.withinTimeRule(match.entry, match.expanded)).toBe(true)
    expect(match.expanded.day).toBe(0)
    expect(published.items.length).toBeGreaterThan(0)
  })

  it('a replay delayed beyond the tolerance reports no exposure', async () => {
    const { world, broadcasts } = await relayScenario(gaenDesign, {
      delaySlots: MATCH_TOLERANCE_INTERVALS + 1,
      slotCount: 30,
    })

    expect(wereColocated(world, 'A', 'B')).toBe(false)

    const bLog = heardBy(world, 'B', broadcasts)
    expect(bLog.length).toBeGreaterThan(0)

    const a = world.phones.find((p) => p.id === 'A')!
    const result = await matchLog(gaenDesign, bLog, gaenDesign.publish(a.keys, 0, world.days), world.days)

    expect(exposureVerdict(result)).toBe('none')
    expect(result.rejectedByTime.length).toBeGreaterThan(0)
    expect(wereColocated(world, 'A', 'B')).toBe(false)
  })

  it('with the relay off, B hears nothing at all', async () => {
    const { world, broadcasts } = await relayScenario(gaenDesign, { active: false })
    expect(heardBy(world, 'B', broadcasts)).toEqual([])
    const a = world.phones.find((p) => p.id === 'A')!
    const result = await matchLog(gaenDesign, [], gaenDesign.publish(a.keys, 0, world.days), world.days)
    expect(exposureVerdict(result)).toBe('none')
  })

  it('relays DP-3T low-cost identifiers the same way — the limit is not design-specific', async () => {
    const { world, broadcasts } = await relayScenario(dp3tLowCostDesign, { delaySlots: 0 })
    expect(wereColocated(world, 'A', 'B')).toBe(false)
    const bLog = heardBy(world, 'B', broadcasts)
    const a = world.phones.find((p) => p.id === 'A')!
    const result = await matchLog(dp3tLowCostDesign, bLog, dp3tLowCostDesign.publish(a.keys, 0, world.days), world.days)
    expect(exposureVerdict(result)).toBe('exposure')
  })

  it('the BITE fixture: when A and B really are together, the world says so', async () => {
    // This is what makes the "never near each other" clause a finding rather
    // than a constant. Mutation 11 cannot tell these two scenarios apart.
    const { world, broadcasts } = await relayScenario(gaenDesign, { colocate: true, delaySlots: 0 })
    expect(wereColocated(world, 'A', 'B')).toBe(true)
    expect(colocatedSlots(world, 'A', 'B').length).toBe(world.slots.length)

    const bLog = heardBy(world, 'B', broadcasts)
    const a = world.phones.find((p) => p.id === 'A')!
    const result = await matchLog(gaenDesign, bLog, gaenDesign.publish(a.keys, 0, world.days), world.days)
    // The match looks IDENTICAL to the relayed one. That is the whole point.
    expect(exposureVerdict(result)).toBe('exposure')
  })

  it('a phone cannot tell a relayed identifier from a real one: the log carries no flag', async () => {
    const { world, broadcasts } = await relayScenario(gaenDesign, { delaySlots: 0 })
    const bLog = heardBy(world, 'B', broadcasts)
    // Invariant 2, structurally: a log entry has exactly two fields.
    for (const entry of bLog) {
      expect(Object.keys(entry).sort()).toEqual(['heardAt', 'identifier'])
    }
    expect(broadcasts.some((b) => b.relayed)).toBe(true)
  })
})

describe('the relay itself', () => {
  it('rebroadcasts only what its receiver could hear', async () => {
    const { world, broadcasts, relay } = await relayScenario(gaenDesign, { delaySlots: 0 })
    const relayedIds = broadcasts.filter((b) => b.relayed)
    expect(relayedIds.length).toBeGreaterThan(0)
    for (const b of relayedIds) {
      expect(b.place).toBe(relay.toPlace)
      expect(b.origin).toBe('A')
    }
    expect(world.places).toContain(relay.fromPlace)
  })

  it('drops a rebroadcast whose delay runs off the end of the timeline', async () => {
    const { broadcasts } = await relayScenario(gaenDesign, { delaySlots: 5, slotCount: 6 })
    // Only slots 0 of A's 6 can land inside 0..5 after a 5-slot delay.
    expect(broadcasts.filter((b) => b.relayed)).toHaveLength(1)
  })
})
