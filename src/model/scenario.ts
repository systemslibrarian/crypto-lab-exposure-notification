/**
 * Scenario builders: the worlds the exhibits and the tests both run on.
 *
 * One thing to be careful about here. MOVEMENT is generated from a seeded
 * generator so a scenario can be replayed exactly (check F asks for it), but
 * KEY MATERIAL never is — every TEK and every seed still comes from
 * `crypto.getRandomValues` through `design.createKeys`. Invariant 4 is about
 * keys, and a reproducible walk through a town does not weaken it.
 */

import type { Design, PhoneKeys } from './design'
import { applyRelay, type RelayConfig } from './relay'
import {
  honestBroadcasts,
  type Broadcast,
  type Phone,
  type PlaceId,
  type Presence,
  type Receiver,
  type World,
} from './world'

/**
 * mulberry32 — a small, fast, well-distributed 32-bit generator.
 *
 * For scenario MOVEMENT only. Named `movementRng` rather than `rng` so nobody
 * reaches for it when they need a key.
 */
export function movementRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ScenarioResult {
  world: World
  /** Everything on the air, relay included. */
  broadcasts: Broadcast[]
}

async function phonesWithKeys(
  design: Design,
  days: number,
  labels: readonly { id: string; label: string }[],
): Promise<Phone[]> {
  const out: Phone[] = []
  for (const l of labels) {
    out.push({ id: l.id, label: l.label, keys: await design.createKeys(days) })
  }
  return out
}

/**
 * Exhibit 3 — hearing and matching.
 *
 * A small timeline the learner edits directly: for each slot, which place each
 * phone is at (or nowhere). `presence` IS the control surface.
 */
export async function meetingScenario(
  design: Design,
  options: {
    days?: number
    slotCount?: number
    places?: PlaceId[]
    phoneLabels?: { id: string; label: string }[]
    presence: Presence[]
    keys?: Record<string, PhoneKeys>
  },
): Promise<ScenarioResult> {
  const days = options.days ?? 1
  const slotCount = options.slotCount ?? 8
  const places = options.places ?? ['Cafe', 'Office']
  const labels = options.phoneLabels ?? [
    { id: 'A', label: 'Phone A' },
    { id: 'B', label: 'Phone B' },
    { id: 'C', label: 'Phone C' },
  ]
  const phones = options.keys
    ? labels.map((l) => {
        const keys = options.keys?.[l.id]
        if (!keys) throw new RangeError(`no supplied keys for phone ${l.id}`)
        return { id: l.id, label: l.label, keys }
      })
    : await phonesWithKeys(design, days, labels)

  const world: World = {
    design,
    days,
    slots: Array.from({ length: slotCount }, (_, i) => i),
    places,
    phones,
    receivers: [],
    presence: options.presence,
  }
  return { world, broadcasts: await honestBroadcasts(world) }
}

/**
 * Exhibit 4 — the relay.
 *
 * A stands at one place for the whole timeline. B stands at another, for the
 * whole timeline. They are never in the same place in the same slot, and the
 * world's presence record is what says so. The attacker's receiver is at A's
 * place and its transmitter at B's.
 */
export async function relayScenario(
  design: Design,
  options: {
    delaySlots?: number
    active?: boolean
    slotCount?: number
    /** Put A and B in the SAME place — the bite fixture for mutation 11. */
    colocate?: boolean
    keys?: Record<string, PhoneKeys>
  } = {},
): Promise<ScenarioResult & { relay: RelayConfig }> {
  const slotCount = options.slotCount ?? 12
  const days = 1
  const labels = [
    { id: 'A', label: 'Phone A (reports later)' },
    { id: 'B', label: 'Phone B (gets the alert)' },
  ]
  const phones = options.keys
    ? labels.map((l) => {
        const keys = options.keys?.[l.id]
        if (!keys) throw new RangeError(`no supplied keys for phone ${l.id}`)
        return { id: l.id, label: l.label, keys }
      })
    : await phonesWithKeys(design, days, labels)

  const slots = Array.from({ length: slotCount }, (_, i) => i)
  const bPlace: PlaceId = options.colocate ? 'Platform 4' : 'Rooftop bar'
  const presence: Presence[] = []
  for (const at of slots) {
    presence.push({ phone: 'A', place: 'Platform 4', at })
    presence.push({ phone: 'B', place: bPlace, at })
  }

  const relay: RelayConfig = {
    active: options.active ?? true,
    fromPlace: 'Platform 4',
    toPlace: bPlace,
    delaySlots: options.delaySlots ?? 0,
  }

  const world: World = {
    design,
    days,
    slots,
    places: options.colocate ? ['Platform 4'] : ['Platform 4', 'Rooftop bar'],
    phones,
    receivers: [],
    presence,
  }
  const honest = await honestBroadcasts(world)
  return { world, broadcasts: applyRelay(honest, relay, slots), relay }
}

/**
 * Exhibit 5 — linkage after a report.
 *
 * Three antennas at three places, ten phones walking between them, one of whom
 * will report. Movement comes from `movementRng(seed)` so a run is replayable.
 */
export async function linkageScenario(
  design: Design,
  options: {
    seed?: number
    days?: number
    phoneCount?: number
    slotsPerDay?: number
    keys?: Record<string, PhoneKeys>
  } = {},
): Promise<ScenarioResult> {
  const seed = options.seed ?? 20200521
  const days = options.days ?? 1
  const phoneCount = options.phoneCount ?? 10
  // A short working day rather than all 144/96 slots: the exhibit is about
  // which sightings group, not about volume.
  const slotsPerDay = options.slotsPerDay ?? 12
  const places: PlaceId[] = ['Station', 'Market', 'Library']
  const labels = Array.from({ length: phoneCount }, (_, i) => ({
    id: `P${i}`,
    label: i === 0 ? 'Phone P0 (reports)' : `Phone P${i}`,
  }))
  const phones = options.keys
    ? labels.map((l) => {
        const keys = options.keys?.[l.id]
        if (!keys) throw new RangeError(`no supplied keys for phone ${l.id}`)
        return { id: l.id, label: l.label, keys }
      })
    : await phonesWithKeys(design, days, labels)

  const rand = movementRng(seed)
  const slots: number[] = []
  const presence: Presence[] = []
  for (let day = 0; day < days; day++) {
    for (let s = 0; s < slotsPerDay; s++) {
      const at = day * design.slotsPerDay + s
      slots.push(at)
      for (const phone of phones) {
        const r = rand()
        // A quarter of the time a phone is nowhere an antenna can hear it.
        if (r < 0.25) continue
        const place = places[Math.floor(rand() * places.length)] as PlaceId
        presence.push({ phone: phone.id, place, at })
      }
    }
  }

  const receivers: Receiver[] = places.map((place, i) => ({
    id: `R${i}`,
    place,
    label: `Antenna at the ${place}`,
  }))

  const world: World = { design, days, slots, places, phones, receivers, presence }
  return { world, broadcasts: await honestBroadcasts(world) }
}
