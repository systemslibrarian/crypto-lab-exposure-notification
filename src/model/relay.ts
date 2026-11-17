/**
 * The relay.
 *
 * An attacker runs two antennas that are never near each other: a RECEIVER
 * standing where A stands, and a TRANSMITTER standing where B stands. Whatever
 * the receiver hears, the transmitter puts back on the air — optionally after a
 * delay.
 *
 * This is not an attack on the cryptography. Every identifier it moves is a
 * genuine identifier, correctly derived, and B's phone verifies it exactly as it
 * would verify one from a person standing next to B. The white paper says the
 * same of its own design: "Such an 'online' relay attack is unavoidable in
 * proximity tracing systems based on passive Bluetooth advertisements"
 * (DP-3T white paper, p.36). Vaudenay gives it its own section (ePrint
 * 2020/399, section 4.5) and concludes "the only way to defeat this type of
 * attack is to use some form of a distance-bounding protocol".
 */

import type { Broadcast, PlaceId } from './world'

export interface RelayConfig {
  active: boolean
  /** Where the attacker's receiver stands. */
  fromPlace: PlaceId
  /** Where the attacker's transmitter stands. */
  toPlace: PlaceId
  /** Slots of delay between capture and rebroadcast. 0 is a live relay. */
  delaySlots: number
}

/**
 * Add the attacker's rebroadcasts to what is on the air.
 *
 * The relayed copy carries `relayed: true` so the PAGE can tell the learner
 * what happened. No matcher ever sees that flag — `heardBy` strips it, and
 * `matchLog` has no parameter that could carry it.
 */
export function applyRelay(
  broadcasts: readonly Broadcast[],
  relay: RelayConfig,
  slots: readonly number[],
): Broadcast[] {
  if (!relay.active) return [...broadcasts]
  const relayed: Broadcast[] = []
  for (const b of broadcasts) {
    if (b.relayed) continue
    if (b.place !== relay.fromPlace) continue
    const at = b.at + relay.delaySlots
    // A rebroadcast after the timeline ends never goes out.
    if (!slots.includes(at)) continue
    relayed.push({ identifier: b.identifier, at, place: relay.toPlace, origin: b.origin, relayed: true })
  }
  return [...broadcasts, ...relayed]
}
