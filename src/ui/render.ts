/**
 * DOM helpers.
 *
 * Two rules everything here obeys:
 *
 *  1. An identifier is shown shortened, and the full 16 bytes are always in the
 *     DOM for assistive technology — `hexCell` builds both halves and never
 *     offers a short-only form.
 *  2. A state that carries meaning carries a TEXT label (`tag`). Colour and
 *     position are redundant with it, never the whole signal (WCAG 1.4.1).
 */

import { shortHex, toHex } from '../crypto/bytes'

type Attrs = Record<string, string | number | boolean | undefined>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (k === 'class') node.className = String(v)
    else if (k === 'text') node.textContent = String(v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return node
}

export function frag(children: (Node | string)[]): DocumentFragment {
  const f = document.createDocumentFragment()
  for (const c of children) f.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return f
}

/** Replace a host's content, wrapped so the 120ms recompute fade applies. */
export function mount(host: HTMLElement, ...children: (Node | string)[]): void {
  host.replaceChildren(el('div', { class: 'panel-body' }, children))
}

/**
 * An identifier, shortened on screen with the full value for a screen reader.
 *
 * `data-full` is the value the claims suite reads: a test recomputes the
 * identifier from the key on screen and compares it against this attribute, so
 * the ellipsis can never hide a mismatch.
 */
export function hexCell(bytes: Uint8Array, opts: { mark?: boolean; keep?: number } = {}): HTMLElement {
  const full = toHex(bytes)
  return el(
    'code',
    {
      class: `hex${opts.mark ? ' hex-accent' : ''}`,
      'data-full': full,
    },
    [
      el('span', { 'aria-hidden': 'true', text: shortHex(bytes, opts.keep ?? 4) }),
      el('span', { class: 'sr-only', text: full }),
    ],
  )
}

/** The full value, unshortened, in a block. Used where there is room for it. */
export function hexBlock(bytes: Uint8Array, opts: { accent?: boolean } = {}): HTMLElement {
  const full = toHex(bytes)
  return el('code', {
    class: `hex hex-block${opts.accent ? ' hex-accent' : ''}`,
    'data-full': full,
    text: full,
  })
}

/** A text state label. The text IS the signal. */
export function tag(kind: string, text: string): HTMLElement {
  return el('span', { class: `tag tag-${kind}`, text })
}

export function kv(pairs: [string, Node | string][]): HTMLElement {
  const dl = el('dl', { class: 'kv' })
  for (const [k, v] of pairs) {
    dl.append(el('dt', { text: k }), el('dd', {}, [v]))
  }
  return dl
}

export type VerdictTone = 'none' | 'matched' | 'alarm' | 'refused'

/**
 * A verdict block.
 *
 * `data-verdict` is the marker the claims suite and the mutation script read.
 * The tone tracks SYSTEM INTEGRITY rather than the matcher's return value: a
 * match that is also a false encounter is `alarm`, not success.
 */
export function verdict(
  tone: VerdictTone,
  title: string,
  detail?: Node | string,
  opts: { id?: string } = {},
): HTMLElement {
  const node = el(
    'div',
    {
      class: `verdict verdict-${tone}`,
      role: 'status',
      'aria-live': 'polite',
      'data-verdict': tone,
      id: opts.id,
    },
    [el('strong', { class: 'verdict-title', text: title })],
  )
  if (detail !== undefined) {
    node.append(el('span', { class: 'verdict-detail' }, [detail]))
  }
  return node
}

export function callout(
  kind: 'note' | 'alarm' | 'caution',
  label: string,
  ...body: (Node | string)[]
): HTMLElement {
  return el('div', { class: `callout callout-${kind}` }, [
    el('span', { class: 'callout-label', text: label }),
    ...body,
  ])
}

export function card(heading: string, ...body: (Node | string)[]): HTMLElement {
  return el('section', { class: 'card' }, [el('h2', { text: heading }), ...body])
}

export function para(text: string, cls = ''): HTMLElement {
  return el('p', { class: cls, text })
}

export function list(items: (Node | string)[]): HTMLElement {
  return el(
    'ul',
    { class: 'plain-list' },
    items.map((i) => el('li', {}, [i])),
  )
}

/**
 * A table that can scroll sideways on a narrow screen.
 *
 * The wrapper takes `tabindex="0"`, `role="region"` and a label, because a
 * scrollable region that cannot be reached by keyboard is a WCAG failure the
 * Linux CI runner catches even where a local browser does not.
 */
export function scrollTable(label: string, table: HTMLElement): HTMLElement {
  return el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': label }, [
    table,
  ])
}

export function details(summary: string, ...body: (Node | string)[]): HTMLElement {
  return el('details', {}, [el('summary', { text: summary }), ...body])
}
