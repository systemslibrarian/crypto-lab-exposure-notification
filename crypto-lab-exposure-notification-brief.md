# Build brief — crypto-lab-exposure-notification

Written 15 November 2026. Paste this whole file to the coding agent, or save it as `brief.md`
in the new repo. It is self-contained apart from `_MASTER-TEMPLATE.md`, which must be in the
repo root (or readable at `audits/_MASTER-TEMPLATE.md` in the crypto-lab catalog repo).

Source documents are on the owner's machine at
`~/Downloads/crypto-lab-brief-sources/crypto-lab-exposure-notification/`. Read them there; do
not search the web for copies, do not copy the PDFs into the repo, do not commit them.

---

## KICKOFF (read this first)

Build a new Crypto Lab browser demo (Vite + TypeScript, static site, no backend) in the
repository **`crypto-lab-exposure-notification`**.

Read `_MASTER-TEMPLATE.md` in full and treat it as the BINDING spec for build, teaching,
look, accessibility, README and deploy. If `audits/kickoff.md` has been given to you, it
governs how you work inside this repo. This brief supplies only the demo-specific facts and
the acceptance checks. Where the template and this brief disagree on build/teach/look/a11y,
the template wins. Where this brief states cryptographic facts, check them against the cited
primary sources and by computation; if you find one wrong, do not silently deviate: write
"Brief said X; that is wrong because Y (source or computation)" in your report and build the
correct thing.

Build to every standard in the template, in its order: §1 Build, §3 Look, §2 Teach,
§4 Accessibility (including §4.1a setup rules, §4.1b claims suite, §4.1c mutation
discipline run from a script, §4.1d negative claim), §5 README, §6 Deploy with §6.1 and §6.2.

Hard rules (from the template; repeated because they are the ones that get broken):
real computation only, never a canned or simulated verdict; honest scoping in the page and
the README; do NOT weaken a gate to get a green run; if something cannot pass honestly,
leave it failing and say so. Do not touch the shared catalog files. Copy the top bar from an
existing lab. Copy the accessibility gate and `claims.spec.ts` shape from
`crypto-lab-schnorr-forge` and rewrite every lab-specific passage.

When done, report: one-line summary with the test count; the mutation ledger (each mutation,
killed or not); whether you found official test vectors for the Apple/Google key schedule and
how they compare with check B; the matching time tolerance you used and where it comes from;
confirmation that grouping / auto-merge / PR gate / workflow_dispatch are all present; and
the card metadata listed at the end of this brief.

---

## NEW DEMO BRIEF

- Repo name:         crypto-lab-exposure-notification
- Short name (H1):   Exposure Notification
- Subtitle:          Rolling identifiers · matching on the phone · relay and linkage
- One-liner:         Browser-based exposure notification as deployed in 2020 — the Apple/Google key schedule and the DP-3T designs computed with real HKDF, HMAC, SHA-256 and AES, matching done on the "phone", then the two things the cryptography cannot prevent: a relayed identifier that matches like a real encounter, and a reported key that links a day of sightings
- Concept to teach:  A phone broadcasts identifiers derived from a secret it keeps; publishing the secret later lets everyone who heard an identifier recognise it locally. That same step is what lets a relay fake an encounter and lets an observer link a reporter's sightings, and the designs differ in how much one published value links.
- Primitives/spec:   Apple and Google, "Exposure Notification Cryptography Specification" v1.2 (April 2020) and Google's reference implementation (github.com/google/exposure-notifications-internals, `CRYPTO.md`). DP-3T Project, "Decentralized Privacy-Preserving Proximity Tracing" (white paper, version of 25 May 2020). HKDF (RFC 5869), HMAC-SHA-256, SHA-256, AES-128 (FIPS 197), counter mode (NIST SP 800-38A). Analyses: S. Vaudenay, "Analysis of DP3T" (IACR ePrint 2020/399), and the two further papers under SOURCES.
- Accent (--accent): #8fb339   (not used by any of the 203 labs whose accent is recorded in the 12 November 2026 snapshot; confirm against the live catalog and against neighbouring cards)
- Favicon emoji:     📡
- In scope:          see SCOPE below
- Non-goals:         see SCOPE below

GitHub "About" line: use the one-liner above.

---

## PRE-FLIGHT (verify, do not assume)

1. Confirm the repository name is free under `systemslibrarian` and no catalog card is titled
   "Exposure Notification".
2. In the catalog repo, search `CATALOG.md` and the lab READMEs for `exposure notification`,
   `contact tracing`, `proximity tracing`, `DP-3T`, `DP3T`, `GAEN`, `rolling proximity`,
   `EphID`. What the brief author found (12 November 2026 snapshot): no lab covers any of
   them. If one does, STOP and report. Link the labs you actually find on HKDF, on Bluetooth
   pairing, on distance bounding or relay attacks, and on private set intersection under
   Related Demos, with one line each on how they differ.
3. Playwright port: ask the catalog tool (`node tools/port-sync.js` in the catalog repo). If you
   cannot reach the catalog repo, stop and ask the owner for a port. Never 4173.

---

## SOURCES AND WHAT EACH IS FOR

- **Google's reference implementation**, `CRYPTO.md` and `KeyDerivation.java` at
  `https://raw.githubusercontent.com/google/exposure-notifications-internals/main/` (read in
  full by the brief author on 15 November 2026). The Apple/Google key schedule in FACTS 1 to 4
  is taken from these and agrees with the specification's own formulas.
- **The specification** (v1.2, April 2020; `CRYPTO.md` links the PDF). The brief author saw
  its formulas only through a search extract. Open it and confirm FACTS 1 to 4, in particular
  the byte order of the interval number. The companion **Bluetooth specification** (metadata
  layout) was NOT read by the brief author.
- **DP-3T white paper**, 25 May 2020 (in the sources folder; fetched from the project's
  public repository). Read by the brief author: the low-cost design, the unlinkable design's
  identifier rule, the hybrid design's identifier rule, what a phone does after reporting,
  and the passages on relay attacks and on linkability of reported identifiers.
- **ePrint 2020/399** (in the folder): Vaudenay's analysis. Read: the protocol restatement
  and the attack sections on false-alert injection and tracking. It notes that the early
  DP-3T text left the hash and the generator unspecified, which is why FACTS 6 fixes them.
- **ePrint 2020/428** and **ePrint 2022/166** (in the folder): the brief author read the
  introduction and one attack of the first, and the abstract, requirements and attack
  overview of the second. Cite them only for what you verify yourself.
- The brief author searched for official test vectors for the Apple/Google schedule and did
  not find them. If you find an official set, use it and report how it compares with check B.

---

## FACTS (write tests from these, not from your code)

**Apple/Google design (as in the reference implementation):**

1. Time is cut into 10-minute intervals: ENIntervalNumber = ⌊Unix time in seconds / 600⌋. A
   Temporary Exposure Key (TEK) is 16 random bytes, valid for 144 intervals (24 hours)
   starting at an interval number that is a multiple of 144. TEKs are independent of one
   another.
2. RPIK = HKDF-SHA-256(input = TEK, salt absent, info = UTF-8 "EN-RPIK", 16 bytes).
   AEMK = the same with info "EN-AEMK". With 16 bytes of output HKDF's expand step is one
   HMAC call with counter byte 0x01, truncated to 16 bytes.
3. Rolling Proximity Identifier for interval j: AES-128 encryption (single block) under RPIK
   of the 16 bytes "EN-RPI" (6 bytes) ‖ six zero bytes ‖ j as a 4-byte LITTLE-endian integer.
4. Associated Encrypted Metadata: AES-128 in counter mode under AEMK, with the RPI as the
   initial counter block, over the metadata bytes (4 bytes in the Bluetooth specification).
   There is no authentication tag.
5. When a user reports, the phone uploads its recent TEKs with their start intervals; other
   phones download them, recompute each TEK's 144 RPIs and compare with what they heard.

**DP-3T designs (white paper, 25 May 2020):**

6. *Low-cost design.* A day seed SK_t; each day SK_t = H(SK_{t−1}). The day's identifiers
   are EphID_1 ‖ … ‖ EphID_n = PRG(PRF(SK_t, "broadcast key")), 16 bytes each,
   n = (24 × 60) / L for an epoch of L minutes, broadcast in a random order. The paper gives
   HMAC-SHA-256 and AES in counter mode as examples and fixes neither. **This lab's concrete
   choices (state them on the page):** H = SHA-256; PRF = HMAC-SHA-256 with key SK_t and
   message the ASCII bytes of `broadcast key`; PRG = AES-256 in counter mode keyed with the
   32-byte PRF output, initial counter block of 16 zero bytes, encrypting zeros; L = 15,
   n = 96. Do not claim these match any deployed app.
7. A reporting user uploads the seed of the FIRST contagious day; everyone can hash forward
   to the later days. After reporting, the phone deletes that seed and starts from a
   completely new random seed, so that the user is not trackable afterwards.
8. The white paper says of this design that one uploaded seed lets others reconstruct, and
   therefore link, that person's identifiers for the whole contagious window, so receivers
   placed around a town can trace a reporter's past movements.
9. *Unlinkable design.* Each epoch has its own random 32-byte seed and
   EphID_i = the leftmost 128 bits of H(seed_i). (The server side uses a Cuckoo filter over
   hashed identifiers; not built here, see SCOPE.)
10. *Relay.* The white paper describes relaying broadcasts to distant places so that phones
    there perceive proximity where there is none; Vaudenay's analysis gives false-alert
    injection its own section.

---

## SCOPE

In scope, as exhibits in this order:

1. **One phone, one day (Apple/Google).** TEK → RPIK → the day's 144 identifiers, with the
   padded block shown byte by byte; AEMK and one encrypted metadata value.
2. **One phone, several days (DP-3T low-cost).** The hash chain, the day's 96 identifiers,
   the random broadcast order.
3. **Hearing and matching.** Two or three simulated phones on a small timeline the learner
   controls (who is near whom in which interval). A phone stores (identifier, interval
   heard). One user reports; the others download the key and match locally. The page shows
   what the server learned (the keys) and what it did not (who met whom).
4. **Relay.** An attacker's receiver near user A and transmitter near user B, never near each
   other. B's phone stores A's identifier. A reports; B is told of an exposure. Then a
   delayed replay outside the time tolerance, which the matcher rejects.
5. **Linkage after a report.** Receivers at three places log every identifier with its
   time. Before the report nothing groups them. After A reports, recomputing A's identifiers
   picks A's sightings out of the logs in order. Side by side: Apple/Google (one day per
   key, days not chained), DP-3T low-cost (one seed, every later day), DP-3T unlinkable
   (sightings can be recognised as "some reporter" one at a time but are not grouped).
6. **Metadata is malleable.** Flip one bit of the encrypted metadata; it decrypts to a
   different transmit-power byte with no error.

Non-goals (say so on the page and in the README): Bluetooth itself, signal strength and
distance estimation, risk scoring, the upload-authorisation step, the Cuckoo filter, the
hybrid DP-3T design, centralised designs, any epidemiological claim, and any claim about the
behaviour of a particular country's app. The "phones" are simulated in one browser tab.

---

## SECURITY / CORRECTNESS INVARIANTS

1. Every identifier shown is computed from its key by the real derivation; none is a
   placeholder.
2. Matching is done by code that receives only the matcher's own log and the published keys.
3. The linkage observer receives only its logs and the published keys; "linked" is decided
   by comparing its grouping with the ground truth afterwards.
4. Keys and seeds come from `crypto.getRandomValues`; the random broadcast order uses an
   unbiased shuffle from the same source. Fixed vectors are injected only in tests and in a
   clearly labelled "use test vector" control.
5. A match requires byte-for-byte equality of all 16 bytes AND the time rule of FACTS (see
   check D).
6. No location, contact or health data is requested, stored or sent.

---

## ARCHITECTURE

Pure modules, no DOM: `hkdf.ts`, `gaen.ts` (FACTS 1 to 5), `dp3t.ts` (FACTS 6 to 9),
`world.ts` (the timeline model: who hears what, when), `match.ts`, `observer.ts`, `relay.ts`.
HMAC, SHA-256, AES-CTR via WebCrypto. A single AES-128 block for FACTS 3 can be had from
WebCrypto AES-CTR (encrypting 16 zero bytes with the block as the counter gives E(block))
or AES-CBC; state which you use.

---

## UI AND VISUAL SEMANTICS

Follow §3. The timeline is a real table (rows: intervals; columns: places or phones), usable
by keyboard. Identifiers in tabular hexadecimal, shortened only with the full value available
to assistive technology. "Matched", "relayed" and "linked" are text labels, never colour
alone. The server's view is a separate, labelled panel.

---

## EDGE CASES (each fails closed and teaches via its message)

- A TEK whose start interval is not a multiple of 144: refused.
- An identifier heard outside the reported key's validity (wrong day): no match.
- A replay outside the time tolerance: no match, and the page says why.
- Two phones broadcasting in the same interval: both stored; matching is per identifier.
- A reported key with no heard identifiers: "no exposure".
- A 15-byte or 17-byte identifier in a log: rejected.
- DP-3T: after a report, the next day's seed is NOT the hash of the reported one.

---

## EXTENSION SEAMS (shape now, do not build)

A `Design` interface (derive identifiers; what is published; how to match) so the hybrid
design, a Cuckoo-filter server, or a Diffie-Hellman-based design could be added. Name these
on the page as "not built here".

---

## ACCEPTANCE CHECKS — expected outcomes, derived independently of any implementation

**A. Primitives.** HKDF-SHA-256, RFC 5869 test case 1 (output begins `3cb25f25faacd57a`,
ends `d5b887185865`) and test case 3 (no salt, no info; output begins `8da4e775a563c18f`):
take the full values from the RFC. FIPS 197 Appendix C.1 for AES-128. One multi-block
counter-mode vector from NIST SP 800-38A.

**B. Apple/Google schedule** (computed by the brief author with Python's `hmac`, `hashlib`
and the `cryptography` library's AES, from FACTS 1 to 4; not an official vector).
TEK = `000102030405060708090a0b0c0d0e0f`, start interval 2650032 (a multiple of 144;
21 May 2020 00:00 UTC).
- RPIK = `4c3615250075e094e42e1b72e538ded2`; AEMK = `3454dd8d8c8c835029754c15df6d44d7`.
- Interval 2650032: padded block `454e2d525049000000000000b06f2800`,
  RPI `4b0cf5c1f7df9c034746e5d13e84de55`.
- Interval 2650033: RPI `8bb413946aadb7085c53e636b24f2892`.
- Interval 2650175 (last of the day): padded block `454e2d5250490000000000003f702800`,
  RPI `ab873398fbc3c137ccfb766a4da39e9f`.
- The 144 RPIs of the day are distinct; SHA-256 of their concatenation in interval order is
  `f094836c0232c429e42ff6f0430c54d21e97c8b0ceb54fec3941a9a8d4cf9437`.
- Metadata bytes `40 f8 00 00` under AEMK with the first RPI as counter block encrypt to
  `4472d2ef`. (The four bytes are a test value; confirm the real layout in the Bluetooth
  specification before labelling them.)

**C. DP-3T low-cost, with the choices of FACTS 6.** SK_0 = bytes `00 01 … 1f`.
- SK_1 = `630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd`;
  SK_2 = `2f287b4d3d4910f6cada9e1bd1b4648099e8c52c81aa4a6aebfa6fc86f19834e`.
- PRF(SK_0) = `b0912940a0c51ea8efb6d31397cab26767e95667f7ccca1b754c4cee774db972`.
- Day 0: EphID_1 = `3a84e9f7ed7b85e0691d2b9fc9c23be1`,
  EphID_2 = `741b0d80a98c8983ef8566f6434dd087`,
  EphID_96 = `742721f7e38b53da157821c0a38036b7`; SHA-256 of the 96 identifiers in
  generation order = `79f59d2f19942be50f61417ed31959ae7d3930e7e86d33b93cf93b441df202da`.
- Day 1: EphID_1 = `00fd8dd699e9cdf4cfa5ff0b232c4f11`.
- Unlinkable design: seed = bytes `40 41 … 5f` gives EphID
  `ca2a4fe727faaecf16ecd130a86e0885`.
- The broadcast order is a permutation of the 96 (test: sorted equals generated, order
  differs across runs).

**D. Matching.** With the vector of check B: a log entry (first RPI, heard in interval
2650032) matches; the same RPI heard in an interval further from 2650032 than the tolerance
does not; the RPI with one bit changed does not; an RPI of a different TEK does not.
Tolerance: find the value the specification or the reference implementation uses and cite
where; if you cannot, use 12 intervals (two hours), label it as this lab's parameter and say
so in the report.

**E. Relay.** Scenario with A and B never in the same place: with the relay active in the
same interval, B's matcher reports an exposure after A reports. With a replay delayed
beyond the tolerance, it reports none. The world model's ground truth says A and B were
never co-located in both runs (assert it).

**F. Linkage.** Three receivers, 10 phones, one day, one reporter, random movement fixed by
a seed in the test. Before the report the observer's grouping function returns no group
larger than one. After the report: Apple/Google and DP-3T low-cost observers return exactly
the reporter's sightings, in time order, equal to ground truth. With a two-day scenario:
Apple/Google given only day 1's key links day 1 only; DP-3T low-cost given the day-1 seed
links both days. Unlinkable design: every reporter sighting is recognised individually and
the observer's grouping function still returns no group larger than one.

**G. Metadata.** For check B's metadata, flipping bit 0x10 of the second ciphertext byte
makes it decrypt to `40 e8 00 00`, with no error raised.

**H. Mutations that must be killed (§4.1c, run from a script, each a concrete patch).**
(1) interval number written big-endian; (2) the six zero bytes placed after the interval
number; (3) RPIK derived with info "EN-RPI"; (4) HKDF expand without the counter byte;
(5) metadata encrypted with a zero counter block instead of the RPI; (6) DP-3T chain not
advanced (SK_1 = SK_0); (7) DP-3T generator keyed with SK_t directly, skipping the PRF;
(8) matcher ignores the interval heard (the delayed replay of check E then matches);
(9) matcher compares the first 8 bytes only; (10) after a report the phone continues the
old chain (the edge-case test fails); (11) the "never co-located" assertion of check E is
computed from the matcher's output instead of the world model. A surviving mutation is
reported, not explained away.

**I. Fail-closed paths, each a NAMED test:** every item under EDGE CASES; invariants 2 and 3.

**J. Claims suite (§4.1b).** At minimum: every identifier on screen is recomputed in the
test from the key on screen with the test's own HKDF and AES calls; the number of
identifiers shown per day equals 144 (or 96); a "matched" label appears exactly on the log
rows whose identifier the test recomputes from a published key; the server panel contains
keys and no log entries; the observer's linked rows equal the reporter's rows in the world
model; stale verdicts are retired when the timeline or the design changes; the no-op guard;
the `[hidden]` probe.

---

## NEGATIVE CLAIM (§4.1d)

Claim, scoped to the scenario on the page: **"A match says that an identifier this phone
heard was derived from a reported key. It says nothing about whether the two people were
near each other: in this scenario they never were, and the match is the same."**

Evidence fixture: exhibit 4 with the relay active. Every check the phone can make passes
(16-byte identifier, valid day, within the time tolerance, key published by the server) and
the verdict reads `EXPOSURE MATCHED — AND THE TWO PHONES WERE NEVER NEAR EACH OTHER`, with
the negative-claim sentence and the world model's co-location record visible in that state.

Bite fixture for mutation (11): a scenario in which A and B really are co-located; the page
must NOT show the "never near each other" clause there. The three assertions and two bite
tests are as §4.1d specifies.

---

## README NOTES

Follow §5. "What It Is" names both families of design, the primitives, the two limits, and
"not production software — a teaching demo; the phones are simulated". "When to Use It" must
include a "do NOT": do not read this page as an assessment of any national app. "What Can Go
Wrong" is relay, linkage and unauthenticated metadata, each attributed to the document that
states it (the DP-3T white paper states the first two about its own design). "Real-World
Usage": cite only what you verify from primary sources (which system used which design,
and when services were wound down). "Build & Verify" states the test count, the RFC and FIPS
vectors, the two fixed schedules of checks B and C with their SHA-256 values, and the a11y
gate. Credit the specification, the white paper and the analyses by title and authors, with
links to the publishers' or projects' own pages; no links to PDF copies elsewhere.

---

## CARD METADATA TO REPORT BACK (for the catalog session; do not edit the catalog yourself)

Title: Exposure Notification. Subtitle as above. Suggested categories: PROTOCOLS, PRIVACY
(confirm both exist in the catalog's CATEGORIES). Suggested level: intermediate. Chips: only
what the source implements (HKDF-SHA-256, AES-128, HMAC-SHA-256, SHA-256, the Apple/Google
key schedule, DP-3T low-cost and unlinkable identifier generation, on-device matching).
Accent #8fb339.

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
