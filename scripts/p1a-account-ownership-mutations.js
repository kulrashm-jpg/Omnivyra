#!/usr/bin/env node
/**
 * P1-A mutation battery — scheduler/schedule social-account ownership.
 *
 * Each entry reintroduces one way POST /api/scheduler/schedule could again
 * persist or enqueue a publish onto a connected account the caller's authorized
 * company does not own. KILLED means the suite ran and at least one test failed;
 * a suite that cannot run, or an anchor that does not match exactly once, is NOT
 * a kill and is reported as such. A SURVIVOR means the tests do not constrain
 * that behaviour — strengthen the TEST, never weaken the mutation.
 *
 * The unmutated suite must pass first (green-baseline gate). Every mutation is
 * applied in place, EOL-normalised to the file's own line endings, and reverted
 * in a `finally` even if the run throws.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = ['backend/tests/unit/schedulerScheduleAccountOwnership.test.ts'];
const ROUTE = 'pages/api/scheduler/schedule.ts';

const GATE = `    if (companyId) {
      const access = await enforceCompanyAccess({ req, res, companyId: String(companyId) });
      if (!access) return;
      authorizedCompanyId = String(companyId);
    }
`;
const FUTURE_GUARD = `    if (new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }
`;
const RESOLVE = '      const owner = await resolveAccountOwner(String(accountId));';
// Named company: the account must belong to exactly the company authorized above.
const COMPANY_COMPARE = '          if (owner.companyId !== authorizedCompanyId) return accountNotFound();';
// No named company: the account must be the caller's own, and the tenant it publishes
// under must be one the caller is authorized for.
const OWN_ACCOUNT = '          if (owner.userId !== userId) return accountNotFound();';
const TENANT_AUTHZ = '          const tenantAccess = await enforceCompanyAccess({ req, res, companyId: owner.companyId });\n          if (!tenantAccess) return;\n';
// Legacy account with no owning company: only the user who connected it.
const LEGACY_OWNER = '      } else if (owner.userId !== userId) {';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'account-owner check removed entirely (caller-supplied accountId persisted verbatim)',
    from: `    if (accountId) {\n${RESOLVE}`,
    to: `    if (false) {\n${RESOLVE}`,
  },
  {
    id: 'M2',
    name: 'compares against the caller-supplied company instead of the server-authorized one',
    from: GATE,
    to: '    if (companyId) {\n      authorizedCompanyId = String(companyId);\n    }\n',
  },
  {
    id: 'M3',
    name: 'existence-only check (the account row must exist, but its company is never compared)',
    from: COMPANY_COMPARE,
    to: '          if (!owner.companyId) return accountNotFound();',
  },
  {
    id: 'M4',
    name: 'lookup failure fails open (a database error is treated as the authorized company and the caller)',
    from: RESOLVE,
    to: `      const probe = await resolveAccountOwner(String(accountId));\n      const owner = probe.ok === false ? { ok: true as const, found: true, companyId: authorizedCompanyId, userId } : probe;`,
  },
  {
    id: 'M5',
    name: 'scheduled_posts insert before the ownership check',
    from: FUTURE_GUARD,
    to: `${FUTURE_GUARD}\n    await supabase.from('scheduled_posts').insert({ user_id: userId, platform: String(platform), content, scheduled_for: scheduledFor, status: 'scheduled', social_account_id: accountId ? String(accountId) : null });\n`,
  },
  {
    id: 'M6',
    name: 'publish enqueue before the ownership check',
    from: FUTURE_GUARD,
    to: `${FUTURE_GUARD}\n    if (accountId) { try { await enqueueScheduledPostAt('pre-check', userId, String(accountId), String(scheduledFor)); } catch { /* mutant */ } }\n`,
  },
  {
    id: 'M7',
    name: 'a caller-supplied body user_id waives the ownership mismatch',
    from: COMPANY_COMPARE,
    to: '          if (owner.companyId !== authorizedCompanyId && !(req.body || {}).user_id) return accountNotFound();',
  },
  {
    id: 'M8',
    name: 'no named company: the tenant the account publishes under is never authorized',
    from: TENANT_AUTHZ,
    to: '',
  },
  {
    id: 'M9',
    name: 'no named company: another user\'s account is accepted (own-account check removed)',
    from: OWN_ACCOUNT,
    to: '',
  },
  {
    id: 'M10',
    name: 'legacy account with no owning company: accepted for users other than the one who connected it',
    from: LEGACY_OWNER,
    to: '      } else if (false) {',
  },
];

function runSuite() {
  try {
    execFileSync(process.execPath, [JEST, ...SUITE, '--runInBand', '--forceExit', '--silent'], {
      stdio: 'pipe', encoding: 'utf8', timeout: 400_000,
    });
    return { passed: true, detail: 'suite passed' };
  } catch (err) {
    const out = String(err.stdout || '') + String(err.stderr || '');
    const hit = out.match(/Tests:\s+(\d+) failed/);
    if (hit) return { passed: false, behavioural: true, detail: `${hit[1]} test(s) failed` };
    return {
      passed: false,
      behavioural: false,
      detail: /Test suite failed to run/.test(out) ? 'suite failed to RUN' : 'suite failed (no test count)',
    };
  }
}

const baseline = runSuite();
if (!baseline.passed) {
  console.error(`GREEN-BASELINE GATE FAILED (${baseline.detail}) — refusing to run mutations.`);
  process.exit(2);
}
console.log('green baseline: unmutated suite passes');

const results = [];
for (const m of MUTATIONS) {
  const file = m.file || ROUTE;
  const original = fs.readFileSync(file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const from = m.from.split('\n').join(eol);
  const to = m.to.split('\n').join(eol);
  const hits = original.split(from).length - 1;
  if (hits !== 1) {
    results.push({ ...m, verdict: `NOT APPLICABLE — anchor found ${hits}x (must be exactly 1)` });
    continue;
  }
  fs.writeFileSync(file, original.replace(from, to), 'utf8');
  let run;
  try {
    run = runSuite();
  } finally {
    fs.writeFileSync(file, original, 'utf8');
  }
  results.push({
    ...m,
    verdict: run.passed
      ? `SURVIVED (${run.detail})`
      : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})`,
  });
}

console.log('\n============ P1-A MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
