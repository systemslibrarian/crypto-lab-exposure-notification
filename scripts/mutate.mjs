#!/usr/bin/env node
/**
 * The mutation runner. `npm run mutate`.
 *
 * Master template 4.1c: a green suite is not evidence until you have watched it
 * fail. A sentence describing a mutation cannot be replayed and a paragraph
 * describing a run is the author's side of the claim rather than the run's — so
 * every mutation here is a concrete patch in `mutations.mjs` and every result
 * below is written by the thing that ran it.
 *
 * A KILL requires all four of 4.1c's rules, and this script enforces all four:
 *
 *   1. THE OWNING TEST PASSED UNMUTATED in this same run. Checked first, before
 *      anything is patched. A test that was already failing proves nothing.
 *   2. THE PATCH ACTUALLY CHANGED THE FILE. The anchor must occur exactly once
 *      and the bytes must differ afterwards, or the mutation is REFUSED rather
 *      than recorded as a survivor.
 *   3. THE RUN SERVED THE MUTATED CODE. Two ways, both applied: `tsc` must
 *      still succeed (a patch that does not compile is DOES-NOT-BUILD and is
 *      never a kill — the suite would run against the previous bundle), and the
 *      red run's output is CLASSIFIED, so a build error, a crashed runner or a
 *      module that failed to load is not mistaken for a caught mutation.
 *   4. The file is restored and the restoration verified byte for byte.
 *
 * Nothing is written back into the ledger. The records are enforced rather than
 * archived: this script re-derives them on demand, and a stale copy of an
 * answer the runner can recompute is a second place for it to go wrong.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { MUTATIONS } from './mutations.mjs'

const only = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number)
const selected = only.length > 0 ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

/** Run a command, returning its combined output and exit status. */
function run(cmd, args, env) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 600_000,
    })
    return { ok: true, out: stdout }
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

const typecheck = () => run('npx', ['tsc', '--noEmit'])

/**
 * Run whichever suite owns a mutation.
 *
 * A mutation in `src/ui/` is rendered rather than returned, so its oracle is a
 * browser test. The runner dispatches on the owner's path: `e2e/` goes to
 * Playwright, everything else to Vitest. Playwright's own webServer command
 * builds before serving, so a UI mutation that broke the build could not pass
 * green against a stale bundle even if `tsc` had let it through.
 */
function suite(file) {
  if (file.startsWith('e2e/')) {
    // CI=1 so `reuseExistingServer` is off: a preview left running from an
    // earlier, UNMUTATED build would otherwise answer, and the mutation would
    // read as uncaught. forbidOnly and one retry come with it; a retry that
    // passes is still red overall, so a kill is not weakened.
    return run('npx', ['playwright', 'test', file, '--project=claims', '--reporter=list'], { CI: '1' })
  }
  return run('npx', ['vitest', 'run', file, '--reporter=default'])
}

/**
 * Classify a failing run, so a red result is only ever credited to the
 * mutation when it is the SUITE that went red.
 *
 * `crypto-lab-hidden-bit`'s approach: refuse any red run whose output looks
 * like a build error, a runner that never started, or a module that failed to
 * load, rather than trusting redness on its own.
 */
function classify(out) {
  if (/Cannot find module|Failed to resolve import|ERR_MODULE_NOT_FOUND/.test(out)) {
    return 'MODULE-NOT-LOADED'
  }
  if (/Transform failed|esbuild|SyntaxError|Parse failure/.test(out)) return 'DOES-NOT-BUILD'
  if (/No test files found|no tests found/i.test(out)) return 'NO-TESTS-RAN'
  if (/was not able to start|ECONNREFUSED|Exit code: 2/.test(out)) return 'SERVER-NEVER-STARTED'
  const vit = out.match(/Tests\s+(\d+) failed/)
  if (vit) return `SUITE-RED (${vit[1]} failing)`
  const pw = out.match(/(\d+) failed/)
  if (pw) return `SUITE-RED (${pw[1]} failing)`
  if (/\bfailed\b/i.test(out)) return 'SUITE-RED'
  return 'UNCLASSIFIED'
}

/** How many tests ran, so a step that ran zero cannot read as a pass (4.1e). */
function countTests(out) {
  const vit = out.match(/Tests\s+(\d+) passed/)
  if (vit) return Number(vit[1])
  const pw = out.match(/(\d+) passed/)
  return pw ? Number(pw[1]) : 0
}

console.log('Mutation run —', new Date().toISOString())
console.log('='.repeat(78))

// ── Rule 1, for the whole run: the suite is green before anything is touched ──
const baseline = run('npx', ['vitest', 'run', '--reporter=default'])
const baselineCount = countTests(baseline.out)
if (!baseline.ok || baselineCount === 0) {
  console.error('REFUSING TO RUN: the unmutated suite is not green.')
  console.error(`  exit ok: ${baseline.ok}, tests passed: ${baselineCount}`)
  console.error(baseline.out.slice(-2000))
  process.exit(2)
}
console.log(`Baseline: ${baselineCount} tests passing, unmutated.\n`)

const results = []

for (const m of selected) {
  const original = readFileSync(m.file, 'utf8')
  const label = `[${String(m.id).padStart(2)}] ${m.what}`

  // Rule 1, per mutation: the OWNING test file passes unmutated.
  const ownerBefore = suite(m.expect)
  const ownerCount = countTests(ownerBefore.out)
  if (!ownerBefore.ok || ownerCount === 0) {
    results.push({ ...m, verdict: 'OWNER-NOT-GREEN', detail: `${m.expect} did not pass unmutated` })
    console.log(`${label}\n     OWNER-NOT-GREEN — ${m.expect} is not green unmutated; nothing patched.\n`)
    continue
  }

  // Rule 2: the anchor occurs exactly once, and the patch really changes bytes.
  const occurrences = original.split(m.anchor).length - 1
  if (occurrences !== 1) {
    results.push({ ...m, verdict: 'ANCHOR-NOT-UNIQUE', detail: `anchor found ${occurrences} times` })
    console.log(`${label}\n     REFUSED — anchor occurs ${occurrences} times in ${m.file}, must be exactly 1.\n`)
    continue
  }
  const mutated = original.replace(m.anchor, m.replacement)
  if (mutated === original) {
    results.push({ ...m, verdict: 'PATCH-INERT', detail: 'replacement equals the anchor' })
    console.log(`${label}\n     REFUSED — the patch did not change the file.\n`)
    continue
  }

  writeFileSync(m.file, mutated)
  try {
    const before = sha(original)
    const after = sha(mutated)

    // Rule 3a: a patch that does not compile is never a kill.
    const tc = typecheck()
    if (!tc.ok) {
      results.push({
        ...m,
        verdict: 'DOES-NOT-BUILD',
        detail: tc.out.split('\n').find((l) => l.includes('error')) ?? 'tsc failed',
      })
      console.log(`${label}\n     DOES-NOT-BUILD — tsc rejected the patch, so no suite result can be trusted.`)
      console.log(`     ${(tc.out.split('\n').find((l) => l.includes('error')) ?? '').trim()}\n`)
      continue
    }

    // The red run.
    const owner = suite(m.expect)
    const classification = owner.ok ? 'GREEN' : classify(owner.out)
    const killed = !owner.ok && classification.startsWith('SUITE-RED')

    // Which named tests went red. Written by the run, never typed.
    const failing = [...owner.out.matchAll(/^\s*(?:×|✗|✘|\d+\)|FAIL)\s+(.+?)(?:\s+\d+(?:\.\d+)?m?s)?$/gm)]
      .map((x) => x[1].trim())
      .filter((x) => x.length > 0)
      .slice(0, 4)

    results.push({
      ...m,
      verdict: killed ? 'KILLED' : classification === 'GREEN' ? 'SURVIVED' : classification,
      ownerPassedUnmutated: ownerCount,
      fileBefore: before,
      fileAfter: after,
      observed: failing,
    })

    console.log(label)
    console.log(`     file      ${m.file}  ${before} -> ${after}  (changed)`)
    console.log(`     builds    yes`)
    console.log(`     owner     ${m.expect} (${ownerCount} tests green unmutated)`)
    console.log(`     verdict   ${killed ? 'KILLED' : classification === 'GREEN' ? '*** SURVIVED ***' : classification}`)
    for (const f of failing) console.log(`     observed  ${f}`)
    console.log()
  } finally {
    // Rule 4: restore, and verify the restoration.
    writeFileSync(m.file, original)
    const restored = readFileSync(m.file, 'utf8')
    if (restored !== original) {
      console.error(`FATAL: ${m.file} was not restored. Fix it by hand before committing.`)
      process.exit(3)
    }
  }
}

console.log('='.repeat(78))
const killed = results.filter((r) => r.verdict === 'KILLED')
const survived = results.filter((r) => r.verdict !== 'KILLED')
console.log(`${killed.length} killed, ${survived.length} not killed, of ${results.length} attempted.`)
for (const r of survived) console.log(`  NOT KILLED  [${r.id}] ${r.what} — ${r.verdict}`)

// A surviving mutation is reported, not explained away: the run fails.
process.exit(survived.length === 0 ? 0 : 1)
