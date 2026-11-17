/**
 * Exhibit 5 — linkage after a report.
 *
 * Three antennas, ten phones, one reporter. Before the report the antenna logs
 * are a pile of unrelated 16-byte strings. After it, one published value picks
 * one person's whole day out of the pile, in order.
 *
 * The three designs run side by side on the same movement, so the difference
 * on screen is the design and nothing else.
 *
 * The observer gets its own logs and the published report. The "linked" column
 * is then compared against the world's presence record — by this panel, after
 * the fact. The observer never sees that record; `group()` has no parameter
 * that could carry it.
 */

import { DESIGNS, type Design, type PhoneKeys } from '../model/design'
import { group, trajectory, type GroupingResult, type Sighting } from '../model/observer'
import { linkageScenario } from '../model/scenario'
import { loggedBy, type Broadcast, type World } from '../model/world'
import { callout, details, el, hexCell, list, mount, para, scrollTable, tag, verdict } from './render'

const SEED = 20200521
const DAYS = 2
const SLOTS_PER_DAY = 8

interface Run {
  design: Design
  world: World
  broadcasts: Broadcast[]
  sightings: Sighting[]
  before: GroupingResult
  after: GroupingResult | null
  /** Ground truth for the reporter, from presence only. */
  truth: { at: number; place: string }[]
  publishedCount: number
  publishedFromDay: number
}

interface State {
  reported: boolean
  /** Publish from day 1 only, or from day 0 — the two-day comparison. */
  fromDay: number
  keys: Record<string, Record<string, PhoneKeys>>
}

const state: State = { reported: false, fromDay: 1, keys: {} }

function antennaLogs(world: World, broadcasts: readonly Broadcast[]): Sighting[] {
  const out: Sighting[] = []
  for (const r of world.receivers) {
    for (const e of loggedBy(r, broadcasts)) {
      out.push({ identifier: e.identifier, at: e.heardAt, place: r.place })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

async function runDesign(design: Design): Promise<Run> {
  const cached = state.keys[design.id]
  const scenario = await linkageScenario(design, {
    seed: SEED,
    days: DAYS,
    slotsPerDay: SLOTS_PER_DAY,
    ...(cached ? { keys: cached } : {}),
  })
  if (!cached) {
    const keys: Record<string, PhoneKeys> = {}
    for (const p of scenario.world.phones) keys[p.id] = p.keys
    state.keys[design.id] = keys
  }
  const { world, broadcasts } = scenario
  const sightings = antennaLogs(world, broadcasts)
  const reporter = world.phones[0]
  if (!reporter) throw new Error('no reporter in the scenario')

  const before = await group(design, sightings, null, world.days)
  const published = state.reported ? design.publish(reporter.keys, state.fromDay, world.days) : null
  const after = published ? await group(design, sightings, published, world.days) : null

  const truth = world.presence
    .filter((p) => p.phone === reporter.id)
    .map((p) => ({ at: p.at, place: p.place }))
    .sort((x, y) => x.at - y.at)

  return {
    design,
    world,
    broadcasts,
    sightings,
    before,
    after,
    truth,
    publishedCount: published?.items.length ?? 0,
    publishedFromDay: state.fromDay,
  }
}

/** Which days the observer linked, and which the reporter was actually seen on. */
function daysOf(run: Run, items: { at: number }[]): number[] {
  return [...new Set(items.map((i) => Math.floor(i.at / run.design.slotsPerDay)))].sort((a, b) => a - b)
}

function comparisonTable(runs: Run[]): HTMLElement {
  const table = el('table', {}, [
    el('caption', {
      text: 'The same ten phones walking the same route, under each design. One published value each.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Design' }),
        el('th', { scope: 'col', text: 'What one report publishes' }),
        el('th', { scope: 'col', class: 'num', text: 'Largest group before' }),
        el('th', { scope: 'col', class: 'num', text: 'Largest group after' }),
        el('th', { scope: 'col', text: 'Days linked' }),
        el('th', { scope: 'col', text: 'Observer’s grouping vs the world record' }),
      ]),
    ]),
  ])
  const body = el('tbody')
  for (const run of runs) {
    const after = run.after
    const linkedDays = after ? daysOf(run, after.recognised) : []
    const truthDays = daysOf(
      run,
      run.truth.filter((t) => Math.floor(t.at / run.design.slotsPerDay) >= run.publishedFromDay),
    )
    const recovered = after ? trajectory(after) : []
    const expected = run.truth.filter(
      (t) => Math.floor(t.at / run.design.slotsPerDay) >= run.publishedFromDay,
    )
    const exact =
      recovered.length === expected.length &&
      recovered.every((s, i) => s.at === expected[i]?.at && s.place === expected[i]?.place)

    let judgement: HTMLElement
    if (!after) {
      judgement = tag('nomatch', 'NO REPORT YET')
    } else if (after.largestGroup <= 1 && after.recognised.length > 0) {
      judgement = el('span', {}, [
        tag('nomatch', 'RECOGNISED, NOT GROUPED'),
        el('span', {
          class: 'field-hint',
          text: ` ${after.recognised.length} sightings recognised one at a time; no published value covers two of them.`,
        }),
      ])
    } else if (exact) {
      judgement = el('span', {}, [
        tag('linked', 'LINKED — EXACTLY THE REPORTER’S DAY'),
        el('span', {
          class: 'field-hint',
          text: ` ${recovered.length} sightings, in time order, equal to the world record.`,
        }),
      ])
    } else {
      judgement = el('span', {}, [
        tag('nomatch', 'DOES NOT EQUAL THE WORLD RECORD'),
        el('span', { class: 'field-hint', text: ` ${recovered.length} recovered, ${expected.length} expected.` }),
      ])
    }

    body.append(
      el(
        'tr',
        {
          'data-design': run.design.id,
          'data-largest-before': String(run.before.largestGroup),
          'data-largest-after': String(after?.largestGroup ?? 0),
          'data-linked-days': linkedDays.join(','),
          'data-truth-days': truthDays.join(','),
          'data-exact': String(exact),
        },
        [
          el('th', { scope: 'row', text: run.design.label }),
          el('td', {}, [
            el('span', { text: run.after ? `${run.publishedCount} value(s)` : '—' }),
            el('span', { class: 'field-hint', text: ` ${run.design.linkage}` }),
          ]),
          el('td', { class: 'num', text: String(run.before.largestGroup) }),
          el('td', { class: 'num', text: String(after?.largestGroup ?? 0) }),
          el('td', { class: 'num', text: linkedDays.length ? linkedDays.join(', ') : 'none' }),
          el('td', {}, [judgement]),
        ],
      ),
    )
  }
  table.append(body)
  return table
}

/** The reconstructed trajectory, next to the world record, row for row. */
function trajectoryTable(run: Run): HTMLElement {
  const recovered = run.after ? trajectory(run.after) : []
  const expected = run.truth.filter(
    (t) => Math.floor(t.at / run.design.slotsPerDay) >= run.publishedFromDay,
  )
  const rows = Math.max(recovered.length, expected.length)
  const table = el('table', {}, [
    el('caption', {
      text: `${run.design.label}: what the observer reconstructed from its own antenna logs, beside what actually happened.`,
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', class: 'num', text: '#' }),
        el('th', { scope: 'col', text: 'Observer: slot, antenna, identifier' }),
        el('th', { scope: 'col', text: 'World record: slot, place' }),
      ]),
    ]),
  ])
  const body = el('tbody')
  if (rows === 0) {
    body.append(el('tr', {}, [el('td', { colspan: '3', text: 'Nothing linked.' })]))
  }
  for (let i = 0; i < rows; i++) {
    const r = recovered[i]
    const e = expected[i]
    body.append(
      el('tr', {}, [
        el('th', { scope: 'row', class: 'num', text: String(i + 1) }),
        el('td', {}, r ? [`slot ${r.at}, ${r.place} — `, hexCell(r.identifier, { keep: 4 })] : ['—']),
        el('td', { text: e ? `slot ${e.at}, ${e.place}` : '—' }),
      ]),
    )
  }
  table.append(body)
  return table
}

export async function render(host: HTMLElement): Promise<void> {
  const runs: Run[] = []
  for (const design of DESIGNS) runs.push(await runDesign(design))
  const lowCost = runs.find((r) => r.design.id === 'dp3t-lowcost')
  const gaen = runs.find((r) => r.design.id === 'gaen')

  const reportBtn = el('button', {
    type: 'button',
    class: 'primary',
    id: 'ex5-report',
    'aria-pressed': String(state.reported),
    text: state.reported ? 'P0 has reported' : 'Have P0 report a positive test',
  })
  reportBtn.addEventListener('click', () => {
    state.reported = !state.reported
    void render(host)
  })

  const day1Btn = el('button', {
    type: 'button',
    id: 'ex5-day1',
    'aria-pressed': String(state.fromDay === 1),
    text: 'Publish day 1 only',
  })
  day1Btn.addEventListener('click', () => {
    state.fromDay = 1
    void render(host)
  })

  const day0Btn = el('button', {
    type: 'button',
    id: 'ex5-day0',
    'aria-pressed': String(state.fromDay === 0),
    text: 'Publish from day 0',
  })
  day0Btn.addEventListener('click', () => {
    state.fromDay = 0
    void render(host)
  })

  const beforeAll = runs.every((r) => r.before.largestGroup <= 1)
  const headline = !state.reported
    ? verdict(
        'none',
        'NOTHING GROUPS — THE LOGS ARE A PILE OF UNRELATED STRINGS',
        `Three antennas logged ${runs[0]?.sightings.length ?? 0} sightings over two days. Under every design the largest group the observer can form is ${beforeAll ? 1 : 'more than 1'}: a 16-byte pseudorandom identifier says nothing about any other one. Now have P0 report.`,
        { id: 'ex5-verdict' },
      )
    : verdict(
        'alarm',
        'LINKED — ONE PUBLISHED VALUE PICKS ONE PERSON’S DAY OUT OF THE LOGS',
        el('span', {}, [
          `The observer never learned a name, a phone or a place from the server — only the published value. Combined with its own timestamps it recovers the reporter's sightings in order. `,
          state.fromDay === 1 && gaen && lowCost
            ? el('strong', {
                text: `With one value published for day 1: Apple/Google links day ${daysOf(gaen, gaen.after?.recognised ?? []).join(', ') || 'none'}; DP-3T low-cost links day ${daysOf(lowCost, lowCost.after?.recognised ?? []).join(' and ') || 'none'}, because its seed hashes forward.`,
              })
            : el('strong', { text: 'The table below says exactly how much each design links.' }),
        ]),
        { id: 'ex5-verdict' },
      )
  headline.setAttribute('data-reported', String(state.reported))

  mount(
    host,
    el('h2', { text: '5. After a report, a published key links a day of sightings' }),
    para(
      'Ten phones move between a station, a market and a library over two days. Three antennas log everything they hear, with the time. Nobody is tracking anybody: the logs are 16-byte strings. Then one person reports, and one published value turns part of that pile into a trajectory.',
      'lede',
    ),

    el('div', { class: 'btn-row' }, [reportBtn, day1Btn, day0Btn]),
    el('p', {
      class: 'field-hint',
      text:
        state.fromDay === 1
          ? 'Publishing day 1 only. Day 0 stays on the phone — which is where the two designs part company.'
          : 'Publishing from day 0, the whole window.',
    }),

    headline,

    el('h3', { text: 'The three designs, on the same movement' }),
    scrollTable('Linkage under each design', comparisonTable(runs)),

    el('h3', { text: 'The reconstruction, beside what actually happened' }),
    ...(lowCost ? [scrollTable('DP-3T low-cost reconstruction', trajectoryTable(lowCost))] : []),
    ...(gaen ? [scrollTable('Apple/Google reconstruction', trajectoryTable(gaen))] : []),

    callout(
      'alarm',
      'THE DESIGNERS WROTE THIS DOWN THEMSELVES',
      para(
        'The DP-3T white paper, on its own low-cost design: "Given the seed SK_t of the first contagious day, the EphIDs of a COVID-19 positive user are linkable from the start of the contagious window until the time of upload." And: "tech-savvy users, eavesdroppers, and state-level adversaries can locally track infected patients during the (past) window in which the identifiers broadcasted via Bluetooth are linkable. To do so, the attacker uses strategically placed Bluetooth receivers and recording devices to receive EphIDs."',
      ),
      para(
        'The unlinkable design exists because of this. It pays for it in bandwidth: a seed per epoch instead of a seed per window.',
      ),
    ),

    callout(
      'note',
      'WHAT THE RANDOM BROADCAST ORDER DOES AND DOES NOT BUY',
      para(
        'The order in which the day’s identifiers go out is random, and the white paper leans on that: "since smartphones broadcast the daily set of EphIDs in random order, the attacker cannot use the published seeds SK_t to narrow down this coarse time-window." That is true, and it is not the attack above. The order of the trajectory here comes from the observer’s OWN antenna timestamps. The published value supplies the grouping; the antennas supply the clock.',
      ),
    ),

    details(
      'How "linked" is decided, and why it is not circular',
      para(
        'The grouping function receives two things: the antenna logs, and the published report. It has no access to the presence record that says where anybody really was — there is no parameter it could arrive through. This panel then compares the grouping with that record and reports whether they match, which is what the last column says.',
      ),
      list([
        'Before any report, the largest group must be 1 under every design. If it were not, the identifiers would be linkable without a report, and the whole scheme would be broken.',
        'The reporter’s movement is generated from a fixed seed so the scenario replays exactly. The KEYS are fresh from crypto.getRandomValues every time the page loads.',
        'The unlinkable design recognises each of the reporter’s sightings individually and still groups none of them — which is the distinction the table’s last column is built to show.',
      ]),
    ),
  )
}
