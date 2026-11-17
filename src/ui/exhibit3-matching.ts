/**
 * Exhibit 3 — hearing and matching.
 *
 * The learner owns the timeline: a real table whose rows are slots and whose
 * columns are phones, each cell a select naming the place that phone is at.
 * Everything else follows from it.
 *
 * Two things this exhibit exists to keep apart, on screen, at the same time:
 * what the SERVER learned (a key) and what it did not (who met whom).
 */

import { DESIGNS, designById, type Design, type DesignId, type PhoneKeys } from '../model/design'
import { exposureVerdict, matchLog, type MatchResult } from '../model/match'
import { heardBy, type Broadcast, type Presence, type World } from '../model/world'
import { meetingScenario } from '../model/scenario'
import { callout, details, el, hexCell, list, mount, para, scrollTable, tag, verdict } from './render'

const SLOTS = 8
const PLACES = ['Cafe', 'Office']
const NOWHERE = '—'
const PHONES = [
  { id: 'A', label: 'Phone A' },
  { id: 'B', label: 'Phone B' },
  { id: 'C', label: 'Phone C' },
]

interface State {
  designId: DesignId
  /** presence[phoneId][slot] = place, or NOWHERE. */
  places: Record<string, string[]>
  reporter: string
  reported: boolean
  /** Keys are generated once per design so editing the timeline is cheap. */
  keys: Record<string, PhoneKeys> | null
  keyedFor: DesignId | null
}

const state: State = {
  designId: 'gaen',
  places: {
    A: ['Cafe', 'Cafe', 'Cafe', 'Office', 'Office', NOWHERE, NOWHERE, NOWHERE],
    B: [NOWHERE, 'Cafe', 'Cafe', 'Cafe', 'Office', 'Office', NOWHERE, NOWHERE],
    C: ['Office', 'Office', 'Office', 'Office', NOWHERE, NOWHERE, 'Cafe', 'Cafe'],
  },
  reporter: 'A',
  reported: false,
  keys: null,
  keyedFor: null,
}

function presenceOf(): Presence[] {
  const out: Presence[] = []
  for (const phone of PHONES) {
    const row = state.places[phone.id] ?? []
    row.forEach((place, at) => {
      if (place !== NOWHERE) out.push({ phone: phone.id, place, at })
    })
  }
  return out
}

async function ensureKeys(design: Design): Promise<Record<string, PhoneKeys>> {
  if (state.keys && state.keyedFor === design.id) return state.keys
  const keys: Record<string, PhoneKeys> = {}
  for (const p of PHONES) keys[p.id] = await design.createKeys(1)
  state.keys = keys
  state.keyedFor = design.id
  return keys
}

/** The timeline table. Rows are slots, columns are phones. Keyboard-usable. */
function timelineTable(design: Design, host: HTMLElement): HTMLElement {
  const table = el('table', { class: 'timeline' }, [
    el('caption', {
      text: `Who is where. Each row is one ${design.slotMinutes}-minute slot; pick a place for each phone, or "${NOWHERE}" for nowhere near anyone.`,
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', class: 'num', text: 'Slot' }),
        ...PHONES.map((p) => el('th', { scope: 'col', text: p.label })),
      ]),
    ]),
  ])
  const body = el('tbody')
  for (let at = 0; at < SLOTS; at++) {
    const row = el('tr', {}, [el('th', { scope: 'row', class: 'num', text: String(at) })])
    for (const phone of PHONES) {
      const id = `tl-${phone.id}-${at}`
      const select = el('select', { id, 'aria-label': `${phone.label}, slot ${at}` })
      for (const place of [NOWHERE, ...PLACES]) {
        select.append(
          el('option', {
            value: place,
            selected: (state.places[phone.id]?.[at] ?? NOWHERE) === place,
            text: place === NOWHERE ? 'nowhere' : place,
          }),
        )
      }
      select.addEventListener('change', () => {
        const row2 = state.places[phone.id]
        if (row2) row2[at] = select.value
        // Editing the timeline retires any verdict computed from the old one.
        state.reported = false
        void render(host)
      })
      row.append(el('td', {}, [select]))
    }
    body.append(row)
  }
  table.append(body)
  return table
}

/** What one phone heard, and what the matcher said about each entry. */
function logTable(
  world: World,
  broadcasts: readonly Broadcast[],
  phoneId: string,
  result: MatchResult | null,
  design: Design,
): HTMLElement {
  const log = heardBy(world, phoneId, broadcasts)
  const table = el('table', {}, [
    el('caption', {
      text: `What ${PHONES.find((p) => p.id === phoneId)?.label} stored: an identifier and the slot it was heard in. Nothing else — no name, no place, no signal strength.`,
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', class: 'num', text: 'Slot heard' }),
        el('th', { scope: 'col', text: 'Identifier' }),
        el('th', { scope: 'col', text: 'After downloading the report' }),
      ]),
    ]),
  ])
  const body = el('tbody')
  if (log.length === 0) {
    body.append(
      el('tr', {}, [el('td', { colspan: '3', text: 'Nothing heard. This phone was never near another phone.' })]),
    )
  }
  log.forEach((entry, i) => {
    const v = result?.verdicts[i]
    const cell = el('td')
    if (!result) {
      cell.append(tag('nomatch', 'NOTHING PUBLISHED YET'))
    } else if (v?.matched) {
      cell.append(tag('matched', 'MATCHED'))
      cell.append(
        el('span', {
          class: 'field-hint',
          text: ` derived from the published key, ${design.timeRule}`,
        }),
      )
    } else if (v?.rejectedByTime) {
      cell.append(tag('time', 'BYTES MATCH, TIME DOES NOT'))
      cell.append(el('span', { class: 'field-hint', text: ` so it is not counted — ${design.timeRule}` }))
    } else {
      cell.append(tag('nomatch', 'NO MATCH'))
    }
    body.append(
      el(
        'tr',
        { 'data-log-row': String(i), 'data-matched': String(Boolean(v?.matched)) },
        [
          el('th', { scope: 'row', class: 'num', text: String(entry.heardAt) }),
          el('td', {}, [hexCell(entry.identifier, { keep: 5, mark: Boolean(v?.matched) })]),
          cell,
        ],
      ),
    )
  })
  table.append(body)
  return table
}

export async function render(host: HTMLElement): Promise<void> {
  const design = designById(state.designId)
  const keys = await ensureKeys(design)
  const { world, broadcasts } = await meetingScenario(design, {
    slotCount: SLOTS,
    places: PLACES,
    phoneLabels: PHONES,
    presence: presenceOf(),
    keys,
  })

  const reporter = world.phones.find((p) => p.id === state.reporter)
  const published = state.reported && reporter ? design.publish(reporter.keys, 0, world.days) : null

  const others = PHONES.filter((p) => p.id !== state.reporter)
  const results: Record<string, MatchResult | null> = {}
  for (const p of others) {
    results[p.id] = published
      ? await matchLog(design, heardBy(world, p.id, broadcasts), published, world.days)
      : null
  }

  // ── controls ──────────────────────────────────────────────────────────────
  const designSelect = el('select', { id: 'ex3-design' })
  for (const d of DESIGNS) {
    designSelect.append(el('option', { value: d.id, selected: d.id === state.designId, text: d.label }))
  }
  designSelect.addEventListener('change', () => {
    state.designId = designSelect.value as DesignId
    state.reported = false
    state.keys = null
    void render(host)
  })

  const reporterSelect = el('select', { id: 'ex3-reporter' })
  for (const p of PHONES) {
    reporterSelect.append(el('option', { value: p.id, selected: p.id === state.reporter, text: p.label }))
  }
  reporterSelect.addEventListener('change', () => {
    state.reporter = reporterSelect.value
    state.reported = false
    void render(host)
  })

  const reportBtn = el('button', {
    type: 'button',
    class: 'primary',
    id: 'ex3-report',
    'aria-pressed': String(state.reported),
    text: state.reported ? 'Reported — keys are on the server' : 'Report a positive test',
  })
  reportBtn.addEventListener('click', () => {
    state.reported = !state.reported
    void render(host)
  })

  // ── the server's panel ────────────────────────────────────────────────────
  const serverPanel = el('section', { class: 'server-panel', 'aria-labelledby': 'ex3-server-h' }, [
    el('h4', { id: 'ex3-server-h', text: 'The server’s whole view' }),
  ])
  if (published) {
    serverPanel.append(
      el('p', { text: 'It holds these published values, and distributes them to every phone:' }),
      el(
        'ul',
        { class: 'server-knows', 'data-server-items': String(published.items.length) },
        published.items.slice(0, 6).map((item) =>
          el('li', {}, [`${item.label}: `, hexCell(item.value, { keep: 5 })]),
        ),
      ),
    )
    if (published.items.length > 6) {
      serverPanel.append(
        el('p', { class: 'field-hint', text: `… and ${published.items.length - 6} more published values.` }),
      )
    }
  } else {
    serverPanel.append(el('p', { class: 'server-knows', text: 'Nothing. No one has reported.' }))
  }
  serverPanel.append(
    el('p', { text: 'It does not hold, and cannot derive:' }),
    el('ul', { class: 'server-not', 'data-server-log-rows': '0' }, [
      el('li', { text: 'any phone’s log — the logs never leave the phones' }),
      el('li', { text: 'who was near whom, or where, or when' }),
      el('li', { text: 'whether anyone matched anything' }),
      el('li', { text: 'any identifier of a phone that has not reported' }),
    ]),
  )

  // ── the verdicts ──────────────────────────────────────────────────────────
  const verdicts = el('div')
  for (const p of others) {
    const result = results[p.id]
    if (!result) {
      verdicts.append(
        verdict('none', `${p.label.toUpperCase()}: NOTHING TO CHECK YET`, 'No report has been published.', {
          id: `ex3-verdict-${p.id}`,
        }),
      )
      continue
    }
    const exposed = exposureVerdict(result) === 'exposure'
    verdicts.append(
      verdict(
        exposed ? 'matched' : 'none',
        exposed
          ? `${p.label.toUpperCase()}: EXPOSURE MATCHED`
          : `${p.label.toUpperCase()}: NO EXPOSURE`,
        exposed
          ? `${result.matches.length} of ${result.verdicts.length} stored identifiers came from the published report. Recomputed on this phone, from ${result.expandedCount} candidate identifiers; the server was not asked anything.`
          : `None of ${result.verdicts.length} stored identifiers matched any of the ${result.expandedCount} the published report expands to.`,
        { id: `ex3-verdict-${p.id}` },
      ),
    )
  }

  mount(
    host,
    el('h2', { text: '3. Hearing, and matching on the phone' }),
    para(
      'Three phones, eight slots, two places. Set who is where, then have one of them report a positive test. The others download the published key, recompute every identifier it covers, and compare against what they stored — all on the phone. The server never finds out whether anyone matched.',
      'lede',
    ),

    el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [el('label', { for: 'ex3-design', text: 'Design' }), designSelect]),
      el('div', { class: 'field' }, [el('label', { for: 'ex3-reporter', text: 'Who reports' }), reporterSelect]),
      el('div', { class: 'btn-row' }, [reportBtn]),
    ]),
    el('p', { class: 'field-hint', text: `Running ${design.label}: ${design.slotsPerDay} identifiers a day, ${design.timeRule}.` }),

    scrollTable('The timeline you control', timelineTable(design, host)),

    el('h3', { text: 'What each phone stored' }),
    ...others.map((p) =>
      scrollTable(`${p.label}'s log`, logTable(world, broadcasts, p.id, results[p.id] ?? null, design)),
    ),

    el('h3', { text: 'The answer, computed on each phone' }),
    verdicts,

    serverPanel,

    callout(
      'note',
      'WHAT THE MATCHER IS ALLOWED TO SEE',
      para(
        'The matching function in this lab takes exactly two arguments: the phone’s own log, and what the server published. There is no parameter it could use to look at the world — no place, no origin, no ground truth. That is not a promise in prose; it is the signature, and it is why the next exhibit works.',
      ),
    ),

    details(
      'The edge cases, and what each one does',
      list([
        'A key whose start interval is not a multiple of 144 is refused outright, naming the aligned interval it should have had.',
        'An identifier heard on a different day than the reported key covers does not match, however right the bytes are.',
        'Two phones broadcasting in the same slot both get stored; matching is per identifier, not per slot.',
        'A published key with nothing heard gives "no exposure" rather than an error.',
        'A log entry that is not exactly 16 bytes is refused rather than compared as a prefix.',
        'Changing the timeline or the design retires every verdict above, because it was computed from the old one.',
      ]),
    ),
  )
}
