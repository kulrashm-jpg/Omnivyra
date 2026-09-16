#!/usr/bin/env node
/**
 * 3AH-96 (REG-1) mutation battery — the ambient credit handle is bound to its org.
 *
 * Each entry reintroduces one way a billed scope for one org could vouch for a
 * call it does not cover, which would silence the untracked-AI-call detector
 * and mis-attribute spend once BILLING_REQUIRE_AI_HANDLE is enforced. M1 is the
 * exact condition PR #246 shipped (REG-1). KILLED means the suite ran and at
 * least one test failed; a suite that cannot run, or a missing anchor, is NOT a
 * kill. A SURVIVOR means the tests do not constrain that behaviour — strengthen
 * the TEST, never weaken the mutation.
 *
 * The unmutated suite must pass first (green-baseline gate). Every mutation is
 * applied in place (EOL-normalised) and reverted even if the run throws.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = [
  'backend/tests/unit/aiGatewayBillingGuard.test.ts',
  'backend/tests/unit/sec91IntExecuteWithCreditsHandle.test.ts',
];
const GUARD = 'backend/services/billing/aiGatewayBillingGuard.ts';
const FIXED = '  const ambientValid = ambient && args.orgId && ambient.orgId === args.orgId ? ambient : undefined;';

const MUTATIONS = [
  { id: 'M1', name: 'REG-1: a missing args.orgId accepts the ambient vouch (the shipped condition)',
    from: FIXED,
    to: "  const ambientValid = ambient && (!args.orgId || !ambient.orgId || ambient.orgId === args.orgId) ? ambient : undefined;" },
  { id: 'M2', name: 'org binding removed entirely (any ambient handle vouches)',
    from: FIXED, to: '  const ambientValid = ambient;' },
  { id: 'M3', name: 'an empty ambient.orgId vouches for a named org',
    from: FIXED,
    to: "  const ambientValid = ambient && args.orgId && (!ambient.orgId || ambient.orgId === args.orgId) ? ambient : undefined;" },
  { id: 'M4', name: 'a foreign ambient org vouches (comparison inverted away)',
    from: FIXED,
    to: "  const ambientValid = ambient && args.orgId ? ambient : undefined;" },
];

function runSuite() {
  try {
    execFileSync(process.execPath, [JEST, ...SUITE, '--runInBand', '--forceExit', '--silent'], { stdio: 'pipe', encoding: 'utf8', timeout: 300_000 });
    return { passed: true, detail: 'suites passed' };
  } catch (err) {
    const out = String(err.stdout || '') + String(err.stderr || '');
    const hit = out.match(/Tests:\s+(\d+) failed/);
    if (hit) return { passed: false, behavioural: true, detail: `${hit[1]} test(s) failed` };
    return { passed: false, behavioural: false, detail: /Test suite failed to run/.test(out) ? 'suite failed to RUN' : 'suite failed (no test count)' };
  }
}

const baseline = runSuite();
if (!baseline.passed) {
  console.error(`GREEN-BASELINE GATE FAILED (${baseline.detail}) — refusing to run mutations.`);
  process.exit(2);
}
console.log('green baseline: unmutated suites pass');

const results = [];
for (const m of MUTATIONS) {
  const original = fs.readFileSync(GUARD, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const from = m.from.split('\n').join(eol);
  const to = m.to.split('\n').join(eol);
  const hits = original.split(from).length - 1;
  if (hits !== 1) { results.push({ ...m, verdict: `NOT APPLICABLE — anchor found ${hits}x` }); continue; }
  fs.writeFileSync(GUARD, original.replace(from, () => to), 'utf8');
  let run;
  try { run = runSuite(); } finally { fs.writeFileSync(GUARD, original, 'utf8'); }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ REG-1 MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
