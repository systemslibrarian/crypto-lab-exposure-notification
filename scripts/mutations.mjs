/**
 * The mutation ledger: each entry is a CONCRETE PATCH, never a sentence
 * describing an edit.
 *
 * Master template 4.1c. An `anchor` must occur EXACTLY ONCE in `file`, or the
 * runner refuses the mutation rather than guessing — a patch that silently
 * matched nothing is how a false "the oracle is dead" gets recorded.
 *
 * Eleven mutations, all eleven named by this lab's brief. Each one is a change
 * a careful implementer could plausibly make by accident, which is the only
 * kind worth testing.
 */
export const MUTATIONS = [
  {
    id: 1,
    what: 'the interval number is written BIG-endian in PaddedData',
    file: 'src/crypto/gaen.ts',
    anchor: "  new DataView(block.buffer).setUint32(12, interval, /* littleEndian */ true)",
    replacement: "  new DataView(block.buffer).setUint32(12, interval, /* littleEndian */ false)",
    expect: 'src/crypto/gaen.test.ts',
  },
  {
    id: 2,
    what: 'the six zero bytes are placed AFTER the interval number instead of before it',
    file: 'src/crypto/gaen.ts',
    anchor: `  block.set(RPI_PREFIX, 0)
  // Bytes 6..11 are already zero. The interval occupies the last four, LE.
  new DataView(block.buffer).setUint32(12, interval, /* littleEndian */ true)`,
    replacement: `  block.set(RPI_PREFIX, 0)
  new DataView(block.buffer).setUint32(6, interval, /* littleEndian */ true)`,
    expect: 'src/crypto/gaen.test.ts',
  },
  {
    id: 3,
    what: 'RPIK is derived with info "EN-RPI" rather than "EN-RPIK"',
    file: 'src/crypto/gaen.ts',
    anchor: "const RPIK_INFO = utf8('EN-RPIK')",
    replacement: "const RPIK_INFO = utf8('EN-RPI')",
    expect: 'src/crypto/gaen.test.ts',
  },
  {
    id: 4,
    what: 'the HKDF expand step omits the 0x01 counter byte',
    file: 'src/crypto/hkdf.ts',
    anchor: "  const okm = (await hmacSha256(prk, concatBytes(info, Uint8Array.of(0x01)))).subarray(0, 16)",
    replacement: "  const okm = (await hmacSha256(prk, info)).subarray(0, 16)",
    expect: 'src/crypto/primitives.test.ts',
  },
  {
    id: 5,
    what: 'the metadata is encrypted under a ZERO counter block instead of the RPI',
    file: 'src/crypto/gaen.ts',
    anchor: `export async function associatedEncryptedMetadata(
  aemk: Uint8Array,
  rpi: Uint8Array,
  metadata: Uint8Array,
): Promise<Uint8Array> {
  return aesCtr(aemk, rpi, metadata)
}`,
    replacement: `export async function associatedEncryptedMetadata(
  aemk: Uint8Array,
  rpi: Uint8Array,
  metadata: Uint8Array,
): Promise<Uint8Array> {
  void rpi
  return aesCtr(aemk, new Uint8Array(16), metadata)
}`,
    expect: 'src/crypto/gaen.test.ts',
  },
  {
    id: 6,
    what: 'the DP-3T day chain is not advanced: SK_1 = SK_0',
    file: 'src/crypto/dp3t.ts',
    anchor: `export async function advanceSeed(seed: Uint8Array): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new RangeError(\`a DP-3T day seed is 32 bytes, got \${seed.length}\`)
  }
  return sha256(seed)
}`,
    replacement: `export async function advanceSeed(seed: Uint8Array): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new RangeError(\`a DP-3T day seed is 32 bytes, got \${seed.length}\`)
  }
  return seed
}`,
    expect: 'src/crypto/dp3t.test.ts',
  },
  {
    id: 7,
    what: 'the DP-3T generator is keyed with SK_t directly, skipping the PRF',
    file: 'src/crypto/dp3t.ts',
    anchor: `  const key = await broadcastKey(seed)
  const stream = await aesCtr(key, new Uint8Array(16), new Uint8Array(16 * count))`,
    replacement: `  const stream = await aesCtr(seed, new Uint8Array(16), new Uint8Array(16 * count))`,
    expect: 'src/crypto/dp3t.test.ts',
  },
  {
    id: 8,
    what: 'the matcher ignores the interval an identifier was heard in',
    file: 'src/model/match.ts',
    anchor: "    const timeOk = byteMatch.find((c) => design.withinTimeRule(entry, c))",
    replacement: "    const timeOk = byteMatch[0]",
    expect: 'src/model/relay.test.ts',
  },
  {
    id: 9,
    what: 'the matcher compares only the first 8 bytes of an identifier',
    // Patches `idKey`, which is where the comparison actually happens. The
    // first version of this mutation patched an `identifierEquals` filter in
    // matchLog and SURVIVED — not because the tests were weak, but because the
    // filter ran after a map lookup on all 32 hex digits and could never
    // remove anything. That was a finding about the source: the dead filter
    // was deleted and `idKey` documented as the single point of comparison.
    file: 'src/model/design.ts',
    anchor: `  return toHex(id)
}`,
    replacement: `  return toHex(id).slice(0, 16)
}`,
    expect: 'src/model/match.test.ts',
  },
  {
    id: 10,
    what: 'after a report the DP-3T phone continues the old chain instead of starting fresh',
    file: 'src/model/design.ts',
    anchor: `  async afterReport(_keys: PhoneKeys, days: number): Promise<PhoneKeys> {
    // "the smartphone deletes SK_t. It then picks a completely new random seed"
    // (white paper, p.16). NOT the hash of the reported seed — if it were, the
    // published seed would keep linking the user forever.
    return { designId: 'dp3t-lowcost', days: await chainFrom(randomBytes(32), days) }
  },`,
    replacement: `  async afterReport(keys: PhoneKeys, days: number): Promise<PhoneKeys> {
    const last = keys.days[keys.days.length - 1]
    if (!last) return keys
    return { designId: 'dp3t-lowcost', days: await chainFrom(last, days) }
  },`,
    expect: 'src/model/observer.test.ts',
  },
  {
    id: 11,
    what: 'the "never co-located" claim is computed from the matcher instead of the world model',
    // The faithful patch, and it lives in the UI because that is where the
    // claim is rendered: `together` stops being a fact about the world and
    // becomes a restatement of the match. Its oracle is the claims suite's
    // "BITE: the clause tracks the WORLD" test, which reads the three states
    // no function of `exposed` alone can produce.
    //
    // An earlier version patched `wereColocated` with
    // `world.presence.length > 0 && world.places.length < 2` and SURVIVED —
    // because that expression happens to return the CORRECT answer for both
    // fixtures (apart has two places, together has one). A mutation that
    // accidentally reimplements the function is not evidence about the tests,
    // so it was replaced rather than recorded.
    file: 'src/ui/exhibit4-relay.ts',
    anchor: "  const together = wereColocated(world, 'A', 'B')",
    // `void wereColocated` keeps the import used, so the patch COMPILES and the
    // suite result can be trusted. Without it tsc raises TS6133 and the runner
    // correctly records DOES-NOT-BUILD instead of a kill.
    replacement: '  const together = exposed\n  void wereColocated',
    expect: 'e2e/claims.spec.ts',
  },
  {
    id: 12,
    what: 'co-location ignores WHEN, counting two phones that visited one place at different times',
    // Not in the brief's eleven. Added because mutation 11 moved to the UI and
    // `wereColocated` itself should still be shown to have an oracle. Its first
    // run SURVIVED against relay.test.ts, which was a finding: both relay
    // scenarios put A and B at places neither ever visits, so nothing there
    // could tell "same place at the same time" from "same place ever". That is
    // the difference between proximity and a shared address, and it now has
    // src/model/world.test.ts.
    file: 'src/model/world.ts',
    anchor: `  for (const slot of world.slots) {
    const pa = placeOf(world, a, slot)
    if (pa === undefined) continue
    if (pa === placeOf(world, b, slot)) return true
  }
  return false`,
    replacement: `  const placesOf = (p: PhoneId): Set<string> =>
    new Set(world.presence.filter((x) => x.phone === p).map((x) => x.place))
  const pa = placesOf(a)
  for (const place of placesOf(b)) if (pa.has(place)) return true
  return false`,
    expect: 'src/model/world.test.ts',
  },
]
