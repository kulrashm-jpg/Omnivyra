#!/usr/bin/env node
/**
 * 3AH-91 (S-1) mutation battery — upload-media-finalize authorizes before storage.
 *
 * Each entry reintroduces one way the route could again touch a storage object
 * the caller has not been authorized for. KILLED means the suite ran and at
 * least one test failed; a suite that cannot run, or a missing anchor, is NOT a
 * kill. A SURVIVOR means the tests do not constrain that behaviour — strengthen
 * the TEST, never weaken the mutation.
 *
 * The unmutated suite must pass first (green-baseline gate). Every mutation is
 * applied in place and reverted even if the run throws.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = ['backend/tests/unit/uploadMediaFinalizeAuthFirst.test.ts', 'backend/tests/unit/uploadMediaFinalize.test.ts'];
const ROUTE = 'pages/api/activity-workspace/[id]/upload-media-finalize.ts';

const MUTATIONS = [
  { id: 'M1', name: 'storage deletion moved before authentication (the original defect)',
    from: "  const mimeBase = mimeRaw.split(';')[0].trim().toLowerCase();\n",
    to: "  const mimeBase = mimeRaw.split(';')[0].trim().toLowerCase();\n  if (sizeBytes > MAX_FILE_BYTES) { await deleteStorageObject(storagePath); return res.status(413).json({ error: 'too big' }); }\n" },
  { id: 'M2', name: 'authentication removed',
    from: "  if (!user?.id) return res.status(401).json({ error: 'UNAUTHORIZED' });\n", to: '' },
  { id: 'M3', name: 'tenant check result ignored',
    from: '  if (!access) return;\n', to: '' },
  { id: 'M4', name: 'request company_id trusted over the activity\'s company',
    from: '    companyId = (campaignRow as { company_id?: string } | null)?.company_id ?? null;',
    to: "    companyId = String((req.body as Record<string, unknown>)?.company_id || (req.body as Record<string, unknown>)?.companyId || '') || ((campaignRow as { company_id?: string } | null)?.company_id ?? null);" },
  { id: 'M5', name: 'request user_id trusted as the caller',
    from: '  const { user } = await getSupabaseUserFromRequest(req);',
    to: "  const { user: authUser } = await getSupabaseUserFromRequest(req);\n  const user = authUser ?? ((req.body as Record<string, unknown>)?.user_id ? { id: String((req.body as Record<string, unknown>).user_id) } : null);" },
  { id: 'M6', name: 'object scope keyed to the caller-named path, not the authorized activity',
    from: '  if (!isActivityObjectPath(storagePath, id, companyId)) {',
    to: "  if (!isActivityObjectPath(storagePath, storagePath.split('/')[0], companyId)) {" },
  { id: 'M7', name: 'storage-path validation bypassed',
    from: '  if (!isActivityObjectPath(storagePath, id, companyId)) {', to: '  if (false) {' },
  { id: 'M8', name: 'company lookup error fails open into cleanup (old behaviour)',
    from: "  } catch {\n    return res.status(503).json({ error: 'Campaign company lookup failed. Please retry.', code: 'COMPANY_LOOKUP_FAILED' });\n  }\n  if (!companyId) return res.status(403).json({ error: 'Campaign company could not be resolved.' });",
    to: "  } catch {\n    companyId = null;\n  }\n  if (!companyId) { await deleteStorageObject(storagePath); return res.status(403).json({ error: 'Campaign company could not be resolved.' }); }" },
  { id: 'M9', name: 'company lookup error is swallowed (treated as "no company")',
    from: '    if (campaignError) throw campaignError;\n', to: '' },
  { id: 'M10', name: 'missing activity deletes the named object (old behaviour)',
    from: "  if (!rowData) return res.status(404).json({ error: `Row not found: ${id}` });",
    to: "  if (!rowData) { await deleteStorageObject(storagePath); return res.status(404).json({ error: `Row not found: ${id}` }); }" },
  { id: 'M11', name: 'prior-object cleanup no longer scoped',
    from: ' && isActivityObjectPath(priorObjectPath, id, companyId)) {', to: ') {' },
  { id: 'M12', name: 'traversal segments accepted',
    from: "  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;\n", to: '' },
  { id: 'M13', name: 'activity prefix matched as a substring',
    from: '  const tusLayout = segments.length >= 3 && segments[0] === activityId;',
    to: '  const tusLayout = objectPath.startsWith(activityId);' },
  { id: 'M14', name: 'another company\'s direct-layout objects accepted',
    from: '  const directLayout = segments.length >= 4 && segments[0] === companyId && segments[1] === activityId;',
    to: '  const directLayout = segments.length >= 4 && segments[1] === activityId;' },
];

function runSuite() {
  try {
    execFileSync(process.execPath, [JEST, ...SUITE, '--runInBand', '--forceExit', '--silent'], { stdio: 'pipe', encoding: 'utf8', timeout: 300_000 });
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
  const original = fs.readFileSync(ROUTE, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const from = m.from.split('\n').join(eol);
  const to = m.to.split('\n').join(eol);
  const hits = original.split(from).length - 1;
  if (hits !== 1) { results.push({ ...m, verdict: `NOT APPLICABLE — anchor found ${hits}x` }); continue; }
  fs.writeFileSync(ROUTE, original.replace(from, to), 'utf8');
  let run;
  try { run = runSuite(); } finally { fs.writeFileSync(ROUTE, original, 'utf8'); }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ S-1 MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
