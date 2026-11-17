import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches. The arrival state, as a reader
 * gets it: exhibit 1 active with a key schedule already computed, its 16-cell
 * padded block and its 144 identifiers painted, the other five panels hidden
 * and UNRENDERED, every disclosure shut. Then the shared skip link focused; a
 * freshly generated key and a malformed one and a short one, each refused
 * behind an `aria-invalid` boundary; the hash chain on a random seed, on day 2,
 * reshuffled, and refusing a short seed; the timeline driven to a match, to a
 * verdict retired by an edit, to a phone that hears nothing, and through all
 * three designs; the relay's alarm verdict — which is this lab's negative-claim
 * fixture — its refusal of a delayed replay, its bite fixture where the two
 * phones really are together, and its relay switched off; the linkage table
 * before a report and after one, publishing a day and then the whole window;
 * the metadata panel untouched, with a transmit-power bit flipped, and with the
 * version byte flipped; the scoping card's sources; two focus rings; three
 * hover states; and finally exhibit 1 again with all six panels in the DOM and
 * five of them hidden. Every one of those states is scanned, at desktop and
 * phone width.
 *
 * See `gate.ts` for why nothing is injected into the page (the old fleet gate's
 * `addStyleTag` motion kill bypassed the stylesheet's own reduced-motion block,
 * so the rendering reduced-motion readers get was never the one scanned), why
 * no panel is revealed from script (that gate stripped every `[hidden]` and
 * opened every `<details>` by JS before its only scan), why the lab's defaults
 * are asserted rather than assumed, and why `violations` is not the whole
 * oracle.
 */

const theme = 'dark' as const;

test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await boot(page, theme);
  await driveAllStates(page, theme);
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});

test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await page.setViewportSize(NARROW);
  await boot(page, theme);
  await driveAllStates(page, `${theme} @380px`);
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});
