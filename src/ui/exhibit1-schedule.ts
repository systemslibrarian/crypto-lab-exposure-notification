/**
 * Exhibit 1 — one phone, one day (Apple/Google).
 *
 * The headline mechanism, SHOWN: one 16-byte key, two HMAC calls, and then 144
 * AES blocks that differ only in four bytes. The padded block is drawn byte by
 * byte with the interval bytes picked out, because "little-endian" is a claim a
 * reader can check here and nowhere else.
 */

import {
  TEK_ROLLING_PERIOD,
  aemKey,
  alignToRollingPeriod,
  associatedEncryptedMetadata,
  dayOfIdentifiers,
  decodeMetadata,
  encodeMetadata,
  metadataVersion,
  paddedData,
  rpiKey,
  temporaryExposureKey,
} from '../crypto/gaen'
import { fromHex, toHex, utf8 } from '../crypto/bytes'
import { randomBytes } from '../crypto/random'
import { GAEN_SCHEDULE } from '../crypto/vectors'
import { callout, details, el, hexBlock, hexCell, kv, list, mount, para, scrollTable, verdict } from './render'

interface State {
  tek: Uint8Array
  startInterval: number
  usingVector: boolean
  shownInterval: number
}

const state: State = {
  tek: fromHex(GAEN_SCHEDULE.tek),
  startInterval: GAEN_SCHEDULE.startInterval,
  usingVector: true,
  shownInterval: GAEN_SCHEDULE.startInterval,
}

/** The 16 bytes of PaddedData, each cell labelled with what it is. */
function byteGrid(interval: number): HTMLElement {
  const block = paddedData(interval)
  const grid = el('div', { class: 'byte-grid', role: 'list', 'aria-label': 'PaddedData, byte by byte' })
  const prefix = toHex(utf8('EN-RPI'))
  for (let i = 0; i < 16; i++) {
    const kind = i < 6 ? 'prefix' : i < 12 ? 'zero' : 'interval'
    const what =
      i < 6
        ? `byte ${i}: "EN-RPI" character ${i + 1}`
        : i < 12
          ? `byte ${i}: padding zero`
          : `byte ${i}: interval number, little-endian byte ${i - 11} of 4`
    grid.append(
      el('span', {
        class: `byte-cell byte-cell-${kind}`,
        role: 'listitem',
        'aria-label': what,
        title: what,
        text: (block[i] as number).toString(16).padStart(2, '0'),
      }),
    )
  }
  const legend = el('p', { class: 'byte-legend' }, [
    el('span', {}, [
      el('span', { class: 'byte-legend-swatch byte-legend-prefix', text: prefix.slice(0, 12) }),
      ' = UTF-8 "EN-RPI"',
    ]),
    el('span', { text: '000000000000 = six padding zeros' }),
    el('span', {}, [
      el('span', { class: 'byte-legend-swatch byte-legend-interval', text: toHex(block.subarray(12)) }),
      ` = interval ${interval}, little-endian`,
    ]),
  ])
  return el('div', {}, [grid, legend])
}

/** 0x002870b0 spelled out, so "little-endian" is checkable rather than asserted. */
function endiannessNote(interval: number): HTMLElement {
  const block = paddedData(interval)
  const be = toHex(Uint8Array.of(
    (interval >>> 24) & 0xff,
    (interval >>> 16) & 0xff,
    (interval >>> 8) & 0xff,
    interval & 0xff,
  ))
  const le = toHex(block.subarray(12))
  return callout(
    'note',
    'WHY THE BYTES LOOK BACKWARDS',
    el('p', {}, [
      `Interval ${interval} is 0x${interval.toString(16).padStart(8, '0')}. Written the way we say numbers out loud it would be `,
      el('code', { class: 'hex', text: be }),
      ', but the specification says "ENIntervalNumber is encoded as a 32-bit (uint32_t) unsigned little-endian value", so the low byte goes first: ',
      el('code', { class: 'hex hex-accent', 'data-interval-le': le, text: le }),
      '. Get this one detail backwards and every identifier on this page is wrong — which is exactly what the first mutation in this lab’s ledger does.',
    ]),
  )
}

/**
 * The refusal state: a start interval the specification does not allow.
 *
 * Reachable from the control below, because an edge case the learner cannot
 * trigger is a paragraph rather than a behaviour. Nothing is derived here —
 * `temporaryExposureKey` throws before any key material is touched, and the
 * page shows the message it threw rather than a rounded-off schedule.
 */
function renderRefusal(host: HTMLElement, message: string): void {
  const startInput = el('input', {
    type: 'number',
    id: 'ex1-start',
    value: String(state.startInterval),
    'aria-invalid': 'true',
    'aria-describedby': 'ex1-start-hint',
  })
  startInput.addEventListener('change', () => {
    state.startInterval = Number(startInput.value)
    state.shownInterval = state.startInterval
    void render(host)
  })
  const fix = el('button', {
    type: 'button',
    class: 'primary',
    id: 'ex1-align',
    text: `Use ${alignToRollingPeriod(state.startInterval)} instead`,
  })
  fix.addEventListener('click', () => {
    state.startInterval = alignToRollingPeriod(state.startInterval)
    state.shownInterval = state.startInterval
    void render(host)
  })

  mount(
    host,
    el('h2', { text: '1. One phone, one day' }),
    para(
      'A phone picks sixteen random bytes and keeps them, then derives the 144 identifiers it will broadcast over the next twenty-four hours. But not from any starting point: every phone rolls its key at the same moment, and that moment is an interval whose number is a multiple of 144.',
      'lede',
    ),
    el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'ex1-start', text: 'Key start interval' }),
        startInput,
        el('p', {
          class: 'field-hint',
          id: 'ex1-start-hint',
          text: 'Must be a multiple of 144 (TEKRollingPeriod).',
        }),
      ]),
      el('div', { class: 'btn-row' }, [fix]),
    ]),
    verdict('refused', 'REFUSED \u2014 NOTHING WAS DERIVED', message, { id: 'ex1-verdict' }),
    callout(
      'note',
      'WHY THIS IS REFUSED RATHER THAN ROUNDED',
      para(
        'The specification: "All devices sharing the same TEKRollingPeriod roll keys at the same time \u2014 at the beginning of an interval whose ENIntervalNumber is a multiple of TEKRollingPeriod." A key starting anywhere else is not a key any device would have produced, so quietly aligning it would hide the mistake inside all 144 identifiers derived from it. Fail closed, and say which interval it should have been.',
      ),
    ),
  )
}

export async function render(host: HTMLElement): Promise<void> {
  let tek
  try {
    tek = temporaryExposureKey(state.tek, state.startInterval)
  } catch (err) {
    renderRefusal(host, (err as Error).message)
    return
  }
  const rpikTrace = await rpiKey(tek.key)
  const aemkTrace = await aemKey(tek.key)
  const day = await dayOfIdentifiers(tek)
  const shown = Math.min(
    Math.max(state.shownInterval, tek.startInterval),
    tek.startInterval + TEK_ROLLING_PERIOD - 1,
  )
  const shownId = day.ids[shown - tek.startInterval] as Uint8Array

  const metadata = encodeMetadata({ versionByte: 0x40, txPowerDbm: -8 })
  const aem = await associatedEncryptedMetadata(aemkTrace.okm, day.ids[0] as Uint8Array, metadata)

  // ── controls ──────────────────────────────────────────────────────────────
  const tekInput = el('input', {
    type: 'text',
    id: 'ex1-tek',
    class: 'hex',
    size: 34,
    value: toHex(state.tek),
    'aria-describedby': 'ex1-tek-hint',
    spellcheck: 'false',
  })
  const startInput = el('input', {
    type: 'number',
    id: 'ex1-start',
    value: String(tek.startInterval),
    'aria-describedby': 'ex1-start-hint',
  })
  startInput.addEventListener('change', () => {
    const v = Number(startInput.value)
    if (!Number.isInteger(v) || v === state.startInterval) return
    state.startInterval = v
    state.shownInterval = v
    void render(host)
  })

  const intervalInput = el('input', {
    type: 'number',
    id: 'ex1-interval',
    min: String(tek.startInterval),
    max: String(tek.startInterval + TEK_ROLLING_PERIOD - 1),
    value: String(shown),
  })

  const reroll = el('button', { type: 'button', class: 'primary', id: 'ex1-reroll', text: 'New random key' })
  reroll.addEventListener('click', () => {
    state.tek = randomBytes(16)
    state.usingVector = false
    void render(host)
  })

  const useVector = el('button', {
    type: 'button',
    id: 'ex1-vector',
    'aria-pressed': String(state.usingVector),
    text: 'Use test vector',
  })
  useVector.addEventListener('click', () => {
    state.tek = fromHex(GAEN_SCHEDULE.tek)
    state.startInterval = GAEN_SCHEDULE.startInterval
    state.shownInterval = GAEN_SCHEDULE.startInterval
    state.usingVector = true
    void render(host)
  })

  tekInput.addEventListener('change', () => {
    try {
      const parsed = fromHex(tekInput.value)
      if (parsed.length !== 16) throw new RangeError('a Temporary Exposure Key is 16 bytes')
      state.tek = parsed
      state.usingVector = toHex(parsed) === GAEN_SCHEDULE.tek
      void render(host)
    } catch (err) {
      tekInput.setAttribute('aria-invalid', 'true')
      const hint = document.getElementById('ex1-tek-hint')
      if (hint) hint.textContent = `Refused: ${(err as Error).message}. Nothing was derived.`
    }
  })

  intervalInput.addEventListener('change', () => {
    const v = Number(intervalInput.value)
    if (Number.isInteger(v)) {
      state.shownInterval = v
      void render(host)
    }
  })

  // ── the day's 144 identifiers ─────────────────────────────────────────────
  const strip = el('div', { class: 'id-strip', role: 'list', 'aria-label': 'The 144 identifiers of this key’s day' })
  day.ids.forEach((id, k) => {
    const interval = tek.startInterval + k
    strip.append(
      el('span', {
        class: `id-chip${interval === shown ? ' id-chip-mark' : ''}`,
        role: 'listitem',
        'data-interval': String(interval),
        'data-full': toHex(id),
        'aria-label': `interval ${interval}: ${toHex(id)}`,
        title: `interval ${interval}`,
        text: toHex(id).slice(0, 4),
      }),
    )
  })

  const table = el('table', {}, [
    el('caption', { text: 'The first three intervals and the last, in full.' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', class: 'num', text: 'Interval' }),
        el('th', { scope: 'col', text: 'PaddedData' }),
        el('th', { scope: 'col', text: 'Rolling Proximity Identifier' }),
      ]),
    ]),
  ])
  const tbody = el('tbody')
  for (const k of [0, 1, 2, TEK_ROLLING_PERIOD - 1]) {
    const interval = tek.startInterval + k
    tbody.append(
      el('tr', {}, [
        el('th', { scope: 'row', class: 'num', text: String(interval) }),
        el('td', {}, [hexCell(paddedData(interval), { keep: 5 })]),
        el('td', {}, [hexCell(day.ids[k] as Uint8Array, { keep: 5 })]),
      ]),
    )
  }
  table.append(tbody)

  mount(
    host,
    el('h2', { text: '1. One phone, one day' }),
    para(
      'A phone picks sixteen random bytes and keeps them. From those sixteen bytes it derives two keys, and from one of those it derives the 144 identifiers it will broadcast over the next twenty-four hours — one every ten minutes. Nothing here is a hash of anything the phone knows about you; the only input is the random key and the clock.',
      'lede',
    ),

    el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'ex1-tek', text: 'Temporary Exposure Key (16 bytes)' }),
        tekInput,
        el('p', {
          class: 'field-hint',
          id: 'ex1-tek-hint',
          text: state.usingVector
            ? 'This is the fixed test vector of check B, so every value below can be compared with the README.'
            : 'Freshly generated by crypto.getRandomValues in your browser. Never sent anywhere.',
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'ex1-start', text: 'Key start interval' }),
        startInput,
        el('p', {
          class: 'field-hint',
          id: 'ex1-start-hint',
          text: `A multiple of 144, so ${tek.startInterval} / 144 = ${tek.startInterval / TEK_ROLLING_PERIOD}. Try ${tek.startInterval + 1}.`,
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'ex1-interval', text: 'Show interval' }),
        intervalInput,
        el('p', { class: 'field-hint', text: `Valid for this key: ${tek.startInterval} to ${tek.startInterval + 143}.` }),
      ]),
      el('div', { class: 'btn-row' }, [reroll, useVector]),
    ]),

    el('h3', { text: 'Step 1 — two HKDF calls turn one key into two' }),
    para(
      'HKDF-SHA-256 with no salt. The extract step is one HMAC under 32 zero bytes; the expand step is one more HMAC, over the info string and a single counter byte 0x01, truncated to 16 bytes. Both derived keys share the extract step and differ only in that info string.',
    ),
    kv([
      ['TEK', hexBlock(tek.key)],
      ['PRK (extract)', hexBlock(rpikTrace.prk)],
      ['info "EN-RPIK" → RPIK', hexBlock(rpikTrace.okm, { accent: true })],
      ['info "EN-AEMK" → AEMK', hexBlock(aemkTrace.okm, { accent: true })],
    ]),

    el('h3', { text: `Step 2 — the block that goes into AES, for interval ${shown}` }),
    para(
      'Every one of the day’s 144 identifiers is a single AES-128 encryption of this block under RPIK. Twelve of the sixteen bytes are the same every time. Only the last four change.',
    ),
    byteGrid(shown),
    endiannessNote(shown),
    kv([
      ['PaddedData', hexBlock(paddedData(shown))],
      ['AES-128 under RPIK', hexBlock(shownId, { accent: true })],
    ]),

    el('h3', { text: 'Step 3 — the whole day' }),
    para(
      'All 144 identifiers, first four hex digits each, in interval order. The highlighted one is the interval selected above. They are unrelated to each other to anyone who does not hold the key — and completely determined by it to anyone who does.',
    ),
    strip,
    scrollTable('The first three intervals and the last', table),

    el('h3', { text: 'Step 4 — the metadata rides along, encrypted but not authenticated' }),
    para(
      'Four bytes travel with each identifier: a version byte and a transmit-power reading used for distance estimation. They are encrypted with AES-128 in counter mode under AEMK, using the identifier itself as the initial counter block. There is no authentication tag — see exhibit 6 for what that costs.',
    ),
    kv([
      ['Metadata (plain)', hexBlock(metadata)],
      ['Reading', el('span', { text: `version ${metadataVersion(0x40)}, transmit power ${decodeMetadata(metadata).txPowerDbm} dBm` })],
      ['Counter block = RPI', hexBlock(day.ids[0] as Uint8Array)],
      ['Encrypted metadata', hexBlock(aem, { accent: true })],
    ]),

    details(
      'What rolls when, and why the start interval must be a multiple of 144',
      para(
        'Time is cut into ten-minute intervals counted from the Unix epoch: ENIntervalNumber = floor(seconds / 600). A key is valid for 144 of them, which is a day, and every phone rolls at the same moment — at an interval whose number is a multiple of 144. That alignment is what lets a receiver recompute a reported key’s identifiers without being told anything else about the sender’s clock.',
      ),
      list([
        `This key starts at interval ${tek.startInterval}, which is ${tek.startInterval / TEK_ROLLING_PERIOD} × 144.`,
        `In UTC that is ${new Date(tek.startInterval * 600 * 1000).toISOString().replace('.000Z', 'Z')}.`,
        `An unaligned start interval is refused rather than rounded: ${tek.startInterval + 1} would be rejected, with ${alignToRollingPeriod(tek.startInterval + 1)} named as the nearest aligned one.`,
      ]),
      para(
        'Keys are independent of one another. There is no chain: knowing today’s key tells you nothing about tomorrow’s. That single property is the difference between exhibit 5’s two left-hand columns.',
      ),
    ),
  )
}
