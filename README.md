# Exposure Notification

Rolling identifiers · matching on the phone · relay and linkage

Browser-based exposure notification as deployed in 2020 — the Apple/Google key schedule and
the DP-3T designs computed with real HKDF, HMAC-SHA-256, SHA-256 and AES, matching done on the
"phone", then the two things the cryptography cannot prevent: a relayed identifier that matches
like a real encounter, and a reported key that links a day of sightings.

**[Live demo](https://systemslibrarian.github.io/crypto-lab-exposure-notification/)**

---

## What It Is

A phone broadcasts short identifiers and keeps its encounter log on the device. If a user reports,
the phone publishes the diagnosis material for the reporting period. Other phones download it
and compare identifiers locally, without uploading their encounter logs or match results. That is the whole idea behind the
exposure notification systems deployed in 2020, and this page runs it for real.

Two families of design are built here, and the page runs them side by side on the same
scenarios:

- **The Apple/Google key schedule**, exactly as specified. A 16-byte Temporary Exposure Key
  valid for 144 ten-minute intervals; `RPIK = HKDF-SHA-256(TEK, NULL, "EN-RPIK", 16)` and the
  same with `"EN-AEMK"` for the metadata key; each Rolling Proximity Identifier a single
  AES-128 block over `"EN-RPI" ‖ 0x000000000000 ‖ interval` with the interval as a
  **little-endian** uint32; and the associated metadata encrypted with AES-128 in counter
  mode under AEMK using the identifier itself as the counter block.
- **Two DP-3T designs.** The *low-cost* design: a day seed `SK_t = H(SK_{t−1})`, and the day's
  96 identifiers from `PRG(PRF(SK_t, "broadcast key"))`, broadcast in a random order. The
  *unlinkable* design: a fresh random 32-byte seed per epoch, with
  `EphID = LEFTMOST128(H(seed))`.

Primitives: HKDF-SHA-256 (RFC 5869), HMAC-SHA-256, SHA-256, AES-128 and AES-256 in counter
mode. All of them from WebCrypto; **there are no cryptographic dependencies**. HKDF itself is
hand-rolled from HMAC, because the key schedule is the teaching subject and the two HMAC calls
that turn one key into two have to be inspectable rather than hidden behind `deriveBits`.

**The security model.** The server learns which keys were reported and nothing else: not who
heard what, not who was near whom, not whether anyone matched. Matching happens on the phone,
from the phone's own log and the published keys. This lab enforces that structurally — the
matching function takes exactly two arguments and there is no parameter through which the
ground truth could reach it.

**And the two limits.** Both are in the designers' own documents, and both are reproducible
here. A **relay** moves a genuine identifier to a place its owner never went, and the
receiving phone cannot tell the difference: every check it can make passes. A **reported key
links a day of sightings**, so an observer with a few antennas and a log can pick one
reporter's whole day out of it, in order.

**Not production software — a teaching demo.** The phones are simulated, all of them, in one
browser tab. There is no Bluetooth, no radio and no network. This lab also chose DP-3T's
deliberately-unspecified primitives itself (see *What Can Go Wrong*), so nothing here
describes what any country's app actually did.

## Exhibits

1. **One phone, one day (Apple/Google).** One 16-byte key, two HKDF calls, and the day's 144
   identifiers. The padded AES block is drawn byte by byte with the four interval bytes picked
   out, so "little-endian" is something you can check rather than something the page asserts.
   AEMK and one encrypted metadata value are derived alongside. Set the key's
   start interval to something that is not a multiple of 144 and the whole panel
   becomes a refusal that names the interval it should have been — nothing is
   derived, and nothing is quietly rounded.
2. **One phone, several days (DP-3T low-cost).** The hash chain across three days, the PRF
   step, the day's 96 identifiers, and the random broadcast order shown against the generation
   order — the full 96-element permutation is published in the DOM so the claim is checkable.
3. **Hearing and matching.** Three phones on an eight-slot timeline you edit directly: a real
   table whose rows are slots and whose cells name each phone's place. One phone reports; the
   others download the key, recompute, and compare. Alongside it, a separate panel for what the
   server learned (the keys) and what it did not (who met whom). Runs under any of the three
   designs, each with its own time rule.
4. **Relay.** Phone A on a station platform, phone B in a rooftop bar, never in the same place
   in any slot. An attacker's receiver stands with A and its transmitter with B. B is told of an
   exposure. The page lists every check B's phone can perform and shows all of them passing,
   next to the world's record that the two were never together. A delayed replay is then
   refused, and the page names the time rule as the reason.
5. **Linkage after a report.** Ten phones, two days, three antennas logging everything they
   hear. Before the report the largest group an observer can form is one. After it, the three
   designs are compared on the same movement: Apple/Google links the one day its published key
   covers, DP-3T low-cost links that day and every later one because its seed hashes forward,
   and the unlinkable design recognises each sighting individually while grouping none of them.
   The reconstruction is shown beside what actually happened.
6. **Metadata is malleable.** Flip one bit of the encrypted metadata and watch the real cipher
   decrypt it to a different transmit-power reading — a 16 dB shift in the number distance
   estimation is built on — with no error raised anywhere, because there is nothing in the
   format that could raise one.

## When to Use It

Use it to teach what a published-secret scheme does and does not buy: how publishing a key
lets strangers recognise your past broadcasts without a server ever learning the social graph,
and why that same step is what makes relay and post-report linkage unavoidable rather than
oversights. It is a good companion to any discussion of why proximity cannot be carried by
bytes alone.

**Do NOT read this page as an assessment of any national app.** It is not one. No deployed
system is modelled here: the Apple/Google half follows the published specification, and the
DP-3T half uses primitives this lab chose because the white paper deliberately left them open.
Risk scoring, distance estimation, upload authorisation and the radio layer — the parts that
determined whether a real app helped anyone — are all absent.

Do not use it as a cryptographic library, and do not read the relay and linkage exhibits as
claims that the cryptography is broken. It is not broken. They are limits of what it was ever
able to promise.

## Live Demo

<https://systemslibrarian.github.io/crypto-lab-exposure-notification/>

Generate a key and watch 144 identifiers come out of it. Change the interval and watch four
bytes of the AES input move. Edit the timeline so two phones meet, report a positive test, and
read the matching happen on each phone. Turn on the relay and get an exposure alert between two
people who were never in the same room; delay the replay and watch it refused. Publish one key
and watch an antenna log turn into one person's afternoon. Flip a bit of the metadata and see
what a receiver believes instead.

## What Can Go Wrong

Three limits, each attributed to the document that states it. The first two are stated by the
DP-3T white paper about its own design.

**A live relay fakes an encounter, and nothing can tell.** An attacker who rebroadcasts a
genuine identifier somewhere else creates a perceived encounter where there was none. Nothing
is forged — the identifier is real, correctly derived, and belongs to the key that gets
reported. The DP-3T white paper: *"Such an 'online' relay attack is unavoidable in proximity
tracing systems based on passive Bluetooth advertisements."* Vaudenay's analysis gives the
relay its own section and concludes that *"the only way to defeat this type of attack is to use
some form of a distance-bounding protocol."* A *delayed* replay is a different attack and the
time rules do stop it: Apple/Google allow a ±2-hour tolerance, DP-3T low-cost binds identifiers
to a day, and the unlinkable design binds them to a single epoch.

**A reported key links a window of sightings.** The DP-3T white paper, on its own low-cost
design: *"Given the seed SK_t of the first contagious day, the EphIDs of a COVID-19 positive
user are linkable from the start of the contagious window until the time of upload"*, so
*"tech-savvy users, eavesdroppers, and state-level adversaries can locally track infected
patients during the (past) window in which the identifiers broadcasted via Bluetooth are
linkable. To do so, the attacker uses strategically placed Bluetooth receivers and recording
devices to receive EphIDs."* Apple and Google bound the same exposure to one day — *"the
correlation of Rolling Proximity Identifiers by others is limited to 24 hour periods"* — and
the unlinkable design exists to remove it altogether, at the cost of publishing a seed per
epoch. The random broadcast order is a real mitigation but a narrower one than it looks: it
stops a published seed revealing *when* within the day each identifier went out, which is why
exhibit 5's trajectory is ordered by the observer's own antenna timestamps instead.

**The metadata is encrypted but not authenticated.** Counter mode is a stream cipher, so
flipping a ciphertext bit flips exactly that plaintext bit, and the four-byte frame carries no
tag, no padding and no length field. The specification says so itself: *"Upon decryption, the
data has to be appropriately sanitized and validated as the Associated Encrypted Metadata isn't
authenticated."* What that costs is not confidentiality — reading the metadata still needs
AEMK, which needs the reported key — but integrity of the transmit-power byte the distance
estimate depends on.

**One thing this lab chose, and says so on the page.** The DP-3T white paper writes
`EphID_1 ‖ … ‖ EphID_n = PRG(PRF(SK_t, "broadcast key"))` and names HMAC-SHA256 and AES in
counter mode only as examples, fixing neither — a gap Vaudenay's analysis points out. So this
lab fixes them: `H = SHA-256`; `PRF = HMAC-SHA-256` keyed with `SK_t` over the ASCII bytes
`broadcast key`; `PRG = AES-256` in counter mode keyed with the 32-byte PRF output, from a zero
counter block, encrypting zeros; `L = 15` minutes, so `n = 96`. **These choices match no
deployed app.**

## Real-World Usage

Only what is verifiable from the primary sources cited below.

The Apple/Google specification states its own purpose and parameters directly: 10-minute
`ENIntervalNumber`s from Unix epoch time, `TEKRollingPeriod = 144` for 24-hour key validity,
14 keys retained, and a ±2-hour matching tolerance. Its revision history records that the
scheme changed shape during April 2020: v1.1 renamed "Contact Tracing" to "Exposure
Notification", made Temporary Exposure Keys randomly generated rather than derived, switched
from `HMAC<SHA256>` to AES "for improved performance", and added metadata encryption — so the
design in this lab is the second one, not the first announced.

Google published a reference implementation of the client side
(`google/exposure-notifications-internals`), whose `CRYPTO.md` and `KeyDerivation` code agree
with the specification formula for formula, down to the single-round HKDF expand with counter
byte `0x01` and the `ByteOrder.LITTLE_ENDIAN` buffer that produces the padded block.

DP-3T's white paper describes its own relationship to the Apple/Google design: *"This design is
very similar to the Google/Apple design. The Google/Apple design uses one seed to generate the
ephemeral identifiers of that day, and thus corresponds to the special case where windows are
1 day long"* — said of its hybrid design, which this lab does not build.

The Apple/Google specification published no interoperability test vectors: *"Test vectors for
interoperability testing between implementations of this specification are available upon
request in a machine-readable format."* They were not available to this lab, which is why the
schedule in `src/crypto/vectors.ts` is labelled a cross-implementation agreement rather than an
authority — see *Build & Verify*.

Nothing here is a claim about which countries deployed which design, when services were wound
down, or whether any of it worked. Those are matters of public record this lab did not verify
from primary sources, so it does not assert them.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-exposure-notification.git
cd crypto-lab-exposure-notification
npm install
npm run dev
```

Then:

```bash
npm test             # 146 unit tests, including every spec KAT
npm run mutate       # 12 mutations; a survivor fails the run
npm run build        # typecheck (src and e2e) then the production build
npm run test:a11y    # the axe WCAG 2.1 A/AA gate, against the built site
npm run test:claims  # 38 claims tests, including the negative claim
```

## Related Demos

- **[Distance Bounding](https://systemslibrarian.github.io/crypto-lab-distance-bounding/)** —
  the Hancke–Kuhn rapid-bit protocol, which is the mitigation Vaudenay names for exhibit 4's
  relay. That lab measures *when* a response arrives in order to bound distance; this one shows
  what happens to a protocol that never measures it at all.
- **[KDF Chain](https://systemslibrarian.github.io/crypto-lab-kdf-chain/)** — HKDF, PBKDF2,
  scrypt and Argon2id compared. It is about choosing and tuning a derivation function; this lab
  uses HKDF for one narrow job, deriving two unrelated keys from one, and never tunes it.
- **[PSI Gate](https://systemslibrarian.github.io/crypto-lab-psi-gate/)** — DH private set
  intersection. Both labs let two parties learn an overlap without revealing their sets, but PSI
  is interactive and reveals only the intersection, where exposure notification publishes one
  side's set outright and gets the relay and linkage limits as a consequence.

No lab in this suite covers Bluetooth pairing, so there is no sibling for the radio layer this
one explicitly leaves out.

## Build & Verify

**Tests: 146 unit (Vitest) + 40 browser (Playwright) = 186.** All run in CI, and every one of
them gates the deploy.

Known-answer tests, in `src/crypto/primitives.test.ts`:

- **HKDF-SHA-256**, RFC 5869 Appendix A test case 1 (with salt and info) and test case 3 (with
  neither), both to the full 42-byte output — so the expand step's counter is exercised across
  two rounds rather than only the one the key schedule uses.
- **AES-128**, FIPS 197 Appendix C.1, one block.
- **AES-128-CTR**, NIST SP 800-38A F.5.1, four blocks, so counter increment is tested.
- SHA-256 of the empty string, and HMAC-SHA-256 from RFC 4231 test case 1.

Two **fixed schedules**, in `src/crypto/vectors.ts`. These are not published vectors — Apple and
Google's specification offers its own only "upon request" and publishes none — so they were
computed independently from the specification's and the white paper's formulas with a different
crypto stack (Node's OpenSSL) before this lab's code existed. They are a cross-implementation
agreement, not an authority; if an official set appears and disagrees, it wins.

- **Apple/Google**, from `TEK = 000102…0f` at start interval 2650032 (a multiple of 144;
  2020-05-21T00:00:00Z): `RPIK = 4c3615250075e094e42e1b72e538ded2`,
  `AEMK = 3454dd8d8c8c835029754c15df6d44d7`, first padded block
  `454e2d525049000000000000b06f2800`, first identifier `4b0cf5c1f7df9c034746e5d13e84de55`, and
  SHA-256 over all 144 identifiers in interval order =
  `f094836c0232c429e42ff6f0430c54d21e97c8b0ceb54fec3941a9a8d4cf9437`.
- **DP-3T low-cost**, under this lab's declared choices, from `SK_0 = 0001…1f`:
  `PRF(SK_0) = b0912940a0c51ea8efb6d31397cab26767e95667f7ccca1b754c4cee774db972`, first
  identifier `3a84e9f7ed7b85e0691d2b9fc9c23be1`, and SHA-256 over all 96 in generation order =
  `79f59d2f19942be50f61417ed31959ae7d3930e7e86d33b93cf93b441df202da`. The unlinkable design's
  seed `4041…5f` gives `ca2a4fe727faaecf16ecd130a86e0885`.

Several tests deliberately **re-derive** rather than re-run the source's own expression: the
padded block is rebuilt by arithmetic instead of a `DataView`, and the AES block is taken
through AES-CBC instead of the counter-mode route `src/crypto/primitives.ts` uses. The claims
suite goes further and reimplements the whole schedule in `e2e/claims.spec.ts`, importing
nothing from `src/`, then checks every identifier the page displays against it. A page that is
consistently wrong fails.

**The accessibility gate** (`npm run build && npm run test:a11y`) scans the production build
with `@axe-core/playwright` for zero WCAG 2.1 A/AA violations, at 1280px and 380px, across
about 47 driven states — every exhibit, every verdict tone, every refusal, two focus rings and
three hover states. It asserts axe's `incomplete` bucket as well as `violations`, computes
contrast arithmetically alongside axe (including inside `aria-hidden` content), measures
non-text contrast per border side against a ratchet whose baseline file is **empty**, and
checks reflow, which axe has no rule for. Its first runs found three real defects — control
boundaries at 2.12:1 and 2.29:1 against SC 1.4.11's 3:1, and two 1.4.10 reflow failures at
380px — all fixed in the stylesheet rather than baselined.

**Mutation discipline** (`npm run mutate`) runs 12 mutations, each a concrete patch with an
anchor that must occur exactly once. A kill requires the owning test to have passed unmutated
in the same run, the patch to have actually changed the file, `tsc` to still succeed, and the
red run to be classified as a failing suite rather than a build error or an unstarted server.
All 12 are killed. Three of them survived their first run, and each survival was a finding
fixed in the source: one patched provably dead code, one accidentally reimplemented the
function it replaced, and one revealed that no test could tell "the same place at the same
time" from "the same place ever".

The runner also cleans up after itself in two ways that are easy to miss. It writes the
original bytes to a breadcrumb file before patching, so a run killed outright leaves something
the next run can recover from rather than a stranded mutation that reads as ordinary source.
And it deletes `dist/` when it finishes, because a UI mutation's oracle is a Playwright run
and Playwright builds before it serves — so the last build on disk came from mutated source,
and the next `vite preview` would happily serve it.

**The negative claim** is tested, not merely printed. The claim —

> A match says that an identifier this phone heard was derived from a reported key. It says
> nothing about whether the two people were near each other: in this scenario they never were,
> and the match is the same.

— has exhibit 4 with the relay live as its evidence fixture, and `e2e/claims.spec.ts` asserts
that the fixture is reachable through the UI, that every check the page renders in that state
reports success, and that the limitation is visible on screen there rather than behind a
disclosure. Two bite tests keep it honest: put the two phones genuinely together and the clause
must disappear, and the clause must track the world model rather than the matcher's answer —
pinned by three states no function of the match alone can produce.

## Credits

- Apple Inc. and Google LLC, **"Exposure Notification — Cryptography Specification"**, v1.2,
  April 2020, and **"Exposure Notification — Bluetooth Specification"**, v1.2.2.
  Published at <https://www.google.com/covid19/exposurenotifications/> and
  <https://www.apple.com/covid19/contacttracing>.
- Google LLC, **exposure-notifications-internals** — the Android reference implementation.
  <https://github.com/google/exposure-notifications-internals>
- The DP-3T Project, **"Decentralized Privacy-Preserving Proximity Tracing"**, white paper,
  25 May 2020. <https://github.com/DP-3T/documents>
- Serge Vaudenay, **"Analysis of DP3T: Between Scylla and Charybdis"**, IACR ePrint 2020/399.
  <https://eprint.iacr.org/2020/399>
- Yaron Gvili, **"Security Analysis of the COVID-19 Contact Tracing Specifications by Apple
  Inc. and Google Inc."**, IACR ePrint 2020/428. <https://eprint.iacr.org/2020/428>
- Thien Duc Nguyen, Markus Miettinen, Alexandra Dmitrienko, Ahmad-Reza Sadeghi and Ivan
  Visconti, **"Digital Contact Tracing Solutions: Promises, Pitfalls and Challenges"**, IACR
  ePrint 2022/166. <https://eprint.iacr.org/2022/166>
- H. Krawczyk and P. Eronen, **RFC 5869**, HKDF. <https://www.rfc-editor.org/info/rfc5869>
- NIST, **FIPS 197** (AES) and **SP 800-38A** (block cipher modes).
  <https://csrc.nist.gov/publications/detail/fips/197/final> ·
  <https://csrc.nist.gov/publications/detail/sp/800-38a/final>

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
