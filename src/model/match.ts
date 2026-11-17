/**
 * Matching, on the phone.
 *
 * `matchLog` is given exactly two things: the matcher's own log, and what the
 * server published. It has no access to the world, to who broadcast what, or to
 * whether anything was relayed — invariant 2, and the reason exhibit 4 works at
 * all. The signature is the enforcement: there is no `world` parameter to pass.
 */

import { idKey, type Design, type ExpandedId, type LogEntry, type Published } from './design'

export interface Match {
  entry: LogEntry
  expanded: ExpandedId
}

export interface MatchResult {
  matches: Match[]
  /** Entries whose bytes matched a published identifier but whose time did not. */
  rejectedByTime: { entry: LogEntry; expanded: ExpandedId }[]
  /** Every log entry, with whether it matched — what the page paints. */
  verdicts: { entry: LogEntry; matched: boolean; rejectedByTime: boolean }[]
  /** How many identifiers the published report expanded to. */
  expandedCount: number
}

/**
 * A match requires BOTH halves, and neither is negotiable (invariant 5):
 *   - byte-for-byte equality of all 16 bytes, and
 *   - the design's time rule.
 *
 * Mutation 9 compares the first 8 bytes only; mutation 8 drops the time rule
 * and the delayed replay of check E then matches.
 */
export async function matchLog(
  design: Design,
  log: readonly LogEntry[],
  published: Published,
  days: number,
): Promise<MatchResult> {
  const expanded = await design.expand(published, days)

  // Index by ALL SIXTEEN BYTES. `idKey` is the whole of invariant 5's first
  // half: a map keyed on the full 32 hex digits is a byte-for-byte comparison,
  // so there is no second check to perform afterwards and no partial match to
  // fall through. The first draft of this function ALSO ran an
  // `identifierEquals` filter over each bucket; mutation 9 proved that filter
  // unreachable — truncating it to 8 bytes changed nothing, because the bucket
  // lookup had already demanded all 16 — so it was deleted rather than left as
  // code that looks like the check and is not. Mutation 9 now patches `idKey`.
  //
  // A bucket rather than a single value: a relay puts the SAME identifier in a
  // different slot, and both the match and the time rejection must stay
  // visible.
  const byBytes = new Map<string, ExpandedId[]>()
  for (const e of expanded) {
    const k = idKey(e.identifier)
    const bucket = byBytes.get(k)
    if (bucket) bucket.push(e)
    else byBytes.set(k, [e])
  }

  const matches: Match[] = []
  const rejectedByTime: { entry: LogEntry; expanded: ExpandedId }[] = []
  const verdicts: MatchResult['verdicts'] = []

  for (const entry of log) {
    // A log entry that is not 16 bytes is not an identifier. Refuse it rather
    // than comparing a prefix.
    if (entry.identifier.length !== 16) {
      throw new RangeError(
        `log entry is ${entry.identifier.length} bytes; a Rolling Proximity Identifier / EphID is 16`,
      )
    }
    // All 16 bytes equal — see the note on `idKey` above.
    const byteMatch = byBytes.get(idKey(entry.identifier)) ?? []
    const timeOk = byteMatch.find((c) => design.withinTimeRule(entry, c))
    if (timeOk) {
      matches.push({ entry, expanded: timeOk })
      verdicts.push({ entry, matched: true, rejectedByTime: false })
    } else if (byteMatch.length > 0) {
      const first = byteMatch[0] as ExpandedId
      rejectedByTime.push({ entry, expanded: first })
      verdicts.push({ entry, matched: false, rejectedByTime: true })
    } else {
      verdicts.push({ entry, matched: false, rejectedByTime: false })
    }
  }

  return { matches, rejectedByTime, verdicts, expandedCount: expanded.length }
}

/** "Exposure matched" or "no exposure" — the phone's whole answer. */
export function exposureVerdict(result: MatchResult): 'exposure' | 'none' {
  return result.matches.length > 0 ? 'exposure' : 'none'
}
