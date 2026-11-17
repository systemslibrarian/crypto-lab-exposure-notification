/**
 * Exhibit 2 — one phone, several days (DP-3T low-cost).
 *
 * The mechanism SHOWN here is the hash chain, because it is the whole reason
 * exhibit 5's middle column behaves differently from its left one: one
 * published seed is every later day.
 */

import {
  BROADCAST_KEY_STRING,
  EPOCHS_PER_DAY,
  EPOCH_MINUTES,
  advanceSeed,
  broadcastKey,
  chainFrom,
  dayIdentifiers,
} from '../crypto/dp3t'
import { fromHex, toHex } from '../crypto/bytes'
import { randomBytes, shuffle } from '../crypto/random'
import { DP3T_SCHEDULE } from '../crypto/vectors'
import { callout, details, el, hexBlock, hexCell, kv, list, mount, para, scrollTable } from './render'

const DAYS = 3

interface State {
  seed0: Uint8Array
  usingVector: boolean
  shownDay: number
  order: string[] | null
}

const state: State = {
  seed0: fromHex(DP3T_SCHEDULE.seed0),
  usingVector: true,
  shownDay: 0,
  order: null,
}

export async function render(host: HTMLElement): Promise<void> {
  const chain = await chainFrom(state.seed0, DAYS)
  const day = Math.min(Math.max(state.shownDay, 0), DAYS - 1)
  const seed = chain[day] as Uint8Array
  const prf = await broadcastKey(seed)
  const ids = await dayIdentifiers(seed)
  const idHex = ids.map(toHex)
  if (!state.order || state.order.length !== idHex.length || !state.order.every((h) => idHex.includes(h))) {
    state.order = shuffle(idHex)
  }
  const order = state.order

  const seedInput = el('input', {
    type: 'text',
    id: 'ex2-seed',
    class: 'hex',
    size: 40,
    value: toHex(state.seed0),
    spellcheck: 'false',
    'aria-describedby': 'ex2-seed-hint',
  })
  seedInput.addEventListener('change', () => {
    try {
      const parsed = fromHex(seedInput.value)
      if (parsed.length !== 32) throw new RangeError('a day seed is 32 bytes')
      state.seed0 = parsed
      state.usingVector = toHex(parsed) === DP3T_SCHEDULE.seed0
      state.order = null
      void render(host)
    } catch (err) {
      seedInput.setAttribute('aria-invalid', 'true')
      const hint = document.getElementById('ex2-seed-hint')
      if (hint) hint.textContent = `Refused: ${(err as Error).message}. Nothing was derived.`
    }
  })

  const reroll = el('button', { type: 'button', class: 'primary', id: 'ex2-reroll', text: 'New random seed' })
  reroll.addEventListener('click', () => {
    state.seed0 = randomBytes(32)
    state.usingVector = false
    state.order = null
    void render(host)
  })

  const useVector = el('button', {
    type: 'button',
    id: 'ex2-vector',
    'aria-pressed': String(state.usingVector),
    text: 'Use test vector',
  })
  useVector.addEventListener('click', () => {
    state.seed0 = fromHex(DP3T_SCHEDULE.seed0)
    state.usingVector = true
    state.order = null
    void render(host)
  })

  const reshuffle = el('button', { type: 'button', id: 'ex2-reshuffle', text: 'Shuffle broadcast order again' })
  reshuffle.addEventListener('click', () => {
    state.order = shuffle(idHex)
    void render(host)
  })

  const daySelect = el('select', { id: 'ex2-day' })
  for (let d = 0; d < DAYS; d++) {
    daySelect.append(el('option', { value: String(d), selected: d === day, text: `Day ${d}` }))
  }
  daySelect.addEventListener('change', () => {
    state.shownDay = Number(daySelect.value)
    state.order = null
    void render(host)
  })

  // The chain, drawn as a chain.
  const chainTable = el('table', {}, [
    el('caption', { text: 'Each day’s seed is SHA-256 of the day before. Publishing one gives every later one.' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Day' }),
        el('th', { scope: 'col', text: 'Seed SK_t' }),
        el('th', { scope: 'col', text: 'Reachable from day 0’s seed?' }),
      ]),
    ]),
  ])
  const chainBody = el('tbody')
  chain.forEach((s, d) => {
    chainBody.append(
      el('tr', {}, [
        el('th', { scope: 'row', class: 'num', text: String(d) }),
        el('td', {}, [hexCell(s, { keep: 6, mark: d === day })]),
        el('td', {}, [
          el('span', {
            text: d === 0 ? 'it IS day 0’s seed' : `yes — ${d} SHA-256 ${d === 1 ? 'call' : 'calls'} forward`,
          }),
        ]),
      ]),
    )
  })
  chainTable.append(chainBody)

  // Generation order vs broadcast order, side by side.
  const orderTable = el('table', {}, [
    el('caption', {
      text: 'Generation order is not broadcast order. The first eight epochs of the day, as the phone actually sends them.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', class: 'num', text: 'Epoch' }),
        el('th', { scope: 'col', text: 'Broadcast (random order)' }),
        el('th', { scope: 'col', class: 'num', text: 'Was generated at index' }),
      ]),
    ]),
  ])
  const orderBody = el('tbody')
  for (let i = 0; i < 8; i++) {
    const hex = order[i] as string
    orderBody.append(
      el('tr', {}, [
        el('th', { scope: 'row', class: 'num', text: String(i) }),
        el('td', {}, [hexCell(fromHex(hex), { keep: 5 })]),
        el('td', { class: 'num', text: String(idHex.indexOf(hex)) }),
      ]),
    )
  }
  orderTable.append(orderBody)

  mount(
    host,
    el('h2', { text: '2. One phone, several days' }),
    para(
      'DP-3T’s low-cost design starts from one random 32-byte seed and hashes it forward, a day at a time. Each day’s seed feeds a PRF and then a generator, and out come that day’s 96 identifiers in one go. The phone then broadcasts them in a random order through the day.',
      'lede',
    ),

    callout(
      'caution',
      'THIS LAB CHOSE THE PRIMITIVES — THE WHITE PAPER DID NOT',
      el('p', {}, [
        'The white paper writes ',
        el('code', { class: 'hex', text: 'EphID_1 || … || EphID_n = PRG( PRF(SK_t, "broadcast key") )' }),
        ' and names HMAC-SHA256 and AES in counter mode only as examples. It fixes neither, and Vaudenay’s analysis points that out. So this page makes its own choices and states them: ',
        el('strong', { text: 'H = SHA-256' }),
        ', ',
        el('strong', { text: 'PRF = HMAC-SHA-256' }),
        ` keyed with SK_t over the ASCII bytes "${BROADCAST_KEY_STRING}", `,
        el('strong', { text: 'PRG = AES-256 in counter mode' }),
        ' keyed with the 32-byte PRF output, starting from a zero counter block and encrypting zeros, and ',
        el('strong', { text: `L = ${EPOCH_MINUTES} minutes` }),
        ` so n = (24 × 60) / ${EPOCH_MINUTES} = ${EPOCHS_PER_DAY}. These match no deployed app, and nothing here should be read as what any country's software did.`,
      ]),
    ),

    el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'ex2-seed', text: 'Day 0 seed SK_0 (32 bytes)' }),
        seedInput,
        el('p', {
          class: 'field-hint',
          id: 'ex2-seed-hint',
          text: state.usingVector
            ? 'The fixed test vector of check C.'
            : 'Freshly generated by crypto.getRandomValues in your browser.',
        }),
      ]),
      el('div', { class: 'field' }, [el('label', { for: 'ex2-day', text: 'Show day' }), daySelect]),
      el('div', { class: 'btn-row' }, [reroll, useVector, reshuffle]),
    ]),

    el('h3', { text: 'The chain' }),
    scrollTable('The three-day seed chain', chainTable),

    el('h3', { text: `Day ${day}: from seed to 96 identifiers` }),
    kv([
      ['SK_t', hexBlock(seed)],
      ['PRF(SK_t, "broadcast key")', hexBlock(prf, { accent: true })],
      ['EphID_1', hexBlock(ids[0] as Uint8Array)],
      ['EphID_2', hexBlock(ids[1] as Uint8Array)],
      [`EphID_${EPOCHS_PER_DAY}`, hexBlock(ids[EPOCHS_PER_DAY - 1] as Uint8Array)],
    ]),
    para(
      `The generator produces ${EPOCHS_PER_DAY} × 16 = ${EPOCHS_PER_DAY * 16} bytes in one pass, split into 16-byte chunks. Every identifier for the day exists the moment the seed does.`,
    ),

    el('h3', { text: 'The random broadcast order' }),
    para(
      'The phone does not send them in the order it generated them. That is deliberate, and it buys something specific: a published seed proves these identifiers are one person’s, but it does not say which was on the air at which minute. An observer who wants that has to read it off its own antenna timestamps — which is exactly what exhibit 5 does.',
    ),
    scrollTable('Broadcast order against generation index', orderTable),

    details(
      'What the phone does after it reports',
      para(
        'It uploads the seed of the first contagious day, then deletes that seed, picks a completely new random one, and starts broadcasting from that. The white paper is explicit about why: "This ensures that after uploading their past seed, users do not become trackable."',
      ),
      list([
        'The new seed is NOT the hash of the reported one. If it were, the published seed would keep linking the user forever, and reporting once would mean being followed for good.',
        'This lab tests that directly — the identifiers the phone broadcasts after a report are absent from everything the published seed expands to.',
      ]),
    ),

    details(
      'The unlinkable design, for comparison',
      para(
        'The same project also specifies a design with no chain at all: a fresh random 32-byte seed for every 15-minute epoch, and EphID = the leftmost 128 bits of SHA-256 of that seed. Reporting means uploading a seed per epoch, so one published value covers exactly one identifier. Exhibit 5 runs all three designs side by side so you can see what that changes.',
      ),
      para(
        'Its server side is a Cuckoo filter over hashed identifiers, which this lab does not build — it publishes the seeds themselves instead. That is a simplification, and it is listed with the others at the bottom of this page.',
      ),
    ),
  )

  // Prove the identity the exhibit claims, in the DOM, for the claims suite:
  // day d's seed really is SHA-256 applied d times to day 0's.
  const check = await advanceSeed(chain[0] as Uint8Array)
  host.querySelector('.panel-body')?.setAttribute('data-chain-day1', toHex(check))
}
