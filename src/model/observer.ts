/**
 * The linkage observer.
 *
 * An adversary with antennas at a few places and a log of everything each one
 * heard. It is given exactly two things: ITS OWN LOGS, and whatever the server
 * published. Invariant 3 — and, like the matcher, the signature is the
 * enforcement: there is no `World` parameter, so the ground truth cannot reach
 * this code even by accident. The page compares the grouping this returns with
 * the world's presence record AFTERWARDS, and that comparison is what the
 * "linked" label means.
 *
 * What it models: "tech-savvy users, eavesdroppers, and state-level adversaries
 * can locally track infected patients during the (past) window in which the
 * identifiers broadcasted via Bluetooth are linkable. To do so, the attacker
 * uses strategically placed Bluetooth receivers and recording devices to
 * receive EphIDs." (DP-3T white paper, p.28.)
 */

import { idKey, type Design, type Published } from './design'
import type { PlaceId } from './world'

/** One line in an observer's log: an identifier, when, and at which antenna. */
export interface Sighting {
  identifier: Uint8Array
  at: number
  place: PlaceId
}

/** A set of sightings the observer believes belong to one person. */
export interface Group {
  /** Sightings in the order the observer heard them. */
  sightings: Sighting[]
  /** Which published item grouped them, for the page to show. */
  via: string
}

export interface GroupingResult {
  groups: Group[]
  /** The largest group. Before a report this must be 1 — check F. */
  largestGroup: number
  /** Every sighting that the published report recognised, flattened. */
  recognised: Sighting[]
}

/**
 * Group an observer's sightings using only what the server published.
 *
 * With nothing published, every sighting stands alone: a 16-byte pseudorandom
 * identifier is not linkable to another one. That is the "before" state, and
 * it is why the largest group is 1.
 *
 * With a report published, each design groups as much as its published value
 * allows — which is the whole comparison of exhibit 5.
 */
export async function group(
  design: Design,
  sightings: readonly Sighting[],
  published: Published | null,
  days: number,
): Promise<GroupingResult> {
  if (!published || published.items.length === 0) {
    const groups = sightings.map((s) => ({ sightings: [s], via: 'nothing published' }))
    return {
      groups,
      largestGroup: groups.length > 0 ? 1 : 0,
      recognised: [],
    }
  }

  const expanded = await design.expand(published, days)
  const scheduled = new Map<string, number[]>()
  for (const e of expanded) {
    const k = idKey(e.identifier)
    const slots = scheduled.get(k)
    if (slots) slots.push(e.scheduledAt)
    else scheduled.set(k, [e.scheduledAt])
  }

  // One published item that expands to many identifiers groups them all. The
  // unlinkable design publishes one seed per identifier, so each recognised
  // sighting is its own group — recognised individually, never grouped.
  const perItem = expanded.length / published.items.length
  const recognised: Sighting[] = []
  for (const s of sightings) {
    if (scheduled.has(idKey(s.identifier))) recognised.push(s)
  }
  recognised.sort((a, b) => a.at - b.at)

  const groups: Group[] =
    perItem > 1
      ? recognised.length > 0
        ? [{ sightings: recognised, via: `${published.items.length} published value(s)` }]
        : []
      : recognised.map((s) => ({ sightings: [s], via: 'one published seed, one identifier' }))

  const unrecognised = sightings.filter((s) => !scheduled.has(idKey(s.identifier)))
  for (const s of unrecognised) groups.push({ sightings: [s], via: 'not recognised' })

  return {
    groups,
    largestGroup: groups.reduce((n, g) => Math.max(n, g.sightings.length), 0),
    recognised,
  }
}

/**
 * The observer's reconstructed trajectory: the recognised sightings in the
 * order the antennas heard them.
 *
 * Note what this is NOT. The order comes from the OBSERVER'S OWN timestamps,
 * not from the published seed: "since smartphones broadcast the daily set of
 * EphIDs in random order, the attacker cannot use the published seeds SK_t to
 * narrow down this coarse time-window" (white paper, p.30). The seed says these
 * sightings are one person's; the antennas say when and where.
 */
export function trajectory(result: GroupingResult): Sighting[] {
  return [...result.recognised].sort((a, b) => a.at - b.at)
}
