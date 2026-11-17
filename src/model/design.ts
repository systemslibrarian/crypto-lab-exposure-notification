/**
 * The `Design` seam.
 *
 * Three designs are built here. They differ in four places and nowhere else:
 * how a phone derives the identifier it broadcasts in a slot, what it uploads
 * when it reports, how much that upload lets anyone recompute, and what the
 * phone does with its keys afterwards. Everything downstream — the world, the
 * matcher, the linkage observer, the relay — is written against this interface
 * and has no idea which design it is running.
 *
 * [extension] point. A fourth design plugs in here with no change to the
 * matcher, the observer or the UI. The obvious candidates, NOT built here:
 *   - the DP-3T hybrid design (per-window seeds; the white paper, p.20, notes
 *     Apple/Google is its 1-day-window special case);
 *   - a Cuckoo-filter server for the unlinkable design (white paper, p.19) —
 *     this lab publishes the seeds themselves instead;
 *   - a Diffie-Hellman-based design in which two phones derive a shared
 *     encounter token, so no single published value identifies anyone.
 */

import {
  MATCH_TOLERANCE_INTERVALS,
  TEK_ROLLING_PERIOD,
  dayOfIdentifiers,
  rollingProximityId,
  rpiKey,
  temporaryExposureKey,
} from '../crypto/gaen'
import {
  EPOCHS_PER_DAY,
  EPOCH_MINUTES,
  chainFrom,
  dayIdentifiers,
  unlinkableIdentifier,
} from '../crypto/dp3t'
import { bytesEqual, toHex } from '../crypto/bytes'
import { randomBytes } from '../crypto/random'

export type DesignId = 'gaen' | 'dp3t-lowcost' | 'dp3t-unlinkable'

/** One identifier a phone heard, with the slot it was heard in. */
export interface LogEntry {
  identifier: Uint8Array
  /** Absolute slot index on the world's timeline: day * slotsPerDay + slot. */
  heardAt: number
}

/** One identifier recomputed from a published report. */
export interface ExpandedId {
  identifier: Uint8Array
  /** The absolute slot this identifier was scheduled to be broadcast in. */
  scheduledAt: number
  /** Which day of the report this belongs to — the Apple/Google key, or the DP-3T day. */
  day: number
}

/** A phone's secret state. Opaque to everything but its own design. */
export interface PhoneKeys {
  readonly designId: DesignId
  /** One entry per day of the scenario. Contents are design-specific. */
  readonly days: readonly Uint8Array[]
  /** For the unlinkable design only: one random seed per slot of every day. */
  readonly slotSeeds?: readonly (readonly Uint8Array[])[]
}

/** What a reporting phone uploads to the server. */
export interface Published {
  readonly designId: DesignId
  /** A human-readable description of each uploaded item, for the server panel. */
  readonly items: readonly PublishedItem[]
}

export interface PublishedItem {
  readonly label: string
  readonly value: Uint8Array
  /** The day this item is anchored to. */
  readonly day: number
  /** For the unlinkable design, the slot within the day. */
  readonly slot?: number
}

export interface Design {
  readonly id: DesignId
  readonly label: string
  /** Minutes one identifier is broadcast for. */
  readonly slotMinutes: number
  /** How many identifiers one day holds. */
  readonly slotsPerDay: number
  /** What the matcher's time rule is, in words, for the page and the tests. */
  readonly timeRule: string
  /** What one published item lets an observer recompute, in words. */
  readonly linkage: string

  createKeys(days: number): Promise<PhoneKeys>
  /** The identifier broadcast in absolute slot `at`. */
  identifierAt(keys: PhoneKeys, at: number): Promise<Uint8Array>
  /** The upload a phone makes when it reports, covering `fromDay` onwards. */
  publish(keys: PhoneKeys, fromDay: number, days: number): Published
  /** Every identifier the published report lets anyone recompute. */
  expand(published: Published, days: number): Promise<ExpandedId[]>
  /** The time half of the match rule. Byte equality is checked separately. */
  withinTimeRule(entry: LogEntry, expanded: ExpandedId): boolean
  /** The phone's keys after reporting. */
  afterReport(keys: PhoneKeys, days: number): Promise<PhoneKeys>
}

const dayOf = (slotsPerDay: number, at: number): number => Math.floor(at / slotsPerDay)

// ── Apple/Google ────────────────────────────────────────────────────────────

/**
 * Slots are the specification's 10-minute ENIntervalNumbers, so a day is 144 of
 * them and `at` is an interval number offset from day 0 of the scenario.
 */
export const gaenDesign: Design = {
  id: 'gaen',
  label: 'Apple/Google',
  slotMinutes: 10,
  slotsPerDay: TEK_ROLLING_PERIOD,
  timeRule: `heard within ±${MATCH_TOLERANCE_INTERVALS} intervals (±2 hours) of the interval the identifier belongs to`,
  linkage: 'one key covers one day; keys are independent, so a key published for one day links that day only',

  async createKeys(days: number): Promise<PhoneKeys> {
    return {
      designId: 'gaen',
      days: Array.from({ length: days }, () => randomBytes(16)),
    }
  },

  async identifierAt(keys: PhoneKeys, at: number): Promise<Uint8Array> {
    const day = dayOf(TEK_ROLLING_PERIOD, at)
    const tek = keys.days[day]
    if (!tek) throw new RangeError(`no Temporary Exposure Key for day ${day}`)
    const rpik = (await rpiKey(tek)).okm
    return rollingProximityId(rpik, at)
  },

  publish(keys: PhoneKeys, fromDay: number, days: number): Published {
    const items: PublishedItem[] = []
    for (let day = fromDay; day < days; day++) {
      const tek = keys.days[day]
      if (!tek) continue
      items.push({ label: `TEK day ${day} (start interval ${day * TEK_ROLLING_PERIOD})`, value: tek, day })
    }
    return { designId: 'gaen', items }
  },

  async expand(published: Published): Promise<ExpandedId[]> {
    const out: ExpandedId[] = []
    for (const item of published.items) {
      const start = item.day * TEK_ROLLING_PERIOD
      const { ids } = await dayOfIdentifiers(temporaryExposureKey(item.value, start))
      ids.forEach((identifier, k) => {
        out.push({ identifier, scheduledAt: start + k, day: item.day })
      })
    }
    return out
  },

  withinTimeRule(entry: LogEntry, expanded: ExpandedId): boolean {
    return Math.abs(entry.heardAt - expanded.scheduledAt) <= MATCH_TOLERANCE_INTERVALS
  },

  async afterReport(keys: PhoneKeys): Promise<PhoneKeys> {
    // Apple/Google keys are already independent of one another, so reporting
    // day d says nothing about day d+1. Nothing needs to change.
    return keys
  },
}

// ── DP-3T low-cost ──────────────────────────────────────────────────────────

/** Slots are 15-minute epochs, 96 to a day. */
export const dp3tLowCostDesign: Design = {
  id: 'dp3t-lowcost',
  label: 'DP-3T low-cost',
  slotMinutes: EPOCH_MINUTES,
  slotsPerDay: EPOCHS_PER_DAY,
  timeRule: 'heard on the same day the identifier belongs to',
  linkage: 'one seed hashes forward, so the seed of the first contagious day links every day after it',

  async createKeys(days: number): Promise<PhoneKeys> {
    return { designId: 'dp3t-lowcost', days: await chainFrom(randomBytes(32), days) }
  },

  async identifierAt(keys: PhoneKeys, at: number): Promise<Uint8Array> {
    const day = dayOf(EPOCHS_PER_DAY, at)
    const seed = keys.days[day]
    if (!seed) throw new RangeError(`no day seed for day ${day}`)
    const ids = await dayIdentifiers(seed)
    const id = ids[at % EPOCHS_PER_DAY]
    if (!id) throw new RangeError(`no identifier for slot ${at % EPOCHS_PER_DAY}`)
    return id
  },

  publish(keys: PhoneKeys, fromDay: number): Published {
    const seed = keys.days[fromDay]
    if (!seed) throw new RangeError(`no day seed for day ${fromDay}`)
    // ONE item, however many days the window covers: that is the whole point.
    return {
      designId: 'dp3t-lowcost',
      items: [{ label: `SK_t for day ${fromDay} (first contagious day)`, value: seed, day: fromDay }],
    }
  },

  async expand(published: Published, days: number): Promise<ExpandedId[]> {
    const out: ExpandedId[] = []
    for (const item of published.items) {
      // Hash forward from the published seed: every later day too.
      const chain = await chainFrom(item.value, days - item.day)
      for (let offset = 0; offset < chain.length; offset++) {
        const day = item.day + offset
        const ids = await dayIdentifiers(chain[offset] as Uint8Array)
        ids.forEach((identifier, slot) => {
          out.push({ identifier, scheduledAt: day * EPOCHS_PER_DAY + slot, day })
        })
      }
    }
    return out
  },

  withinTimeRule(entry: LogEntry, expanded: ExpandedId): boolean {
    // "checks (1) if it has observed any beacon with one of these EphIDs on day
    // t'" — the white paper, p.16. A day, not a sliding window: identifiers go
    // out in random order within the day, so there is no interval to be near.
    return dayOf(EPOCHS_PER_DAY, entry.heardAt) === expanded.day
  },

  async afterReport(_keys: PhoneKeys, days: number): Promise<PhoneKeys> {
    // "the smartphone deletes SK_t. It then picks a completely new random seed"
    // (white paper, p.16). NOT the hash of the reported seed — if it were, the
    // published seed would keep linking the user forever.
    return { designId: 'dp3t-lowcost', days: await chainFrom(randomBytes(32), days) }
  },
}

// ── DP-3T unlinkable ────────────────────────────────────────────────────────

export const dp3tUnlinkableDesign: Design = {
  id: 'dp3t-unlinkable',
  label: 'DP-3T unlinkable',
  slotMinutes: EPOCH_MINUTES,
  slotsPerDay: EPOCHS_PER_DAY,
  timeRule: 'heard in the same epoch the identifier belongs to',
  linkage: 'one seed is one epoch; nothing published links two sightings together',

  async createKeys(days: number): Promise<PhoneKeys> {
    return {
      designId: 'dp3t-unlinkable',
      days: Array.from({ length: days }, () => new Uint8Array(0)),
      slotSeeds: Array.from({ length: days }, () =>
        Array.from({ length: EPOCHS_PER_DAY }, () => randomBytes(32)),
      ),
    }
  },

  async identifierAt(keys: PhoneKeys, at: number): Promise<Uint8Array> {
    const day = dayOf(EPOCHS_PER_DAY, at)
    const seed = keys.slotSeeds?.[day]?.[at % EPOCHS_PER_DAY]
    if (!seed) throw new RangeError(`no epoch seed for slot ${at}`)
    return unlinkableIdentifier(seed)
  },

  publish(keys: PhoneKeys, fromDay: number, days: number): Published {
    const items: PublishedItem[] = []
    for (let day = fromDay; day < days; day++) {
      const seeds = keys.slotSeeds?.[day] ?? []
      seeds.forEach((value, slot) => {
        items.push({ label: `seed for day ${day} epoch ${slot}`, value, day, slot })
      })
    }
    return { designId: 'dp3t-unlinkable', items }
  },

  async expand(published: Published): Promise<ExpandedId[]> {
    const out: ExpandedId[] = []
    for (const item of published.items) {
      const slot = item.slot ?? 0
      out.push({
        identifier: await unlinkableIdentifier(item.value),
        scheduledAt: item.day * EPOCHS_PER_DAY + slot,
        day: item.day,
      })
    }
    return out
  },

  withinTimeRule(entry: LogEntry, expanded: ExpandedId): boolean {
    // "ephemeral identifiers are cryptographically linked to the epoch in which
    // they are broadcast" (white paper, p.36) — exact epoch, no tolerance.
    return entry.heardAt === expanded.scheduledAt
  },

  async afterReport(_keys: PhoneKeys, days: number): Promise<PhoneKeys> {
    return this.createKeys(days)
  },
}

export const DESIGNS: readonly Design[] = [gaenDesign, dp3tLowCostDesign, dp3tUnlinkableDesign]

export function designById(id: DesignId): Design {
  const found = DESIGNS.find((d) => d.id === id)
  if (!found) throw new RangeError(`unknown design ${id}`)
  return found
}

/** Byte-for-byte equality of all 16 bytes. Invariant 5's first half. */
export function identifierEquals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === 16 && b.length === 16 && bytesEqual(a, b)
}

export const idKey = (id: Uint8Array): string => toHex(id)
