import { expect, test, type Page } from '@playwright/test';
import { boot } from './gate';

/**
 * The claims suite: what this lab's page SAYS, as opposed to what it is shaped
 * like. Master template 4.1b, and 4.1d's negative claim at the bottom.
 *
 * Structure lives in `boot()` in gate.ts; copy lives here. That split exists
 * because a lab once changed one default sentence, `boot()` asserted the old
 * one, and the step that went red was called "Accessibility gate" — a report
 * naming the wrong subject while the live site served the wrong claim for
 * three days.
 *
 * The rule that makes these worth anything: COMPARE TWO VALUES THE PAGE
 * PRINTED, or RE-DERIVE the claim independently. A test that reruns the
 * source's own expression agrees with the source's own bugs — so the key
 * schedule tests below recompute every identifier from the key on screen using
 * the test's OWN WebCrypto calls, by a different route than `src/crypto` takes.
 */

// ── An independent implementation of the key schedule, for re-derivation ────
//
// Deliberately not importing anything from `src/`. HKDF is written out from
// RFC 5869, the padded block is assembled by hand with arithmetic rather than
// a DataView, and the AES block comes from AES-CBC rather than the AES-CTR
// route `src/crypto/primitives.ts` uses. If this and the page agree, two
// different implementations of the specification agree.

/**
 * `Uint8Array<ArrayBuffer>`, spelled out. These helpers run in the Node test
 * process, where a bare `Uint8Array` is `ArrayBufferLike` and so not a
 * `BufferSource` WebCrypto will accept.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const alloc = (n: number): Bytes => new Uint8Array(new ArrayBuffer(n));

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const unhex = (s: string): Bytes => {
  const pairs = s.match(/../g) ?? [];
  const out = alloc(pairs.length);
  pairs.forEach((p, i) => (out[i] = parseInt(p, 16)));
  return out;
};

async function hmac(key: Bytes, msg: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
}

/** HKDF-SHA-256 to 16 bytes with an absent salt — RFC 5869 2.2 and 2.3. */
async function hkdf16(ikm: Bytes, info: string): Promise<Bytes> {
  const prk = await hmac(alloc(32), ikm);
  const infoBytes = new TextEncoder().encode(info);
  const input = alloc(infoBytes.length + 1);
  input.set(infoBytes, 0);
  input[infoBytes.length] = 0x01;
  return (await hmac(prk, input)).subarray(0, 16) as Bytes;
}

/** PaddedData, assembled by arithmetic. Little-endian by construction. */
function padded(interval: number): Bytes {
  const b = alloc(16);
  b.set(new TextEncoder().encode('EN-RPI'), 0);
  b[12] = interval & 0xff;
  b[13] = (interval >>> 8) & 0xff;
  b[14] = (interval >>> 16) & 0xff;
  b[15] = (interval >>> 24) & 0xff;
  return b;
}

/** One AES-128 block, via CBC with a zero IV — not the page's CTR route. */
async function aesBlock(key: Bytes, block: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: alloc(16) }, k, block);
  return new Uint8Array(out).subarray(0, 16) as Bytes;
}

async function rpi(tek: Bytes, interval: number): Promise<string> {
  return hex(await aesBlock(await hkdf16(tek, 'EN-RPIK'), padded(interval)));
}

/** Read the full hex a cell carries for assistive technology. */
async function fullValues(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-full') ?? ''),
  );
}

async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

// ── 1. The headline claim, recomputed from what is on screen ────────────────

test.describe('exhibit 1 — the key schedule on screen is the specification’s', () => {
  test('every identifier shown is re-derivable from the key shown, by an independent route', async ({
    page,
  }) => {
    await boot(page, 'dark');
    const tekHex = await page.locator('#ex1-tek').inputValue();
    const tek = unhex(tekHex);
    expect(tek).toHaveLength(16);

    // The day strip carries all 144. Re-derive each one here and compare.
    const shown = await fullValues(page, '#panel-schedule .id-chip');
    expect(shown).toHaveLength(144);
    const intervals = await page
      .locator('#panel-schedule .id-chip')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-interval'))));

    for (let k = 0; k < shown.length; k++) {
      expect(shown[k], `identifier at interval ${intervals[k]}`).toBe(
        await rpi(tek, intervals[k] as number),
      );
    }
  });

  test('the derived keys printed on screen are HKDF of the key on screen', async ({ page }) => {
    await boot(page, 'dark');
    const tek = unhex(await page.locator('#ex1-tek').inputValue());
    const blocks = await fullValues(page, '#panel-schedule .hex-block');
    // The page prints TEK, PRK, RPIK, AEMK in that order in its first table.
    expect(blocks[0]).toBe(hex(tek));
    expect(blocks[1]).toBe(hex(await hmac(alloc(32), tek)));
    expect(blocks[2]).toBe(hex(await hkdf16(tek, 'EN-RPIK')));
    expect(blocks[3]).toBe(hex(await hkdf16(tek, 'EN-AEMK')));
  });

  test('the byte grid shows the interval LITTLE-endian, and says so', async ({ page }) => {
    await boot(page, 'dark');
    const interval = Number(await page.locator('#ex1-interval').inputValue());
    const cells = await page
      .locator('#panel-schedule .byte-cell')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(cells).toHaveLength(16);
    expect(cells.join('')).toBe(hex(padded(interval)));

    // The prose names the same four bytes the grid paints, so a wrong claim in
    // one and a right value in the other cannot both survive.
    const claimed = await page.locator('[data-interval-le]').getAttribute('data-interval-le');
    expect(claimed).toBe(hex(padded(interval).subarray(12)));
    expect(cells.slice(12).join('')).toBe(claimed);
  });

  test('the strip holds exactly one day: 144 identifiers, all distinct', async ({ page }) => {
    await boot(page, 'dark');
    const shown = await fullValues(page, '#panel-schedule .id-chip');
    expect(shown).toHaveLength(144);
    expect(new Set(shown).size).toBe(144);
  });

  test('a fresh key really changes every identifier', async ({ page }) => {
    await boot(page, 'dark');
    const before = await fullValues(page, '#panel-schedule .id-chip');
    await page.locator('#ex1-reroll').click();
    await expect(page.locator('#ex1-vector')).toHaveAttribute('aria-pressed', 'false');
    const after = await fullValues(page, '#panel-schedule .id-chip');
    expect(after).toHaveLength(144);
    expect(after.filter((v) => before.includes(v))).toEqual([]);
    // And the new ones are still the schedule of the new key.
    const tek = unhex(await page.locator('#ex1-tek').inputValue());
    expect(after[0]).toBe(await rpi(tek, Number(await page.locator('#ex1-interval').inputValue())));
  });

  test('a malformed key is REFUSED and the page names the cause', async ({ page }) => {
    await boot(page, 'dark');
    await page.locator('#ex1-tek').fill('zzzz');
    await page.locator('#ex1-tek').blur();
    await expect(page.locator('#ex1-tek')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#ex1-tek-hint')).toContainText('Refused');
    await expect(page.locator('#ex1-tek-hint')).toContainText('not 0-9');
  });

  test('a key of the wrong LENGTH is refused, naming the length rule', async ({ page }) => {
    await boot(page, 'dark');
    await page.locator('#ex1-tek').fill('00112233');
    await page.locator('#ex1-tek').blur();
    await expect(page.locator('#ex1-tek-hint')).toContainText('16 bytes');
  });
});

// ── 2. The hash chain ───────────────────────────────────────────────────────

test.describe('exhibit 2 — the chain claim', () => {
  test('day 1’s seed is SHA-256 of day 0’s, re-derived here', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Several days/, '#panel-chain');
    const seed0 = unhex(await page.locator('#ex2-seed').inputValue());
    expect(seed0).toHaveLength(32);
    const expected = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', seed0)));
    const claimed = await page.locator('[data-chain-day1]').getAttribute('data-chain-day1');
    expect(claimed).toBe(expected);
    // And the value in the chain table is the same one.
    const rows = await fullValues(page, '#panel-chain tbody .hex');
    expect(rows[1]).toBe(expected);
  });

  test('the day holds 96 identifiers, which is (24*60)/15', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Several days/, '#panel-chain');
    // The page states n and L in prose; the count must agree with the arithmetic.
    await expect(page.locator('#panel-chain')).toContainText('(24 × 60) / 15 = 96');
    await expect(page.locator('#panel-chain')).toContainText('96 × 16 = 1536 bytes');
  });

  test('the broadcast order is a permutation of the generated identifiers', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Several days/, '#panel-chain');

    const read = async (attr: string): Promise<string[]> =>
      ((await page.locator(`[data-${attr}]`).getAttribute(`data-${attr}`)) ?? '').split(',');

    const generated = await read('generation-order');
    const broadcast = await read('broadcast-order');
    expect(generated).toHaveLength(96);
    expect(broadcast).toHaveLength(96);

    // Same multiset, different sequence. Both halves matter: the first says
    // nothing was invented or dropped, the second that the order really is
    // shuffled rather than merely described as shuffled.
    expect([...broadcast].sort()).toEqual([...generated].sort());
    expect(broadcast.join()).not.toBe(generated.join());

    // A reshuffle gives another permutation of the SAME identifiers.
    await page.locator('#ex2-reshuffle').click();
    const again = await read('broadcast-order');
    expect([...again].sort()).toEqual([...generated].sort());
    expect(again.join()).not.toBe(broadcast.join());

    // And the eight rows rendered are the first eight of the order published.
    const rendered = await page
      .locator('#panel-chain table')
      .last()
      .locator('tbody [data-full]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-full') ?? ''));
    expect(rendered).toEqual(again.slice(0, 8));
  });

  test('the page states that it chose the primitives the white paper left open', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Several days/, '#panel-chain');
    const panel = page.locator('#panel-chain');
    await expect(panel).toContainText('THIS LAB CHOSE THE PRIMITIVES');
    await expect(panel).toContainText('fixes neither');
    await expect(panel).toContainText('match no deployed app');
  });
});

// ── 3. Matching, the server panel, and retirement ───────────────────────────

test.describe('exhibit 3 — the matching claims', () => {
  test('MATCHED appears on exactly the rows whose identifier a published key derives', async ({
    page,
  }) => {
    await boot(page, 'dark');
    await openTab(page, /Hearing and matching/, '#panel-matching');
    await page.locator('#ex3-report').click();
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'matched');

    // The server published a TEK. Re-derive its whole day here, then check the
    // page's MATCHED labels against our own computation rather than its.
    const publishedKeys = await fullValues(page, '.server-knows .hex');
    expect(publishedKeys.length).toBeGreaterThan(0);
    const derived = new Set<string>();
    for (const keyHex of publishedKeys) {
      const tek = unhex(keyHex);
      for (let k = 0; k < 144; k++) derived.add(await rpi(tek, k));
    }

    const rows = await page.locator('#panel-matching tr[data-log-row]').evaluateAll((els) =>
      els.map((e) => ({
        matched: e.getAttribute('data-matched') === 'true',
        id: e.querySelector('[data-full]')?.getAttribute('data-full') ?? '',
        heardAt: Number(e.querySelector('th')?.textContent ?? '-1'),
      })),
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      // +/-2 hours is 12 intervals; day 0 starts at interval 0 here.
      const ours = derived.has(row.id);
      expect(row.matched, `row heard at slot ${row.heardAt} (${row.id})`).toBe(ours);
    }
    expect(rows.some((r) => r.matched)).toBe(true);
  });

  test('the server panel holds keys and NO log entries', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Hearing and matching/, '#panel-matching');
    await page.locator('#ex3-report').click();
    const panel = page.locator('.server-panel');
    await expect(panel).toBeVisible();
    // It lists published values...
    const items = Number(await panel.locator('.server-knows').getAttribute('data-server-items'));
    expect(items).toBeGreaterThan(0);
    // ...and zero log rows, asserted as a count rather than as a sentence.
    await expect(panel.locator('.server-not')).toHaveAttribute('data-server-log-rows', '0');
    await expect(panel.locator('[data-log-row]')).toHaveCount(0);
    await expect(panel).toContainText('does not hold');
  });

  test('editing the timeline RETIRES the verdict and the page says it did', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Hearing and matching/, '#panel-matching');
    await page.locator('#ex3-report').click();
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'matched');

    await page.locator('#tl-B-1').selectOption('nowhere');
    await expect(page.locator('#ex3-report')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'none');
    await expect(page.locator('#ex3-verdict-B')).toContainText('No report has been published');
    await expect(page.locator('.tag-matched')).toHaveCount(0);
  });

  test('changing the DESIGN retires the verdict too', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Hearing and matching/, '#panel-matching');
    await page.locator('#ex3-report').click();
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'matched');
    await page.locator('#ex3-design').selectOption('dp3t-lowcost');
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'none');
  });

  test('NO-OP GUARD: re-selecting the same place does not retire a fresh verdict', async ({
    page,
  }) => {
    await boot(page, 'dark');
    await openTab(page, /Hearing and matching/, '#panel-matching');
    await page.locator('#ex3-report').click();
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'matched');

    // Re-select the value the control already holds. Playwright fires `change`
    // whether or not the value moved — which is the useful case, because it
    // means this test exercises the guard in the handler rather than a quirk
    // of event dispatch. Nothing about the world changed, so a fresh verdict
    // must survive.
    const current = await page.locator('#tl-B-1').inputValue();
    await page.locator('#tl-B-1').selectOption(current);
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'matched');
    await expect(page.locator('#ex3-report')).toHaveAttribute('aria-pressed', 'true');

    // The same guard on the two other controls that can retire a verdict.
    await page.locator('#ex3-design').selectOption('gaen');
    await page.locator('#ex3-reporter').selectOption('A');
    await expect(page.locator('#ex3-verdict-B')).toHaveAttribute('data-verdict', 'matched');
  });

  test('the page names the time rule it is actually enforcing', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Hearing and matching/, '#panel-matching');
    // Apple/Google: the specification's own +/-2 hours.
    await expect(page.locator('#panel-matching')).toContainText('±2 hours');
    await page.locator('#ex3-design').selectOption('dp3t-unlinkable');
    await expect(page.locator('#panel-matching')).toContainText('same epoch');
    await expect(page.locator('#panel-matching')).not.toContainText('±2 hours');
  });
});

// ── 4. Linkage ──────────────────────────────────────────────────────────────

test.describe('exhibit 5 — the linkage claims', () => {
  test('before any report, no design groups more than one sighting', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Linkage/, '#panel-linkage');
    const before = await page
      .locator('tr[data-design]')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-largest-before'))));
    expect(before).toHaveLength(3);
    for (const n of before) expect(n).toBe(1);
  });

  test('after the report, the linked rows EQUAL the reporter’s rows in the world model', async ({
    page,
  }) => {
    await boot(page, 'dark');
    await openTab(page, /Linkage/, '#panel-linkage');
    await page.locator('#ex5-report').click();
    await expect(page.locator('#ex5-verdict')).toHaveAttribute('data-reported', 'true');

    // `data-exact` is written by comparing the observer's grouping against the
    // world's presence record. The two chained designs must both reach it.
    for (const design of ['gaen', 'dp3t-lowcost']) {
      await expect(page.locator(`tr[data-design="${design}"]`)).toHaveAttribute('data-exact', 'true');
    }
  });

  test('Apple/Google links ONE day where DP-3T low-cost links every later one', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Linkage/, '#panel-linkage');
    await page.locator('#ex5-day1').click();
    await page.locator('#ex5-report').click();

    const gaen = await page.locator('tr[data-design="gaen"]').getAttribute('data-linked-days');
    const low = await page.locator('tr[data-design="dp3t-lowcost"]').getAttribute('data-linked-days');
    // One published value each, anchored at day 1, over a two-day scenario.
    expect(gaen).toBe('1');
    expect(low).toBe('1');
    // With day 0 published instead, the chain reaches day 1 as well while
    // Apple/Google needs a second key to get there.
    await page.locator('#ex5-day0').click();
    const lowFrom0 = await page
      .locator('tr[data-design="dp3t-lowcost"]')
      .getAttribute('data-linked-days');
    expect(lowFrom0).toBe('0,1');
  });

  test('the unlinkable design recognises sightings and still groups none', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Linkage/, '#panel-linkage');
    await page.locator('#ex5-report').click();
    const row = page.locator('tr[data-design="dp3t-unlinkable"]');
    await expect(row).toHaveAttribute('data-largest-after', '1');
    await expect(row).toContainText('RECOGNISED, NOT GROUPED');
  });

  test('"LINKED" is a text label, not a colour', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Linkage/, '#panel-linkage');
    await page.locator('#ex5-report').click();
    await expect(page.locator('.tag-linked').first()).toContainText('LINKED');
  });
});

// ── 5. Malleable metadata ───────────────────────────────────────────────────

test.describe('exhibit 6 — the metadata claim', () => {
  test('a flipped ciphertext bit decrypts to a different transmit power, with no error', async ({
    page,
  }) => {
    await boot(page, 'dark');
    await openTab(page, /Malleable metadata/, '#panel-metadata');
    const before = await page.locator('[data-md-received]').getAttribute('data-md-received');
    const plain = await page.locator('[data-md-plain]').getAttribute('data-md-plain');
    expect(before).toBe(plain);

    await page.locator('#ex6-flip').click();
    await expect(page.locator('#ex6-verdict')).toHaveAttribute('data-verdict', 'alarm');
    const after = await page.locator('[data-md-received]').getAttribute('data-md-received');

    // Exactly one bit of the plaintext moved, and it is bit 0x10 of byte 1.
    expect(after).not.toBe(plain);
    const a = unhex(plain ?? '');
    const b = unhex(after ?? '');
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe((a[1] as number) ^ 0x10);
    expect(b[2]).toBe(a[2]);
    expect(b[3]).toBe(a[3]);

    // And the page reports the reading a receiver would act on, in dBm,
    // computed from byte 1 as a signed value.
    const signed = (v: number): number => (v > 127 ? v - 256 : v);
    await expect(page.locator('#ex6-verdict')).toContainText(`${signed(b[1] as number)} dBm`);
    await expect(page.locator('#ex6-verdict')).toContainText(`${signed(a[1] as number)} dBm`);
  });

  test('the page says there is no error to show rather than inventing one', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Malleable metadata/, '#panel-metadata');
    await page.locator('#ex6-flip').click();
    const panel = page.locator('#panel-metadata');
    await expect(panel).toContainText('no check anywhere failed');
    await expect(panel).toContainText('isn’t authenticated');
    // No verdict anywhere claims a rejection happened.
    await expect(panel.locator('[data-verdict="refused"]')).toHaveCount(0);
  });

  test('sending it untouched returns to the honest reading', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Malleable metadata/, '#panel-metadata');
    await page.locator('#ex6-flip').click();
    await expect(page.locator('#ex6-verdict')).toHaveAttribute('data-verdict', 'alarm');
    await page.locator('#ex6-reset').click();
    await expect(page.locator('#ex6-verdict')).toHaveAttribute('data-verdict', 'none');
    const plain = await page.locator('[data-md-plain]').getAttribute('data-md-plain');
    expect(await page.locator('[data-md-received]').getAttribute('data-md-received')).toBe(plain);
  });
});

// ── 6. The [hidden] probe ───────────────────────────────────────────────────

test('[hidden] panels are really not painted', async ({ page }) => {
  await boot(page, 'dark');
  // The cascade trap: a class rule that sets `display` outranks the UA
  // `[hidden]` rule, so an element paints while the code believes it is hidden.
  // Visit every panel so all six are in the DOM, then measure.
  for (const [name, id] of [
    [/Several days/, 'chain'],
    [/Hearing and matching/, 'matching'],
    [/Relay/, 'relay'],
    [/Linkage/, 'linkage'],
    [/Malleable metadata/, 'metadata'],
    [/One phone, one day/, 'schedule'],
  ] as const) {
    await openTab(page, name as RegExp, `#panel-${id}`);
  }
  const painted = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[hidden]'))
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => `${el.tagName.toLowerCase()}#${el.id}`),
  );
  expect(painted).toEqual([]);
  // And the five that should be hidden are, with content in them.
  for (const id of ['chain', 'matching', 'relay', 'linkage', 'metadata']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).not.toBeEmpty();
  }
});

// ── 7. The NEGATIVE CLAIM (master template 4.1d) ────────────────────────────

/**
 * The claim: "A match says that an identifier this phone heard was derived from
 * a reported key. It says nothing about whether the two people were near each
 * other: in this scenario they never were, and the match is the same."
 *
 * Three assertions, as 4.1d specifies:
 *   1. REACH THE FIXTURE through the UI.
 *   2. EVERYTHING THE PHONE CHECKS PASSES — asserted against the rendered
 *      verdicts, not against a flag this test sets.
 *   3. THE LIMITATION IS ON SCREEN in that state, visible, not in the README
 *      and not behind a disclosure.
 *
 * Plus two BITE tests, which are what stop this being decorative: put the two
 * phones genuinely together and the "never near each other" clause must
 * disappear, and the clause must be driven by the WORLD MODEL rather than by
 * the matcher's own answer.
 */
const NEGATIVE_CLAIM =
  'A match says that an identifier this phone heard was derived from a reported key. ' +
  'It says nothing about whether the two people were near each other: in this scenario ' +
  'they never were, and the match is the same.';

test.describe('the negative claim', () => {
  test('1. the fixture is reachable, and it is exhibit 4 with the relay live', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Relay/, '#panel-relay');
    await expect(page.locator('#ex4-relay')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ex4-live')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-exposed', 'true');
    await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-colocated', 'false');
  });

  test('2. every check the phone performs reports success in that state', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Relay/, '#panel-relay');

    // Read the rendered check table rather than trusting a flag. Every row must
    // say PASSES; one FAILS means the fixture demonstrates the mechanism
    // working, not its limit.
    const results = await page
      .locator('[data-phone-checks] tbody tr')
      .evaluateAll((els) => els.map((e) => e.querySelector('.tag')?.textContent ?? ''));
    expect(results.length).toBeGreaterThan(3);
    expect(results.every((r) => r === 'PASSES')).toBe(true);
    await expect(page.locator('[data-phone-checks]')).toHaveAttribute(
      'data-phone-checks',
      'all-pass',
    );
    await expect(page.locator('[data-phone-checks] .tag-nomatch')).toHaveCount(0);

    // And the exposure verdict itself reads as a match.
    await expect(page.locator('#ex4-verdict')).toContainText('EXPOSURE MATCHED');
  });

  test('3. the limitation is visible on screen in that state, not behind a disclosure', async ({
    page,
  }) => {
    await boot(page, 'dark');
    await openTab(page, /Relay/, '#panel-relay');

    const verdict = page.locator('#ex4-verdict');
    await expect(verdict).toContainText('EXPOSURE MATCHED — AND THE TWO PHONES WERE NEVER NEAR EACH OTHER');
    await expect(verdict).toContainText(NEGATIVE_CLAIM);
    await expect(verdict).toBeVisible();

    // The world model's co-location record is on screen in the same state.
    await expect(verdict).toContainText('at the same place in 0 of the timeline’s 30 slots');

    // And it is not hidden inside a <details> the reader has to open.
    expect(
      await verdict.evaluate((el) => el.closest('details') !== null),
      'the negative claim must not be behind a disclosure',
    ).toBe(false);

    // The scoping card carries the same sentence, verbatim.
    await expect(page.locator('[data-negative-claim]')).toContainText(NEGATIVE_CLAIM);
  });

  test('BITE: with the two phones genuinely together, the clause is GONE', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Relay/, '#panel-relay');
    await expect(page.locator('#ex4-verdict')).toContainText('NEVER NEAR EACH OTHER');

    await page.locator('#ex4-colocate').click();
    await expect(page.locator('#ex4-verdict')).toHaveAttribute('data-colocated', 'true');
    // Still a match — and that is the point, the phone cannot tell them apart.
    await expect(page.locator('#ex4-verdict')).toContainText('EXPOSURE MATCHED');
    await expect(page.locator('#ex4-verdict')).toContainText('THEY REALLY WERE TOGETHER');
    // But the claim is withdrawn.
    await expect(page.locator('#ex4-verdict')).not.toContainText('NEVER NEAR EACH OTHER');
    await expect(page.locator('#ex4-verdict')).not.toContainText(NEGATIVE_CLAIM);
  });

  test('BITE: the clause tracks the WORLD, not the matcher’s answer', async ({ page }) => {
    await boot(page, 'dark');
    await openTab(page, /Relay/, '#panel-relay');

    // Three reachable states, read as `exposed/colocated`. Together they pin
    // the co-location claim to the world model, because no function of
    // `exposed` alone can produce this table:
    //
    //   relay live, apart     -> true  / false
    //   relay off,  apart     -> false / false
    //   relay off,  together  -> true  / true
    //
    // `colocated == exposed` is refused by row 1. `colocated == !exposed` is
    // refused by row 2. Mutation 11 is exactly one of those two substitutions.
    const read = async (): Promise<string> => {
      const v = page.locator('#ex4-verdict');
      return `${await v.getAttribute('data-exposed')}/${await v.getAttribute('data-colocated')}`;
    };

    expect(await read()).toBe('true/false');

    await page.locator('#ex4-relay').click();
    await expect(page.locator('#ex4-relay')).toHaveAttribute('aria-pressed', 'false');
    expect(await read()).toBe('false/false');

    // With the relay off and the two phones in one room, B hears A directly —
    // no attacker involved. So this row is a genuine encounter, and it is the
    // one that separates `colocated` from `!exposed`.
    await page.locator('#ex4-colocate').click();
    await expect(page.locator('#ex4-colocate')).toHaveAttribute('aria-pressed', 'true');
    expect(await read()).toBe('true/true');
    await expect(page.locator('#ex4-verdict')).toContainText('THEY REALLY WERE TOGETHER');
  });

  test('a delayed replay is REFUSED, and the page names the time rule as the reason', async ({
    page,
  }) => {
    await boot(page, 'dark');
    await openTab(page, /Relay/, '#panel-relay');
    await page.locator('#ex4-delay').click();
    const verdict = page.locator('#ex4-verdict');
    await expect(verdict).toHaveAttribute('data-verdict', 'refused');
    await expect(verdict).toContainText('THE REPLAY WAS TOO LATE');
    await expect(verdict).toContainText('±2 hours');
    // The claim does not appear in a state where nothing matched.
    await expect(verdict).not.toContainText(NEGATIVE_CLAIM);
  });
});

// ── 8. Honest scoping ───────────────────────────────────────────────────────

test.describe('scoping', () => {
  test('the page says it is a teaching demo with simulated phones', async ({ page }) => {
    await boot(page, 'dark');
    const scope = page.locator('#scope');
    await expect(scope).toContainText('teaching demo, not production software');
    await expect(scope).toContainText('phones are simulated');
    await expect(scope).toContainText('no Bluetooth, no radio and no network');
  });

  test('the page disclaims any assessment of a national app', async ({ page }) => {
    await boot(page, 'dark');
    await expect(page.locator('#scope')).toContainText(
      'Any claim about a particular country’s app',
    );
  });

  test('the page names what it does not build', async ({ page }) => {
    await boot(page, 'dark');
    const scope = page.locator('#scope');
    for (const phrase of [
      'Bluetooth itself',
      'distance estimation',
      'Risk scoring',
      'upload-authorisation',
      'Cuckoo filter',
      'hybrid design',
    ]) {
      await expect(scope).toContainText(phrase);
    }
  });

  test('the page does not claim the cryptography is broken', async ({ page }) => {
    await boot(page, 'dark');
    await expect(page.locator('#scope')).toContainText('It is not');
    await expect(page.locator('#scope')).toContainText(
      'limits of what the cryptography was ever able to promise',
    );
  });
});
