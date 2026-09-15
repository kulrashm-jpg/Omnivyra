#!/usr/bin/env node
/**
 * 3AH-92 (S-3) mutation battery — scheduled-post reschedule tenant binding.
 *
 * Each entry reintroduces one way POST /api/schedule/reschedule (or its sibling
 * /api/activity-workspace/[id]/reschedule) could again retime or re-enqueue a
 * post the caller's company does not own. KILLED means the suite ran and at
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
const SUITE = [
  'backend/tests/unit/scheduleRescheduleTenantBinding.test.ts',
  'backend/tests/unit/activityRescheduleLinkedPostBinding.test.ts',
  'backend/tests/unit/rescheduleApi.test.ts',
  'backend/tests/unit/rescheduleFullMove.test.ts',
];
const ROUTE = 'pages/api/schedule/reschedule.ts';
const ACTIVITY = 'pages/api/activity-workspace/[id]/reschedule.ts';

const POST_LOADED = "    if (!post) {\n      return res.status(404).json({ error: 'Scheduled post not found' });\n    }\n";

const MUTATIONS = [
  { id: 'M1', name: 'authentication removed', file: ROUTE,
    from: "  if (!user?.userId || user.authenticated === false) {\n    return res.status(401).json({ error: 'UNAUTHORIZED' });\n  }\n", to: '' },
  { id: 'M2', name: 'tenant check removed (owner resolved, caller membership never checked)', file: ROUTE,
    from: '      const access = await requireCampaignAccess(req, res, campaignId);\n      if (!access) return;\n',
    to: "      const owner = await supabase.from('campaign_versions').select('company_id').eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(1).maybeSingle();\n      const access = { companyId: String(owner.data?.company_id ?? '') };\n" },
  { id: 'M3', name: 'request companyId trusted for a campaign_id NULL post', file: ROUTE,
    from: "    } else if (String(post.user_id ?? '') !== user.userId) {",
    to: "    } else if (!requestedCompanyId && String(post.user_id ?? '') !== user.userId) {" },
  { id: 'M4', name: 'request companyId no longer required to match the resolved owner', file: ROUTE,
    from: '      if (requestedCompanyId && requestedCompanyId !== access.companyId) {',
    to: '      if (false) {' },
  { id: 'M5', name: 'request user_id trusted as the post owner', file: ROUTE,
    from: "    } else if (String(post.user_id ?? '') !== user.userId) {",
    to: "    } else if (String(post.user_id ?? '') !== String((req.body || {}).user_id || user.userId)) {" },
  { id: 'M6', name: 'campaign ownership bypassed (campaign posts judged by post creator)', file: ROUTE,
    from: '    if (campaignId) {\n      const access', to: '    if (false) {\n      const access' },
  { id: 'M7', name: 'activity ownership bypassed (linked post not bound to the row\'s campaign)', file: ACTIVITY,
    from: '  if (priorScheduledPostId) {\n    const { data: linkedPost', to: '  if (false) {\n    const { data: linkedPost' },
  { id: 'M8', name: 'activity binding checks existence only, not campaign', file: ACTIVITY,
    from: " || String((linkedPost as { campaign_id?: string | null }).campaign_id ?? '') !== String(row.campaign_id)) {",
    to: ') {' },
  { id: 'M9', name: 'version ownership bypassed (other-company version rows ignored)', file: ROUTE,
    from: "  if (others.error) return 'lookup_error';\n  return Array.isArray(others.data) && others.data.length > 0 ? 'conflict' : 'agrees';",
    to: "  return others.error ? 'lookup_error' : 'agrees';" },
  { id: 'M10', name: 'campaigns.company_id conflict ignored', file: ROUTE,
    from: "  if (legacyCompany && String(legacyCompany) !== ownerCompanyId) return 'conflict';\n", to: '' },
  { id: 'M11', name: 'fail-open: campaigns lookup error treated as agreement', file: ROUTE,
    from: "  if (campaign.error) return 'lookup_error';", to: "  if (campaign.error) return 'agrees';" },
  { id: 'M12', name: 'fail-open: other-version lookup error treated as agreement', file: ROUTE,
    from: "  if (others.error) return 'lookup_error';", to: "  if (others.error) return 'agrees';" },
  { id: 'M13', name: 'fail-open: missing campaigns row treated as agreement', file: ROUTE,
    from: "  if (!campaign.data) return 'missing';", to: "  if (!campaign.data) return 'agrees';" },
  { id: 'M14', name: 'enqueue before authorization', file: ROUTE,
    from: POST_LOADED,
    to: `${POST_LOADED}    await enqueueScheduledPostAt(postId, String(post.user_id), String(post.social_account_id), newDate.toISOString());\n` },
  { id: 'M15', name: 'scheduled_posts update before authorization', file: ROUTE,
    from: POST_LOADED,
    to: `${POST_LOADED}    await supabase.from('scheduled_posts').update({ scheduled_for: newDate.toISOString() }).eq('id', postId);\n` },
  { id: 'M16', name: 'write no longer repeats the authorized campaign predicate', file: ROUTE,
    from: "      ? await update.eq('campaign_id', campaignId)", to: '      ? await update' },
  { id: 'M17', name: 'malformed post id accepted', file: ROUTE,
    from: '  if (!UUID_RE.test(postId)) {', to: '  if (false) {' },
];

function runSuite() {
  try {
    execFileSync(process.execPath, [JEST, ...SUITE, '--runInBand', '--forceExit', '--silent'], { stdio: 'pipe', encoding: 'utf8', timeout: 400_000 });
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
  const original = fs.readFileSync(m.file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const from = m.from.split('\n').join(eol);
  const to = m.to.split('\n').join(eol);
  const hits = original.split(from).length - 1;
  if (hits !== 1) { results.push({ ...m, verdict: `NOT APPLICABLE — anchor found ${hits}x` }); continue; }
  fs.writeFileSync(m.file, original.replace(from, to), 'utf8');
  let run;
  try { run = runSuite(); } finally { fs.writeFileSync(m.file, original, 'utf8'); }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ S-3 MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
