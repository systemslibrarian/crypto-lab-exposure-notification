/**
 * The world model, on its own.
 *
 * This is the only module that knows who was near whom, and the page's whole
 * negative claim rests on it answering that question correctly. So it is tested
 * directly rather than only through the relay scenario.
 */
import { describe, expect, it } from 'vitest'
import { gaenDesign } from './design'
import { colocatedSlots, heardBy, honestBroadcasts, loggedBy, placeOf, wereColocated, type World } from './world'
import { meetingScenario } from './scenario'
import { toHex } from '../crypto/bytes'

async function world(presence: World['presence'], slotCount = 6): Promise<World> {
  const { world: w } = await meetingScenario(gaenDesign, {
    slotCount,
    places: ['Cafe', 'Office'],
    phoneLabels: [
      { id: 'A', label: 'Phone A' },
      { id: 'B', label: 'Phone B' },
    ],
    presence,
  })
  return w
}

describe('co-location requires the same place AND the same slot', () => {
  it('is true when both phones are at one place in one slot', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 2 },
      { phone: 'B', place: 'Cafe', at: 2 },
    ])
    expect(wereColocated(w, 'A', 'B')).toBe(true)
    expect(colocatedSlots(w, 'A', 'B')).toEqual([2])
  })

  it('is FALSE when they visit the same place at different times', async () => {
    // The case that separates proximity from a shared address. Two people in
    // the same cafe an hour apart were never near each other, and a model that
    // says otherwise would make the page's "never near each other" clause
    // wrong in the one direction nobody would notice.
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'A', place: 'Cafe', at: 1 },
      { phone: 'B', place: 'Cafe', at: 3 },
      { phone: 'B', place: 'Cafe', at: 4 },
    ])
    expect(wereColocated(w, 'A', 'B')).toBe(false)
    expect(colocatedSlots(w, 'A', 'B')).toEqual([])
  })

  it('is FALSE when they are in different places in the same slot', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 1 },
      { phone: 'B', place: 'Office', at: 1 },
    ])
    expect(wereColocated(w, 'A', 'B')).toBe(false)
  })

  it('finds every shared slot, not just the first', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'B', place: 'Cafe', at: 0 },
      { phone: 'A', place: 'Office', at: 1 },
      { phone: 'B', place: 'Cafe', at: 1 },
      { phone: 'A', place: 'Office', at: 2 },
      { phone: 'B', place: 'Office', at: 2 },
    ])
    expect(colocatedSlots(w, 'A', 'B')).toEqual([0, 2])
    expect(wereColocated(w, 'A', 'B')).toBe(true)
  })

  it('treats "nowhere" as nowhere, not as a place two phones can share', async () => {
    // Neither phone is recorded anywhere in slot 4. Two absences are not an
    // encounter, and `placeOf` returning undefined for both must not compare
    // equal.
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'B', place: 'Office', at: 1 },
    ])
    expect(placeOf(w, 'A', 4)).toBeUndefined()
    expect(placeOf(w, 'B', 4)).toBeUndefined()
    expect(wereColocated(w, 'A', 'B')).toBe(false)
  })

  it('is symmetric', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 2 },
      { phone: 'B', place: 'Cafe', at: 2 },
    ])
    expect(wereColocated(w, 'A', 'B')).toBe(wereColocated(w, 'B', 'A'))
  })
})

describe('what a phone hears', () => {
  it('hears a phone at its place in its slot, and nothing else', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'B', place: 'Cafe', at: 0 },
      { phone: 'A', place: 'Cafe', at: 1 },
      { phone: 'B', place: 'Office', at: 1 },
    ])
    const air = await honestBroadcasts(w)
    const bLog = heardBy(w, 'B', air)
    expect(bLog).toHaveLength(1)
    expect(bLog[0]!.heardAt).toBe(0)
    expect(toHex(bLog[0]!.identifier)).toBe(toHex(await gaenDesign.identifierAt(w.phones[0]!.keys, 0)))
  })

  it('never hears itself', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'B', place: 'Cafe', at: 0 },
    ])
    const air = await honestBroadcasts(w)
    const own = toHex(await gaenDesign.identifierAt(w.phones[0]!.keys, 0))
    expect(heardBy(w, 'A', air).map((e) => toHex(e.identifier))).not.toContain(own)
  })

  it('stores a log entry carrying exactly an identifier and a slot', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'B', place: 'Cafe', at: 0 },
    ])
    const air = await honestBroadcasts(w)
    for (const entry of heardBy(w, 'B', air)) {
      expect(Object.keys(entry).sort()).toEqual(['heardAt', 'identifier'])
      expect(entry.identifier).toHaveLength(16)
    }
  })

  it('counts one sighting per identifier per slot', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'B', place: 'Cafe', at: 0 },
    ])
    const air = await honestBroadcasts(w)
    expect(heardBy(w, 'B', air)).toHaveLength(1)
  })
})

describe('what a receiver logs', () => {
  it('logs everything at its place, from every phone', async () => {
    const w = await world([
      { phone: 'A', place: 'Cafe', at: 0 },
      { phone: 'B', place: 'Cafe', at: 0 },
      { phone: 'A', place: 'Office', at: 1 },
    ])
    const air = await honestBroadcasts(w)
    const log = loggedBy({ id: 'R', place: 'Cafe', label: 'Cafe antenna' }, air)
    expect(log).toHaveLength(2)
    expect(log.every((e) => e.heardAt === 0)).toBe(true)
  })

  it('takes no World at all (invariant 3, structurally)', () => {
    expect(loggedBy.length).toBe(2)
  })
})
