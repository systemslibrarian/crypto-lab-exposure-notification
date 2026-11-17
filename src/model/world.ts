/**
 * The world: who was where, in which slot.
 *
 * This module holds the GROUND TRUTH and nothing else. It is the only place
 * that knows whether two people were ever near each other, and it is never
 * consulted by the matcher or by the linkage observer — invariants 2 and 3.
 * The page uses it to say, afterwards, whether a verdict was right.
 */

import type { Design, LogEntry, PhoneKeys } from './design'
import { idKey } from './design'

export type PhoneId = string
export type PlaceId = string

/** Ground truth: this phone was at this place during this absolute slot. */
export interface Presence {
  phone: PhoneId
  place: PlaceId
  at: number
}

export interface Phone {
  id: PhoneId
  label: string
  keys: PhoneKeys
}

/** A passive antenna that logs everything broadcast at its place. */
export interface Receiver {
  id: string
  place: PlaceId
  label: string
}

export interface World {
  design: Design
  days: number
  /** Absolute slot indices the timeline covers. */
  slots: number[]
  places: PlaceId[]
  phones: Phone[]
  receivers: Receiver[]
  /** The ground-truth presence record. */
  presence: Presence[]
}

/** One broadcast that actually went out over the air in a slot, at a place. */
export interface Broadcast {
  identifier: Uint8Array
  at: number
  place: PlaceId
  /** Which phone's identifier this is. Ground truth — never given to a matcher. */
  origin: PhoneId
  /** True when an attacker put it on the air here rather than the phone. */
  relayed: boolean
}

export function placeOf(world: World, phone: PhoneId, at: number): PlaceId | undefined {
  return world.presence.find((p) => p.phone === phone && p.at === at)?.place
}

/**
 * Were these two phones ever at the same place in the same slot?
 *
 * Computed ONLY from `world.presence`. Check E asserts this, and mutation 11
 * is the version that computes it from the matcher's output instead — which
 * would make the sentence "they were never near each other" a restatement of
 * the match rather than a fact about the world.
 */
export function wereColocated(world: World, a: PhoneId, b: PhoneId): boolean {
  for (const slot of world.slots) {
    const pa = placeOf(world, a, slot)
    if (pa === undefined) continue
    if (pa === placeOf(world, b, slot)) return true
  }
  return false
}

/** Every slot in which these two were at the same place. */
export function colocatedSlots(world: World, a: PhoneId, b: PhoneId): number[] {
  return world.slots.filter((slot) => {
    const pa = placeOf(world, a, slot)
    return pa !== undefined && pa === placeOf(world, b, slot)
  })
}

/** Every identifier each phone genuinely broadcast, at the place it stood. */
export async function honestBroadcasts(world: World): Promise<Broadcast[]> {
  const out: Broadcast[] = []
  for (const p of world.presence) {
    const phone = world.phones.find((ph) => ph.id === p.phone)
    if (!phone) continue
    out.push({
      identifier: await world.design.identifierAt(phone.keys, p.at),
      at: p.at,
      place: p.place,
      origin: p.phone,
      relayed: false,
    })
  }
  return out
}

/**
 * What one phone heard: every broadcast at its place in its slot, except its own.
 *
 * This is the ONLY input a matcher gets from the world, alongside the server's
 * published keys. It carries no place, no origin and no relay flag — a phone
 * cannot tell a relayed identifier from a real one, which is exhibit 4.
 */
export function heardBy(
  world: World,
  phone: PhoneId,
  broadcasts: readonly Broadcast[],
): LogEntry[] {
  const log: LogEntry[] = []
  const seen = new Set<string>()
  for (const b of broadcasts) {
    if (b.origin === phone) continue
    if (placeOf(world, phone, b.at) !== b.place) continue
    // One entry per (identifier, slot): hearing the same beacon twice in a slot
    // is one sighting.
    const k = `${idKey(b.identifier)}@${b.at}`
    if (seen.has(k)) continue
    seen.add(k)
    log.push({ identifier: b.identifier, heardAt: b.at })
  }
  return log.sort((x, y) => x.heardAt - y.heardAt)
}

/**
 * What a passive receiver logged: everything at its place, with the time.
 *
 * Takes no `World` on purpose. An antenna hears what is on the air where it
 * stands and nothing else, so the ground truth is not even in scope here —
 * which is invariant 3 made structural rather than promised.
 */
export function loggedBy(receiver: Receiver, broadcasts: readonly Broadcast[]): LogEntry[] {
  return broadcasts
    .filter((b) => b.place === receiver.place)
    .map((b) => ({ identifier: b.identifier, heardAt: b.at }))
    .sort((a, b) => a.heardAt - b.heardAt)
}
