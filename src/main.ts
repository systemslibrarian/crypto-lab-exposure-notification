/**
 * Page shell: the plain-language opening, the six exhibits as tabs, and the
 * honest-scoping card at the bottom.
 *
 * Panels render LAZILY — a tab that has never been activated is hidden and
 * empty — so the a11y gate has to drive the real controls to reach each one,
 * and a renderer that throws leaves a visibly empty panel rather than a
 * half-painted one.
 */

import './styles.css'
import { el, callout, details, list, para } from './ui/render'
import { NEGATIVE_CLAIM } from './claim'

interface Exhibit {
  id: string
  tab: string
  title: string
  load: () => Promise<{ render: (host: HTMLElement) => Promise<void> }>
}

const EXHIBITS: Exhibit[] = [
  {
    id: 'schedule',
    tab: 'One phone, one day',
    title: 'One phone, one day (Apple/Google)',
    load: () => import('./ui/exhibit1-schedule'),
  },
  {
    id: 'chain',
    tab: 'Several days',
    title: 'One phone, several days (DP-3T low-cost)',
    load: () => import('./ui/exhibit2-chain'),
  },
  {
    id: 'matching',
    tab: 'Hearing and matching',
    title: 'Hearing and matching',
    load: () => import('./ui/exhibit3-matching'),
  },
  {
    id: 'relay',
    tab: 'Relay',
    title: 'A relay, and an encounter that never happened',
    load: () => import('./ui/exhibit4-relay'),
  },
  {
    id: 'linkage',
    tab: 'Linkage',
    title: 'Linkage after a report',
    load: () => import('./ui/exhibit5-linkage'),
  },
  {
    id: 'metadata',
    tab: 'Malleable metadata',
    title: 'The metadata is encrypted, not protected',
    load: () => import('./ui/exhibit6-metadata'),
  },
]

function intro(): HTMLElement {
  return el('section', { class: 'card' }, [
    el('h2', { text: 'What this is' }),
    para(
      'In 2020, phones started broadcasting short random-looking numbers over Bluetooth and keeping a list of the ones they heard. The numbers change every ten or fifteen minutes and mean nothing on their own. Each phone keeps its encounter log locally and derives its own broadcasts from secret key material.',
      'lede',
    ),
    para(
      'If you choose to report a positive test, your phone publishes diagnosis material for the reporting period. Other phones download it and compare identifiers against their own encounter logs. The reporting server in this model receives the published material. The logs and match results stay on the phones.',
      'lede',
    ),
    para(
      'This page runs that for real. The identifiers below are computed with the actual HKDF, HMAC-SHA-256, SHA-256 and AES calls the specification names, in your browser, from keys your browser generated. Nothing is canned and no verdict is simulated.',
      'lede',
    ),
    callout(
      'caution',
      'AND THEN THE TWO THINGS IT CANNOT DO',
      el('p', {}, [
        'Publishing a secret so that strangers can recognise your past broadcasts is the same step that lets ',
        el('strong', { text: 'an attacker relay one of your identifiers across town' }),
        ' so a phone there records an encounter that never happened, and lets ',
        el('strong', { text: 'anyone with a few antennas pick your whole day out of their logs' }),
        ' once you have reported. Both are in the designers’ own documents. Exhibits 4 and 5 reproduce them.',
      ]),
    ),
    details(
      'A short glossary, if any of this is new',
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'Identifier' }),
        el('dd', { text: '16 bytes broadcast over Bluetooth. Called a Rolling Proximity Identifier by Apple and Google, an EphID by DP-3T. The same idea either way.' }),
        el('dt', { text: 'HKDF' }),
        el('dd', { text: 'A standard way (RFC 5869) to turn one key into several unrelated keys. Two HMAC calls, here.' }),
        el('dt', { text: 'HMAC' }),
        el('dd', { text: 'A keyed hash: mixes a key and a message into a value nobody can produce without the key.' }),
        el('dt', { text: 'AES in counter mode' }),
        el('dd', { text: 'A block cipher used as a stream: it turns a counter into a keystream and XORs it with your data. Fast, and completely unprotected against modification unless you add something that checks — which is exhibit 6.' }),
        el('dt', { text: 'Relay attack' }),
        el('dd', { text: 'Taking a genuine message heard in one place and putting it on the air somewhere else. Nothing is forged; the message is just in the wrong room.' }),
        el('dt', { text: 'Linkage' }),
        el('dd', { text: 'Working out that several separate observations belong to the same person, without necessarily knowing who that is.' }),
      ]),
    ),
  ])
}

function scoping(): HTMLElement {
  return el('section', { class: 'card', id: 'scope' }, [
    el('h2', { text: 'What this is not' }),
    para(
      'This is a teaching demo, not production software, and not an assessment of anything that was deployed. The phones are simulated — all of them, in this one browser tab. There is no Bluetooth, no radio and no network.',
    ),
    el('div', { class: 'scope-grid' }, [
      el('div', {}, [
        el('h3', { text: 'Not built here' }),
        list([
          'Bluetooth itself: advertising, scanning, MAC randomisation, the radio.',
          'Signal strength, attenuation and distance estimation. The "transmit power" byte in exhibit 6 is a number in a frame, not a measurement.',
          'Risk scoring: how long, how close and how recent an encounter has to be before anyone is told anything.',
          'The upload-authorisation step — how a health authority proves a report is genuine. In this lab anyone can press the report button.',
          'The unlinkable design’s Cuckoo filter server. This lab publishes the seeds themselves instead.',
          'The DP-3T hybrid design, and all centralised designs.',
        ]),
      ]),
      el('div', {}, [
        el('h3', { text: 'Claims this page does NOT make' }),
        list([
          'Any epidemiological claim. Nothing here says whether exposure notification helped.',
          'Any claim about a particular country’s app. This lab chose DP-3T’s unspecified primitives itself, and they match no deployed system.',
          'Any claim that the cryptography is broken. It is not. Exhibits 4, 5 and 6 are limits of what the cryptography was ever able to promise.',
          'Any claim about real people. No location, contact or health data is requested, stored or sent, by this page or by anything it loads.',
        ]),
      ]),
    ]),
    callout(
      'alarm',
      'THE ONE SENTENCE TO TAKE AWAY',
      el('p', { 'data-negative-claim': 'true', text: NEGATIVE_CLAIM }),
    ),
    details(
      'Where every number on this page comes from',
      list([
        'Apple and Google, "Exposure Notification — Cryptography Specification", v1.2, April 2020 — the key schedule, the little-endian interval encoding, and the ±two-hour matching tolerance.',
        'Apple and Google, "Exposure Notification — Bluetooth Specification", v1.2.2 — the four metadata bytes: a version byte and a signed transmit-power reading.',
        'Google’s reference implementation (google/exposure-notifications-internals, CRYPTO.md) — which agrees with the specification, and shows the single-round HKDF expand with counter byte 0x01.',
        'DP-3T Project, "Decentralized Privacy-Preserving Proximity Tracing", white paper of 25 May 2020 — the low-cost and unlinkable designs, what a phone does after reporting, and the passages on relay and linkability quoted in exhibits 4 and 5.',
        'S. Vaudenay, "Analysis of DP3T: Between Scylla and Charybdis", IACR ePrint 2020/399 — the relay attack section, and the observation that the white paper left the hash and the generator unspecified.',
        'Known-answer tests: RFC 5869 cases 1 and 3, FIPS 197 Appendix C.1, NIST SP 800-38A F.5.1.',
      ]),
    ),
  ])
}

function build(root: HTMLElement): void {
  root.replaceChildren()
  root.append(intro())

  const wrap = el('div', { class: 'tabs-wrap' })
  const nav = el('nav', { 'aria-label': 'Exhibits' })
  const tablist = el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Exhibits' })
  nav.append(tablist)
  wrap.append(nav)

  const panels: HTMLElement[] = []
  const buttons: HTMLButtonElement[] = []
  const loaded = new Set<string>()

  async function activate(index: number): Promise<void> {
    buttons.forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === index))
      b.tabIndex = i === index ? 0 : -1
    })
    panels.forEach((p, i) => {
      if (i === index) p.removeAttribute('hidden')
      else p.setAttribute('hidden', '')
    })
    const exhibit = EXHIBITS[index]
    const panel = panels[index]
    if (!exhibit || !panel) return
    if (!loaded.has(exhibit.id)) {
      loaded.add(exhibit.id)
      try {
        const mod = await exhibit.load()
        await mod.render(panel)
      } catch (err) {
        loaded.delete(exhibit.id)
        panel.replaceChildren(
          el('div', { class: 'callout callout-alarm' }, [
            el('span', { class: 'callout-label', text: 'THIS EXHIBIT FAILED TO RUN' }),
            el('p', { text: String((err as Error).message ?? err) }),
          ]),
        )
      }
    }
  }

  EXHIBITS.forEach((exhibit, i) => {
    const btn = el('button', {
      type: 'button',
      class: 'tab-btn',
      id: `tab-${exhibit.id}`,
      role: 'tab',
      'aria-selected': 'false',
      'aria-controls': `panel-${exhibit.id}`,
      tabindex: '-1',
    }) as HTMLButtonElement
    btn.append(el('span', { class: 'tab-num', 'aria-hidden': 'true', text: String(i + 1) }), exhibit.tab)
    btn.addEventListener('click', () => void activate(i))
    btn.addEventListener('keydown', (ev) => {
      const key = (ev as KeyboardEvent).key
      const delta = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'Home' ? -i : key === 'End' ? EXHIBITS.length - 1 - i : 0
      if (delta === 0) return
      ev.preventDefault()
      const next = (i + delta + EXHIBITS.length) % EXHIBITS.length
      buttons[next]?.focus()
      void activate(next)
    })
    buttons.push(btn)
    tablist.append(btn)

    const panel = el('section', {
      class: 'card',
      id: `panel-${exhibit.id}`,
      role: 'tabpanel',
      'aria-labelledby': `tab-${exhibit.id}`,
      tabindex: '0',
      hidden: true,
    })
    panels.push(panel)
    wrap.append(panel)
  })

  root.append(wrap)
  root.append(scoping())
  void activate(0)
}

const main = document.getElementById('main')
if (main) build(main)
