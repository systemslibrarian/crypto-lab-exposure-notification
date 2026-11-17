import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditControlNames, formatControlNameFailures } from './control-names';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the one rendering a reduced-motion reader actually gets — `.panel` and
 *     `.reveal` with their animations cancelled by the stylesheet's own rule —
 *     was never once the rendering that got scanned. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect (`test.use({ reducedMotion })` silently does nothing on
 *     Playwright 1.61.1), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan. Stripping `hidden` puts all six tabpanels on screen AT ONCE — a
 *     rendering no reader can reach and axe then scans instead of the real one
 *     — and script-opening the disclosures means the SHUT state, which is what
 *     every reader arrives at, was never scanned at all. This gate switches
 *     tabs by clicking them and opens each disclosure through its `<summary>`,
 *     which is the route a reader has, and scans before and after.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked
 *     every button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed 120ms per tab, and scanned ONCE at the
 *     end — so the invalid-key rendering, the malformed-hex branch, the
 *     rejected-preset pipeline and the stepper's intermediate reveals were all
 *     overwritten before anything measured them, and a click that silently did
 *     nothing looked identical to one that worked. This drive names every
 *     control it touches, asserts a real completion signal after each, and
 *     scans after every step, at both 1280 and 380 wide. Dark is the only
 *     theme this fleet ships, so there is no second palette to cross.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning — the four `.verdict-*` tones, every `.tag-*` state
 *     label, the `.callout-alarm` / `.callout-caution` warnings, the
 *     `.byte-cell` colour bands and the shared top bar's `color-mix()` ink —
 *     are judged arithmetically here, because axe files an unresolved
 *     `color-mix()` under `incomplete` rather than deciding it. So is an
 *     `aria-label` on a role-less element, and this page has many: every
 *     `.byte-cell` of the padded block and every `.id-chip` of a
 *     144-identifier strip carries one.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The old
 *     spec hand-rolled one luminance check over two input selectors, reading
 *     the DECLARED `border-top-color` and `background-color` — blind to
 *     `color-mix()`, to composited backdrops, to every `.tab-btn`, every
 *     `#app button`, every `select` and every `.table-scroll` edge, and to all
 *     states past first paint.
 *     `nontext.ts` replaces it with a measured oracle over every control at
 *     every driven state, and `expectNoHorizontalOverflow` adds the 1.4.10
 *     check axe has no rule for.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels `.panel` / `.reveal` animations and every transition, so
 * `getAnimations()` is normally empty and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE the lab's `@media` block — `* { transition: none !important }` wins
 * today, but that is a property of the current stylesheet, not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * has EXACTLY that shape in miniature: `@keyframes fade` and `@keyframes
 * reveal` both start `from { opacity: 0 }`, and every tab panel and every
 * stepper line rides one of them. The reduced-motion block cancels both with
 * `animation: none`, which restores the static `opacity: 1` — correct today,
 * and this assertion is what makes that a measurement rather than a reading.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is decorative
 * verdict/pill glyphs beside their own words — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies
 * a second banner today — but the shared bar's `dedupeBanner()` exists because
 * other labs in this fleet DID ship one, and the hero markup is the part of
 * this page most likely to be re-templated from a lab that uses `<header>`.
 * Asserting the OUTCOME rather than the markup is what catches that edit.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab's one list is the Verify Workbench pipeline: `ol.stage-list` styled
 * `list-style: none`, which is exactly the declaration that makes Safari and
 * VoiceOver DROP the list's implicit role. `verifyWorkbench.ts` compensates
 * the documented way — an explicit `role="list"` on the `<ol>` and
 * `role="listitem"` on every `.stage` — so here, unlike most of this fleet, an
 * explicit role on a list is the fix rather than the defect. What is asserted
 * is therefore the SHAPE of that fix: any explicit role on a `ul`/`ol` must be
 * `list` (any other value orphans every `<li>` under it), and a `role="list"`
 * must never sit on an empty element, because axe applies
 * `aria-required-children` to the explicit role and fails it the day the
 * pipeline renders with no stages. Roles can be assigned as JS properties in
 * an element-creation helper, so ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including
 * the lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Nothing in this lab's JS branches on
 * `matchMedia`, but the CSS reduced-motion block is the only thing standing
 * between a scan and the mid-flight `fade`/`reveal` opacities, so the
 * assertion is still the difference between scanning the reduced-motion
 * rendering and merely believing we did.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which pins down a real coupling as a side effect: `index.html`'s
 * anti-flash script reads `localStorage.getItem('theme')` and the shared bar's
 * toggle writes `localStorage.setItem('theme', …)`. Both agree on `'theme'`;
 * if either drifted, this boot fails on `data-theme` rather than quietly
 * scanning dark twice.
 *
 * The defaults are asserted at length because `main.ts` renders each tabpanel
 * lazily on first activation, and the Sign & Verify panel signs a real message
 * at mount. A navigation that resolves proves nothing: a renderer that threw
 * would leave `#panel-sign` empty, and an empty region is exactly what a scan
 * reports as perfectly accessible.
 */
/**
 * Arrive at the page and assert the SHIPPED state, before anything is driven.
 *
 * Everything asserted here is STRUCTURE: controls exist, counts are right,
 * lazily-rendered panels are hidden AND empty, defaults match a shape. Nothing
 * here asserts what a string SAYS — that belongs in `claims.spec.ts`, where a
 * failure names copy as the subject. Master template 4.1a, which exists
 * because a lab once changed one default sentence and the step that went red
 * was called "Accessibility gate" while four of its six a11y tests passed.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('.tab-btn')).toHaveCount(6);
  await expect(page.locator('h1')).toHaveCount(1);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme. Not the shared bar's toggle, which was removed
  // fleet-wide, and not a lab-local one. The shared CSS hides any lab toggle
  // with `display:none !important`, which would leave a dead-but-known
  // element; asserting the count at zero catches the day one is added.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── The arrival state: exhibit 1 active, five panels hidden AND EMPTY ───
  // Every panel renders lazily, so a tab never clicked is a panel never in the
  // DOM. "Empty" is this lab's tell that a renderer threw — `watchPageErrors`
  // catches the throw, and this catches a panel that silently rendered nothing.
  await expect(page.locator('#panel-schedule')).toBeVisible();
  await expect(page.locator('#panel-schedule .byte-grid')).toBeVisible();
  for (const id of ['chain', 'matching', 'relay', 'linkage', 'metadata']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }

  // ── Exhibit 1's shipped structure ──────────────────────────────────────
  // The padded block is 16 cells, and the day is 144 identifiers. Those two
  // counts ARE the specification's key schedule; a renderer that produced 143
  // of either would still paint a plausible-looking page.
  await expect(page.locator('#panel-schedule .byte-cell')).toHaveCount(16);
  await expect(page.locator('#panel-schedule .id-chip')).toHaveCount(144);

  // Defaults as SHAPES, not sentences: a 32-digit hex key and an interval that
  // is a number. What the hint text says about them is a claim.
  await expect(page.locator('#ex1-tek')).toHaveValue(/^[0-9a-f]{32}$/);
  await expect(page.locator('#ex1-interval')).toHaveValue(/^\d+$/);

  // ── Disclosures ship shut ───────────────────────────────────────────────
  await expect(page.locator('details[open]')).toHaveCount(0);

  // ── The scoping card ships rendered, not behind a disclosure ───────────
  // Master template 4.1d assertion 3 needs the limitation visible without the
  // reader opening anything; this is the structural half of that.
  await expect(page.locator('#scope')).toBeVisible();
  await expect(page.locator('[data-negative-claim]')).toBeVisible();

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. This lab's long
 * values are 32-digit hex identifiers and 64-digit seeds — `.hex` relies on
 * `overflow-wrap: anywhere`, and every table is wrapped in its own
 * `.table-scroll` region rather than being allowed to widen the page — so the
 * shapes at risk are a new unwrapped `<code>` run, a `.byte-grid` whose 16
 * columns stop collapsing to 8 below 760px, and the timeline table's selects.
 * At 380px that is precisely what this check exists to catch.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab currently avoids scrollers on purpose — long hex wraps via
 * `overflow-wrap: anywhere` — so the assertion is usually vacuous here. It
 * runs at every state anyway, because the requirement MATERIALISES the moment
 * someone reaches for `overflow-x: auto` on a wide value or table (the
 * stylesheet already carries an unused `.table-wrap` rule inviting exactly
 * that), and a scroller born without a keyboard route is invisible to axe.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less element hides. This page leans hard
 *    on getting that right: the `.byte-grid` and every `.id-strip` are
 *    `role="list"` with `role="listitem"` children so their per-byte and
 *    per-identifier labels are read rather than discarded, and every
 *    `.table-scroll` is a labelled `role="region"`. Drop one of those roles
 *    and the label is silently thrown away with no violation raised.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // axe's `label` rule accepts a bare `placeholder` as an accessible name, so a
  // deleted label can leave this gate green. See `control-names.ts`.
  const unnamed = formatControlNameFailures(await auditControlNames(page));
  softExpect(unnamed, `form controls named only by placeholder/title in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Switch to a tab by clicking it, and prove the switch happened. */
async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/**
 * Drive the lab through every state that renders content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: exhibit 1
 *    active with its 144 identifiers and its byte grid painted, the other five
 *    panels hidden and UNRENDERED, every disclosure shut.
 *
 *  - EVERY PANEL IS RENDERED LAZILY, so each of the six is activated through
 *    its real tab button and then driven in its own states. Nothing is revealed
 *    from script: stripping `[hidden]` would put six panels on screen at once,
 *    a rendering no reader can reach, and would destroy the ability to catch
 *    the `[hidden]` cascade trap.
 *
 *  - EVERY VERDICT TONE THIS LAB CAN PAINT. There are four — `none`,
 *    `matched`, `alarm` and `refused` — and three of them are only reachable by
 *    pressing something: the relay's alarm verdict, its refusal of a delayed
 *    replay, the linkage alarm after a report, and the metadata panel's
 *    tampered state. Each is a different border and ink pair, and none had ever
 *    been scanned before it was driven here.
 *
 *  - EVERY REFUSAL STATE. A malformed key in exhibit 1 and a short seed in
 *    exhibit 2 both paint `aria-invalid` and replace the hint with a refusal.
 *    Neither is reachable without typing something wrong on purpose.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the
 *    state a reader occupies the instant after pressing a button — and
 *    `.tab-btn:hover`, `#app button:hover` and `.cl-btn:hover` all repaint.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a
 *    verdict's `data-verdict` tone, a row count, `aria-selected`, `aria-pressed`.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('arrival: exhibit 1 painted, five panels unrendered, disclosures shut');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── Exhibit 1: the key schedule ─────────────────────────────────────────
  // A fresh random key, so the page is scanned on values no vector pinned.
  await page.locator('#ex1-reroll').click();
  await expect(page.locator('#ex1-vector')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#panel-schedule .id-chip')).toHaveCount(144);
  await scanAt('exhibit 1 on a freshly generated key');
  await scanAt('exhibit 1, the reroll button still hovered after its click');

  // A malformed key: refused, with `aria-invalid` painted on the input.
  await page.locator('#ex1-tek').fill('not-hex');
  await page.locator('#ex1-tek').blur();
  await expect(page.locator('#ex1-tek')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('exhibit 1 refusing a non-hex key, aria-invalid boundary painted');

  // A hex key of the wrong length: also refused, by a different branch.
  await page.locator('#ex1-tek').fill('00112233');
  await page.locator('#ex1-tek').blur();
  await expect(page.locator('#ex1-tek')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('exhibit 1 refusing a short key');

  // Back to the vector, and a different interval so the byte grid repaints
  // with different interval bytes.
  await page.locator('#ex1-vector').click();
  await expect(page.locator('#ex1-vector')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#ex1-interval').fill('2650100');
  await page.locator('#ex1-interval').blur();
  await expect(page.locator('#panel-schedule .byte-cell')).toHaveCount(16);
  await scanAt('exhibit 1 on the test vector at a mid-day interval');

  // Its disclosure, opened through the summary a reader actually clicks.
  const ex1Details = page.locator('#panel-schedule details').first();
  await ex1Details.locator('summary').click();
  await expect(ex1Details).toHaveAttribute('open', '');
  await scanAt('exhibit 1 with the rolling-period disclosure open');

  // ── Exhibit 2: the hash chain ───────────────────────────────────────────
  await openTab(page, /Several days/, '#panel-chain');
  await expect(page.locator('#panel-chain tbody tr').first()).toBeVisible();
  await scanAt('exhibit 2 arrival, the three-day chain on the test vector');

  await page.locator('#ex2-reroll').click();
  await expect(page.locator('#ex2-vector')).toHaveAttribute('aria-pressed', 'false');
  await scanAt('exhibit 2 on a freshly generated seed');

  await page.locator('#ex2-reshuffle').click();
  await scanAt('exhibit 2 after reshuffling the broadcast order');

  await page.locator('#ex2-day').selectOption('2');
  await expect(page.locator('#ex2-day')).toHaveValue('2');
  await scanAt('exhibit 2 showing day 2, two hashes along the chain');

  await page.locator('#ex2-seed').fill('00ff');
  await page.locator('#ex2-seed').blur();
  await expect(page.locator('#ex2-seed')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('exhibit 2 refusing a short seed');

  for (const i of [0, 1]) {
    const d = page.locator('#panel-chain details').nth(i);
    await d.locator('summary').click();
    await expect(d).toHaveAttribute('open', '');
  }
  await scanAt('exhibit 2 with both disclosures open');

  // ── Exhibit 3: hearing and matching ─────────────────────────────────────
  await openTab(page, /Hearing and matching/, '#panel-matching');
  await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'none');
  await scanAt('exhibit 3 arrival, nothing published, verdicts in the none tone');

  await page.locator('#ex3-report').click();
  await expect(page.locator('#ex3-report')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'matched');
  await scanAt('exhibit 3 after a report: matched tone, MATCHED tags, server panel filled');

  // Editing the timeline retires the verdict. The no-op guard for this is in
  // claims.spec.ts; what the gate needs is the retired RENDERING.
  await page.locator('#tl-B-1').selectOption('nowhere');
  await expect(page.locator('#ex3-report')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'none');
  await scanAt('exhibit 3 with the verdict retired by a timeline edit');

  // A phone that hears nothing at all: the empty-log rendering.
  for (const slot of [0, 2, 3, 4, 5, 6, 7]) {
    await page.locator(`#tl-B-${slot}`).selectOption('nowhere');
  }
  await page.locator('#ex3-report').click();
  await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'none');
  await scanAt('exhibit 3 with phone B nowhere: an empty log and a no-exposure verdict');

  // The other two designs, each with its own time rule and published shape.
  await page.locator('#ex3-design').selectOption('dp3t-lowcost');
  await expect(page.locator('#ex3-design')).toHaveValue('dp3t-lowcost');
  await page.locator('#ex3-report').click();
  await expect(page.locator('#ex3-report')).toHaveAttribute('aria-pressed', 'true');
  await scanAt('exhibit 3 running DP-3T low-cost');

  await page.locator('#ex3-design').selectOption('dp3t-unlinkable');
  await page.locator('#ex3-report').click();
  await expect(page.locator('#ex3-report')).toHaveAttribute('aria-pressed', 'true');
  await scanAt('exhibit 3 running DP-3T unlinkable, publishing one seed per epoch');

  const ex3Details = page.locator('#panel-matching details').first();
  await ex3Details.locator('summary').click();
  await expect(ex3Details).toHaveAttribute('open', '');
  await scanAt('exhibit 3 with the edge-case disclosure open');

  // ── Exhibit 4: the relay, and the negative claim's fixture ──────────────
  await openTab(page, /Relay/, '#panel-relay');
  // The shipped state IS the evidence fixture: relay live, A and B apart.
  await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-verdict', 'alarm');
  await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-colocated', 'false');
  await scanAt('exhibit 4 arrival: the alarm verdict, which is the negative claim fixture');
  await scanAt('exhibit 4, still hovering the tab that opened it');

  await page.locator('#ex4-delay').click();
  await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-verdict', 'refused');
  await scanAt('exhibit 4 refusing a delayed replay: the refused tone');

  await page.locator('#ex4-live').click();
  await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-verdict', 'alarm');
  await page.locator('#ex4-colocate').click();
  await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-colocated', 'true');
  await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-verdict', 'matched');
  await scanAt('exhibit 4 bite fixture: A and B really together, matched rather than alarm');

  await page.locator('#ex4-colocate').click();
  await page.locator('#ex4-relay').click();
  await expect(page.locator('#ex4-relay')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-verdict', 'none');
  await scanAt('exhibit 4 with the relay off: nothing heard');

  await page.locator('#ex4-relay').click();
  const ex4Details = page.locator('#panel-relay details').first();
  await ex4Details.locator('summary').click();
  await expect(ex4Details).toHaveAttribute('open', '');
  await scanAt('exhibit 4 with the tolerance disclosure open');

  // ── Exhibit 5: linkage ──────────────────────────────────────────────────
  await openTab(page, /Linkage/, '#panel-linkage');
  await expect(page.locator('#ex5-verdict')).toHaveAttribute('data-reported', 'false');
  await expect(page.locator('tr[data-design="gaen"]')).toHaveAttribute('data-largest-before', '1');
  await scanAt('exhibit 5 arrival: three designs, nothing grouped');

  await page.locator('#ex5-report').click();
  await expect(page.locator('#ex5-verdict')).toHaveAttribute('data-reported', 'true');
  await expect(page.locator('#ex5-verdict')).toHaveAttribute('data-verdict', 'alarm');
  await scanAt('exhibit 5 after the report: LINKED tags and the alarm verdict');

  await page.locator('#ex5-day0').click();
  await expect(page.locator('#ex5-day0')).toHaveAttribute('aria-pressed', 'true');
  await scanAt('exhibit 5 publishing from day 0, the whole window');

  await page.locator('#ex5-day1').click();
  await expect(page.locator('#ex5-day1')).toHaveAttribute('aria-pressed', 'true');
  const ex5Details = page.locator('#panel-linkage details').first();
  await ex5Details.locator('summary').click();
  await expect(ex5Details).toHaveAttribute('open', '');
  await scanAt('exhibit 5 with the how-linked-is-decided disclosure open');

  // ── Exhibit 6: malleable metadata ───────────────────────────────────────
  await openTab(page, /Malleable metadata/, '#panel-metadata');
  await expect(page.locator('#ex6-verdict')).toHaveAttribute('data-verdict', 'none');
  await scanAt('exhibit 6 arrival, metadata untouched');

  await page.locator('#ex6-flip').click();
  await expect(page.locator('#ex6-verdict')).toHaveAttribute('data-verdict', 'alarm');
  await scanAt('exhibit 6 with the transmit-power bit flipped: alarm, no error raised');

  await page.locator('#ex6-flip-version').click();
  await expect(page.locator('#ex6-verdict')).toHaveAttribute('data-verdict', 'alarm');
  await scanAt('exhibit 6 with the version byte flipped instead');

  await page.locator('#ex6-reset').click();
  await expect(page.locator('#ex6-verdict')).toHaveAttribute('data-verdict', 'none');
  const ex6Details = page.locator('#panel-metadata details').first();
  await ex6Details.locator('summary').click();
  await expect(ex6Details).toHaveAttribute('open', '');
  await scanAt('exhibit 6 reset, with the no-error-to-show disclosure open');

  // ── The scoping card, and the page end ──────────────────────────────────
  const scopeDetails = page.locator('#scope details').first();
  await scopeDetails.locator('summary').click();
  await expect(scopeDetails).toHaveAttribute('open', '');
  await scanAt('the scoping card with its sources disclosure open');

  // ── Keyboard focus rings, on two different control shapes ───────────────
  await page.locator('#ex6-flip').focus();
  await expect(page.locator('#ex6-flip')).toBeFocused();
  await scanAt('a primary button focused');

  await page.locator('#tab-schedule').focus();
  await expect(page.locator('#tab-schedule')).toBeFocused();
  await scanAt('a tab button focused');

  // ── Back to exhibit 1 with every panel now rendered ─────────────────────
  // The last scan is the heaviest DOM this page can hold: six panels built,
  // five of them hidden. A `[hidden]` that a class rule has overridden paints
  // here and nowhere else.
  await openTab(page, /One phone, one day/, '#panel-schedule');
  for (const id of ['chain', 'matching', 'relay', 'linkage', 'metadata']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).not.toBeEmpty();
  }
  await scanAt('exhibit 1 again, with all six panels rendered and five hidden');
}
