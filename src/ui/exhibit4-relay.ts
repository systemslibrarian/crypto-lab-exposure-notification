/**
 * Exhibit 4 — the relay. This panel carries the lab's NEGATIVE CLAIM.
 *
 * The fixture: A on a station platform, B in a rooftop bar, never in the same
 * place in the same slot. An attacker's receiver stands with A and its
 * transmitter stands with B. A reports. B is told of an exposure.
 *
 * Every check B's phone can make passes — 16 bytes, valid day, inside the
 * tolerance, key published by the server — and the verdict says so, together
 * with what the world record says. The two sentences are both true at once,
 * which is the whole lesson.
 *
 * The co-location line comes from `wereColocated`, which reads `world.presence`
 * and nothing else. Mutation 11 computes it from the matcher's output instead;
 * if that mutation survived, this verdict would be circular.
 */

import { designById, type DesignId, type PhoneKeys } from '../model/design'
import { exposureVerdict, matchLog } from '../model/match'
import { colocatedSlots, heardBy, wereColocated } from '../model/world'
import { relayScenario } from '../model/scenario'
import { MATCH_TOLERANCE_INTERVALS } from '../crypto/gaen'
import { callout, details, el, hexCell, list, mount, para, scrollTable, tag, verdict } from './render'
import { NEGATIVE_CLAIM } from '../claim'

const SLOT_COUNT = 30

interface State {
  designId: DesignId
  relayOn: boolean
  delaySlots: number
  /** The bite fixture for mutation 11: A and B genuinely together. */
  colocate: boolean
  keys: Record<string, PhoneKeys> | null
  keyedFor: string | null
}

const state: State = {
  designId: 'gaen',
  relayOn: true,
  delaySlots: 0,
  colocate: false,
  keys: null,
  keyedFor: null,
}

export async function render(host: HTMLElement): Promise<void> {
  const design = designById(state.designId)
  const keyFor = `${design.id}`
  if (!state.keys || state.keyedFor !== keyFor) {
    state.keys = { A: await design.createKeys(1), B: await design.createKeys(1) }
    state.keyedFor = keyFor
  }

  const scenario = await relayScenario(design, {
    active: state.relayOn,
    delaySlots: state.delaySlots,
    slotCount: SLOT_COUNT,
    colocate: state.colocate,
    keys: state.keys,
  })
  const { world, broadcasts } = scenario

  // First, what the PHONE concluded. It is handed its own log and the published
  // report, and nothing else.
  const bLog = heardBy(world, 'B', broadcasts)
  const a = world.phones.find((p) => p.id === 'A')
  const published = a ? design.publish(a.keys, 0, world.days) : null
  const result = published ? await matchLog(design, bLog, published, world.days) : null
  const exposed = result ? exposureVerdict(result) === 'exposure' : false

  // Then, SEPARATELY, what the world says. `wereColocated` reads
  // `world.presence` and nothing else — it is not given `result`, and writing
  // `const together = exposed` here instead would turn the verdict's
  // "never near each other" clause into a restatement of the match. That
  // substitution is mutation 11, and the claims suite's
  // "BITE: the clause tracks the WORLD" test is what refuses it.
  const together = wereColocated(world, 'A', 'B')
  const sharedSlots = colocatedSlots(world, 'A', 'B')

  // ── controls ──────────────────────────────────────────────────────────────
  const relayBtn = el('button', {
    type: 'button',
    class: state.relayOn ? 'primary' : '',
    id: 'ex4-relay',
    'aria-pressed': String(state.relayOn),
    text: state.relayOn ? 'Relay is RUNNING' : 'Relay is OFF',
  })
  relayBtn.addEventListener('click', () => {
    state.relayOn = !state.relayOn
    void render(host)
  })

  const liveBtn = el('button', {
    type: 'button',
    id: 'ex4-live',
    'aria-pressed': String(state.delaySlots === 0),
    text: 'Relay live (same slot)',
  })
  liveBtn.addEventListener('click', () => {
    state.delaySlots = 0
    void render(host)
  })

  const delayBtn = el('button', {
    type: 'button',
    id: 'ex4-delay',
    'aria-pressed': String(state.delaySlots > 0),
    text: `Replay ${MATCH_TOLERANCE_INTERVALS + 1} slots later`,
  })
  delayBtn.addEventListener('click', () => {
    state.delaySlots = MATCH_TOLERANCE_INTERVALS + 1
    void render(host)
  })

  const colocateBtn = el('button', {
    type: 'button',
    id: 'ex4-colocate',
    'aria-pressed': String(state.colocate),
    text: state.colocate ? 'They ARE in the same room' : 'Put them in the same room',
  })
  colocateBtn.addEventListener('click', () => {
    state.colocate = !state.colocate
    void render(host)
  })

  // ── the air: who put what where ───────────────────────────────────────────
  const airTable = el('table', {}, [
    el('caption', {
      text: 'What was on the air, and who put it there. B’s phone sees the identifier and the slot — never this column.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', class: 'num', text: 'Slot' }),
        el('th', { scope: 'col', text: 'Place' }),
        el('th', { scope: 'col', text: 'Identifier' }),
        el('th', { scope: 'col', text: 'Put there by' }),
      ]),
    ]),
  ])
  const airBody = el('tbody')
  // Sorted by slot, so each slot's honest broadcasts and the attacker's
  // rebroadcast of them sit together. Unsorted, the relayed copies are appended
  // after every honest one and a ten-row window never shows a single
  // "THE ATTACKER" row — which is the one thing this table exists to show.
  const air = [...broadcasts].sort((x, y) => x.at - y.at || Number(x.relayed) - Number(y.relayed))
  for (const b of air.slice(0, 10)) {
    airBody.append(
      el('tr', {}, [
        el('th', { scope: 'row', class: 'num', text: String(b.at) }),
        el('td', { text: b.place }),
        el('td', {}, [hexCell(b.identifier, { keep: 4 })]),
        el('td', {}, [
          b.relayed ? tag('relayed', 'THE ATTACKER') : tag('real', `PHONE ${b.origin}`),
        ]),
      ]),
    )
  }
  airTable.append(airBody)

  // ── every check the phone can make ────────────────────────────────────────
  const match = result?.matches[0]
  const checks = el('table', { 'data-phone-checks': exposed ? 'all-pass' : 'not-matched' }, [
    el('caption', { text: 'Every check B’s phone is able to perform, on the identifier it matched.' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Check' }),
        el('th', { scope: 'col', text: 'Result' }),
      ]),
    ]),
  ])
  const checksBody = el('tbody')
  const rows: [string, boolean, string][] = match
    ? [
        ['Identifier is exactly 16 bytes', match.entry.identifier.length === 16, `${match.entry.identifier.length} bytes`],
        ['Derived from a key the server published', true, 'byte-for-byte equal to a recomputed identifier'],
        [
          'Within the design’s time rule',
          design.withinTimeRule(match.entry, match.expanded),
          `heard in slot ${match.entry.heardAt}, scheduled for ${match.expanded.scheduledAt}`,
        ],
        ['Key covers the day it was heard on', match.expanded.day === 0, `day ${match.expanded.day}`],
      ]
    : []
  for (const [label, pass, detail] of rows) {
    checksBody.append(
      el('tr', {}, [
        el('th', { scope: 'row', text: label }),
        el('td', {}, [pass ? tag('time', 'PASSES') : tag('nomatch', 'FAILS'), el('span', { class: 'field-hint', text: ` ${detail}` })]),
      ]),
    )
  }
  if (rows.length === 0) {
    checksBody.append(el('tr', {}, [el('td', { colspan: '2', text: 'Nothing matched, so there is nothing to check.' })]))
  }
  checks.append(checksBody)

  // ── the verdict ───────────────────────────────────────────────────────────
  // The headline is the two true sentences at once. `data-colocated` is written
  // from the WORLD, so a test can tell the fixture from the bite fixture.
  let verdictNode: HTMLElement
  if (exposed && !together) {
    verdictNode = verdict(
      'alarm',
      'EXPOSURE MATCHED — AND THE TWO PHONES WERE NEVER NEAR EACH OTHER',
      el('span', {}, [
        el('strong', { text: NEGATIVE_CLAIM }),
        el('br'),
        `The world record for this scenario: phone A and phone B were at the same place in ${sharedSlots.length} of the timeline\u2019s ${world.slots.length} slots. A stood on Platform 4 throughout; B was in the Rooftop bar throughout.`,
      ]),
      { id: 'ex4-verdict' },
    )
  } else if (exposed && together) {
    verdictNode = verdict(
      'matched',
      'EXPOSURE MATCHED — AND THEY REALLY WERE TOGETHER',
      `The world record says A and B shared a place in ${sharedSlots.length} of ${world.slots.length} slots. This is the mechanism working as designed. Note that the match itself looks identical to the one above: the phone cannot tell these two situations apart.`,
      { id: 'ex4-verdict' },
    )
  } else if (state.relayOn && state.delaySlots > 0) {
    verdictNode = verdict(
      'refused',
      'NO EXPOSURE — THE REPLAY WAS TOO LATE',
      `${result?.rejectedByTime.length ?? 0} of B's stored identifiers matched a published one byte for byte, and were still refused: ${design.timeRule}. A replay delayed by ${state.delaySlots} slots falls outside that window, so the time rule catches it. A LIVE relay does not get caught, because there is nothing late about it.`,
      { id: 'ex4-verdict' },
    )
  } else if (!state.relayOn) {
    verdictNode = verdict(
      'none',
      'NO EXPOSURE — AND NOTHING WAS HEARD',
      'With the relay off, B is alone in the bar and hears nothing at all. Turn the relay on to see what changes.',
      { id: 'ex4-verdict' },
    )
  } else {
    verdictNode = verdict('none', 'NO EXPOSURE', 'Nothing B stored came from the published report.', {
      id: 'ex4-verdict',
    })
  }
  verdictNode.setAttribute('data-colocated', String(together))
  verdictNode.setAttribute('data-exposed', String(exposed))

  mount(
    host,
    el('h2', { text: '4. A relay, and an encounter that never happened' }),
    para(
      'Phone A is on a station platform. Phone B is in a rooftop bar across town. They never share a place, in any slot. An attacker puts a receiver next to A and a transmitter next to B, and forwards whatever it hears. B’s phone stores A’s identifier. When A later reports, B is told it was exposed.',
      'lede',
    ),

    el('div', { class: 'btn-row' }, [relayBtn, liveBtn, delayBtn, colocateBtn]),
    el('p', {
      class: 'field-hint',
      text: `Design: ${design.label}. Time rule: ${design.timeRule}.`,
    }),

    verdictNode,

    el('h3', { text: 'Every check B’s phone can make' }),
    scrollTable('Checks performed by B’s phone', checks),

    el('h3', { text: 'What was actually on the air' }),
    scrollTable('Broadcasts on the air, first ten slots', airTable),

    callout(
      'alarm',
      'THIS IS NOT A FLAW IN THE CRYPTOGRAPHY',
      para(
        'Every identifier the attacker moved is genuine, correctly derived, and belongs to the key that was reported. Nothing was forged, guessed or broken. The attacker only changed WHERE a valid message was heard — and proximity was never something the bytes could carry.',
      ),
      para(
        'The DP-3T white paper says the same about its own design: "Such an ‘online’ relay attack is unavoidable in proximity tracing systems based on passive Bluetooth advertisements." Vaudenay’s analysis of DP-3T gives the relay its own section and concludes that "the only way to defeat this type of attack is to use some form of a distance-bounding protocol".',
      ),
    ),

    details(
      'Why the delayed replay IS caught, and what that tells you',
      para(
        `A delayed replay is a different attack, and the time rule does stop it. Apple/Google allow a ±two-hour window between when an identifier was scheduled and when it was heard, so a copy rebroadcast ${MATCH_TOLERANCE_INTERVALS + 1} slots late falls outside it. DP-3T binds identifiers to a day, and its unlinkable design binds them to a single epoch — the tightest of the three.`,
      ),
      para(
        'None of that touches the live relay. The tolerance is a clock check, and a live relay is on time. Distance is a different quantity, and no amount of clock checking measures it.',
      ),
      list([
        'Press "Replay later" above: the bytes still match, and the verdict changes to a refusal that names the reason.',
        'Press "Put them in the same room": the match looks exactly the same as the relayed one. That is the point — the phone cannot distinguish them.',
      ]),
    ),
  )
}
