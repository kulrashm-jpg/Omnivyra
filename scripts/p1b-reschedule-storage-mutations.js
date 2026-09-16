#!/usr/bin/env node
/**
 * P1-B mutation battery — activity-workspace reschedule storage-object scope.
 *
 * Each entry reintroduces one way POST /api/activity-workspace/[id]/reschedule
 * could again delete a storage object the caller's company does not own.
 * KILLED means the suite ran and at least one test failed; a suite that cannot
 * run, or an anchor that does not match EXACTLY ONCE, is NOT a kill and is
 * reported as such. A SURVIVOR means the tests do not constrain that
 * behaviour — strengthen the TEST, never weaken the mutation.
 *
 * The unmutated suite must pass first (green-baseline gate). Every mutation is
 * applied in place, EOL-normalised, and reverted in a `finally` even if the run
 * throws.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = [
  'backend/tests/unit/activityRescheduleStorageObjectScope.test.ts',
  'backend/tests/unit/activityRescheduleLinkedPostBinding.test.ts',
];
const ROUTE = 'pages/api/activity-workspace/[id]/reschedule.ts';

/** The single scope gate at the delete site. */
const SCOPE_GATE = '      if (isActivityObjectPath(priorObjectPath, id, companyId)) {';
/** The head of the company-resolution block — everything before it is pre-auth. */
const PRE_AUTH = '  let companyId: string | null = null;\n  try {\n';
/** The host gate inside extractStorageObjectPath. */
const HOST_GATE = '  if (allowedOrigins.size === 0 || !allowedOrigins.has(url.origin)) return null;';
/** The fail-closed parse of a non-absolute value. */
const PARSE_FAIL_CLOSED = '  try {\n    url = new URL(publicUrl);\n  } catch {\n    return null;\n  }\n';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'scope guard removed — the recorded path alone authorizes the delete (the original defect)',
    from: SCOPE_GATE,
    to: '      if (priorObjectPath) {',
  },
  {
    id: 'M2',
    name: 'arbitrary host accepted — host validation disabled, path-only extraction restored',
    from: HOST_GATE,
    to: '  if (false) return null;',
  },
  {
    id: 'M3',
    name: 'scope taken from the caller-named path instead of the authorized activity/company',
    from: SCOPE_GATE,
    to: [
      '      const claimedSegments = priorObjectPath.split(\'/\');',
      '      const claimedCompany = claimedSegments.length >= 4 ? claimedSegments[0] : companyId;',
      '      const claimedActivity = claimedSegments.length >= 4 ? claimedSegments[1] : claimedSegments[0];',
      '      if (isActivityObjectPath(priorObjectPath, claimedActivity, claimedCompany)) {',
    ].join('\n'),
  },
  {
    id: 'M4',
    name: 'authorization bypassed — enforceCompanyAccess no longer fails closed',
    from: '  const access = await enforceCompanyAccess({ req, res, companyId });\n  if (!access) return;\n',
    to: '  const access = await enforceCompanyAccess({ req, res, companyId });\n  if (!access) { /* mutation: proceed unauthorized */ }\n',
  },
  {
    id: 'M5',
    name: 'malformed / relative URL fails OPEN — resolved against the configured storage origin',
    from: PARSE_FAIL_CLOSED,
    to: [
      '  try {',
      '    url = new URL(publicUrl);',
      '  } catch {',
      '    const fallbackBase = Array.from(allowedStorageOrigins())[0];',
      '    if (!fallbackBase) return null;',
      '    url = new URL(String(publicUrl), fallbackBase);',
      '  }',
      '',
    ].join('\n'),
  },
  {
    id: 'M6',
    name: 'delete moved BEFORE authorization — the prior object is dropped on the way in',
    from: PRE_AUTH,
    to: [
      '  const preAuthPriorUrl = typeof currentContent.uploaded_media_url === \'string\'',
      '    ? (currentContent.uploaded_media_url as string)',
      '    : null;',
      '  const preAuthObjectPath = extractStorageObjectPath(preAuthPriorUrl);',
      '  if (preAuthObjectPath) await deleteStorageObject(preAuthObjectPath);',
      PRE_AUTH.replace(/\n$/, ''),
      '',
    ].join('\n'),
  },
  {
    id: 'M7',
    name: 'host gate weakened to a hostname suffix match — lookalike hosts accepted',
    from: HOST_GATE,
    to: [
      '  const configuredHosts = Array.from(allowedOrigins).map((o) => new URL(o).hostname);',
      '  if (configuredHosts.length === 0 || !configuredHosts.some((h) => url.hostname.endsWith(h))) return null;',
    ].join('\n'),
  },
  {
    id: 'M8',
    name: 'object key percent-decoded before the scope check — encoded traversal fails open',
    from: '  return url.pathname.slice(idx + UPLOAD_BUCKET.length + 2);',
    to: '  return decodeURIComponent(url.pathname.slice(idx + UPLOAD_BUCKET.length + 2)).split(\'/\').filter((s) => s !== \'..\').join(\'/\');',
  },
];

function runSuite() {
  try {
    execFileSync(process.execPath, [JEST, ...SUITE, '--runInBand', '--forceExit', '--silent'], { stdio: 'pipe', encoding: 'utf8', timeout: 600_000 });
    return { passed: true, detail: 'suite passed' };
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
    results.push({ ...m, verdict: `NOT APPLICABLE — anchor matched ${hits}x (expected exactly 1)` });
    continue;
  }
  fs.writeFileSync(file, original.replace(from, to), 'utf8');
  let run;
  try {
    run = runSuite();
  } finally {
    fs.writeFileSync(file, original, 'utf8');
  }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ P1-B MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
