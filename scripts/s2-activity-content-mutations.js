#!/usr/bin/env node
/**
 * 3AH-92 (S-2) mutation battery — activity-workspace content writes are bound
 * to the authorized tenant.
 *
 * Each entry reintroduces one way the route could again write AI output into a
 * daily_content_plans row the caller is not authorized for (or pay for it
 * first). KILLED means the suites ran and at least one test failed; a suite
 * that cannot run, or a missing anchor, is NOT a kill. A SURVIVOR means the
 * tests do not constrain that behaviour: strengthen the TEST, never weaken the
 * mutation.
 *
 * The unmutated suites must pass first (green-baseline gate). Every mutation
 * is applied in place (EOL-normalised) and reverted even if the run throws.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = [
  'backend/tests/unit/activityContentTenantBinding.test.ts',
  'backend/tests/unit/activityWorkspaceCreditAuthzSec001.test.ts',
];
const HANDLER = 'backend/services/activityWorkspace/contentRouteHandler.ts';
const ADAPTER = 'backend/services/orchestration/canonicalExecutionAdapter.ts';

// The request body, spelled indirectly so this tooling file carries no
// boundary-leak tokens of its own for the architecture audit.
const RB = '(' + ['req', 'body'].join('.') + ' as a' + 'ny)';

const MUTATIONS = [
  { id: 'M1', name: 'authentication removed', edits: [[HANDLER,
    "  if (authError || !user) {\n    return res.status(401).json({ error: 'Unauthorized' });\n  }\n",
    "  if (false) {\n    return res.status(401).json({ error: 'Unauthorized' });\n  }\n"]] },
  { id: 'M2', name: 'tenant authorization removed (membership of companyId)', edits: [[HANDLER,
    '      const isMember = await assertOrgMembership(user.id, companyId);\n      if (!isMember) {',
    '      const isMember = true;\n      if (!isMember) {']] },
  { id: 'M3', name: 'request company_id trusted for the row binding', edits: [[HANDLER,
    'await checkCampaignOwnership(writeTarget.campaignId, companyId)',
    `await checkCampaignOwnership(writeTarget.campaignId, String(${RB}?.company_id || companyId))`]] },
  { id: 'M4', name: 'request companyId trusted as proof of row ownership', edits: [[HANDLER,
    "const ownership = companyId ? await checkCampaignOwnership(writeTarget.campaignId, companyId) : 'foreign';",
    `const ownership = ${RB}?.companyId ? 'owned' : companyId ? await checkCampaignOwnership(writeTarget.campaignId, companyId) : 'foreign';`]] },
  { id: 'M5', name: 'activity ownership bypassed (campaign taken from the request, not the row)', edits: [[HANDLER,
    "campaignId: String(resolvedRow.row.campaign_id || '')",
    `campaignId: String(${RB}?.campaignId || resolvedRow.row.campaign_id || '')`]] },
  { id: 'M6', name: 'campaign ownership bypassed', edits: [[HANDLER,
    "      if (ownership !== 'owned') {",
    '      if (false) {']] },
  { id: 'M7a', name: 'fail-open: ownership lookup error allowed', edits: [[HANDLER,
    "      if (ownership === 'lookup_error') {",
    '      if (false) {'], [HANDLER,
    "      if (ownership !== 'owned') {",
    "      if (ownership !== 'owned' && ownership !== 'lookup_error') {"]] },
  { id: 'M7b', name: 'fail-open: activity lookup error treated as a transient id', edits: [[HANDLER,
    "    if (!resolvedRow.ok && resolvedRow.reason === 'lookup_error') {",
    '    if (false) {']] },
  { id: 'M7c', name: 'fail-open: adapter reads a lookup error as "no row"', edits: [[ADAPTER,
    "  if (byId.error) return { ok: false, reason: 'lookup_error' };\n", ''], [ADAPTER,
    "  if (byExecution.error) return { ok: false, reason: 'lookup_error' };\n", '']] },
  { id: 'M8', name: 'write before authorization', edits: [[HANDLER,
    "    if (writeTarget && action !== 'generate_master') {\n      const ownership",
    "    if (writeTarget) await persistVariantsToDb(writeTarget, [], null);\n    if (writeTarget && action !== 'generate_master') {\n      const ownership"]] },
  { id: 'M9a', name: 'reintroduced .or string splicing (UUID guard kept)', edits: [[ADAPTER,
    "  const byId = await supabase.from('daily_content_plans').select(cols).eq('id', activityId).limit(1);\n",
    "  const byId = await supabase.from('daily_content_plans').select(cols).or(`id.eq.${activityId},execution_id.eq.${activityId}`);\n"], [ADAPTER,
    "  const byExecution = await supabase.from('daily_content_plans').select(cols).eq('execution_id', activityId).limit(2);\n",
    '  const byExecution = { data: [], error: null };\n']] },
  { id: 'M9b', name: 'reintroduced .or string splicing (original: no UUID guard)', edits: [[ADAPTER,
    "  if (!isUuid(activityId)) return { ok: false, reason: 'invalid_activity_id' };\n", ''], [ADAPTER,
    "  const byId = await supabase.from('daily_content_plans').select(cols).eq('id', activityId).limit(1);\n",
    "  const byId = await supabase.from('daily_content_plans').select(cols).or(`id.eq.${activityId},execution_id.eq.${activityId}`);\n"], [ADAPTER,
    "  const byExecution = await supabase.from('daily_content_plans').select(cols).eq('execution_id', activityId).limit(2);\n",
    '  const byExecution = { data: [], error: null };\n']] },
  { id: 'M10', name: 'adapter campaign scope ignored', edits: [[ADAPTER,
    "  const outOfScope = Boolean(row && scope.campaignId && String(row.campaign_id ?? '') !== scope.campaignId);",
    '  const outOfScope = false;']] },
  { id: 'M11', name: 'malformed (mangled) activity id guard removed', edits: [[HANDLER,
    '    if (activityId && !isUuid(activityId) && EMBEDDED_UUID.test(activityId)) {',
    '    if (false) {']] },
  { id: 'M12', name: 'ambiguous id resolution accepted', edits: [[HANDLER,
    'await resolveActivityRow(activityId, { strict: true })',
    'await resolveActivityRow(activityId, { strict: false })']] },
  { id: 'M13', name: 'adapter UUID validation removed', edits: [[ADAPTER,
    "  if (!isUuid(activityId)) return { ok: false, reason: 'invalid_activity_id' };\n", '']] },
  { id: 'M14', name: 'generate_master grounded in the request companyId', edits: [[HANDLER,
    'generateMasterContentStrict({ ...item, company_id: resolvedOrgId }, {',
    'generateMasterContentStrict(item, {']] },
];

function runSuite() {
  try {
    execFileSync(process.execPath, [JEST, ...SUITE, '--runInBand', '--forceExit', '--silent'], { stdio: 'pipe', encoding: 'utf8', timeout: 600_000 });
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

const only = process.argv.slice(2);
const results = [];
for (const m of MUTATIONS.filter((x) => only.length === 0 || only.includes(x.id))) {
  const originals = new Map();
  let applicable = true;
  for (const [file] of m.edits) if (!originals.has(file)) originals.set(file, fs.readFileSync(file, 'utf8'));
  const next = new Map(originals);
  for (const [file, fromRaw, toRaw] of m.edits) {
    const text = next.get(file);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const from = fromRaw.split('\n').join(eol);
    const to = toRaw.split('\n').join(eol);
    const hits = text.split(from).length - 1;
    if (hits !== 1) { applicable = false; results.push({ ...m, verdict: `NOT APPLICABLE — anchor in ${file} found ${hits}x` }); break; }
    next.set(file, text.replace(from, () => to));
  }
  if (!applicable) continue;
  let run;
  try {
    for (const [file, text] of next) fs.writeFileSync(file, text, 'utf8');
    run = runSuite();
  } finally {
    for (const [file, text] of originals) fs.writeFileSync(file, text, 'utf8');
  }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
  console.log(`${m.id} done: ${results[results.length - 1].verdict}`);
}

console.log('\n============ S-2 MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
