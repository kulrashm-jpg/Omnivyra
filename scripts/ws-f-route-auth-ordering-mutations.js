#!/usr/bin/env node
'use strict';
/**
 * STEP 3AH-118 (WS-F) — mutation battery for route-auth ORDERING.
 *
 *   node scripts/ws-f-route-auth-ordering-mutations.js [--routes-only | --checker-only]
 *
 * ROUTE mutants: a real pages/api route is mutated IN MEMORY (move auth below a
 * write, remove it, replace it with an unrelated helper, move/remove the tenant
 * check, hide a side effect behind a helper, reorder storage/queue/external/
 * outbound calls before auth, …) and analysed by the gate with the repository
 * allowlist. The unmutated route must pass; the mutant is KILLED when the gate
 * reports a violation of an expected rule for it.
 *
 * CHECKER mutants: the ordering analyzer / policy is mutated ON DISK (backed up,
 * restored in `finally`, byte-verified at the end) and the WS-F suite
 * backend/tests/unit/routeAuthOrdering.test.ts is run. KILLED = the suite fails.
 * A green-baseline run of the unmutated suite gates the whole battery.
 *
 * An anchor that is missing is a battery FAILURE, never N/A.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = new Set(process.argv.slice(2));
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: anchor found ${n} times: ${from.slice(0, 80)}`);
  return src.replace(from, () => to);
}
function moveBelow(src, block, after, label) {
  const without = replaceOnce(src, block, '', `${label} (cut)`);
  return replaceOnce(without, after, `${after}\n${block}`, `${label} (paste)`);
}

// ─────────────────────────────────────────────────────────────── route mutants ──
const R = {
  reject: 'pages/api/campaigns/proposals/reject.ts',
  templates: 'pages/api/templates/index.ts',
  gpt: 'pages/api/ai/gpt-chat.ts',
  upload: 'pages/api/activity-workspace/[id]/upload-media-direct.ts',
  posts: 'pages/api/schedule/posts.ts',
  cron: 'pages/api/cron/process-scheduled-posts.ts',
  note: 'pages/api/voice/notes/[noteId].ts',
};
const REJECT_AUTHZ = "  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });\n  if (!access) return;\n";
const REJECT_UPDATE = "  const { error: updateError } = await supabase\n    .from('campaign_proposals')\n    .update({ status: 'rejected', updated_at: new Date().toISOString() })\n    .eq('id', proposalId);\n";
const TPL_BIND = "    if (templateData.campaign_id) {\n      const access = await requireCampaignAccess(req, res, String(templateData.campaign_id));\n      if (!access) return;\n    }\n";
const TPL_CREATE = '    const template = await createTemplate(user.id, templateData);\n';
const GPT_AUTH = "  const { user, error: authError } = await getSupabaseUserFromRequest(req);\n  if (authError || !user) {\n    return res.status(401).json({ error: 'UNAUTHORIZED' });\n  }\n";
const UPLOAD_AUTH = '  const caller = await resolveUserContext(req);\n';
const POSTS_AUTH = '  const userId = await requireUserId(req, res);\n';
const CRON_GUARD = "  const triggeredByCronSecret = bearerTokenMatches(req.headers['authorization'], cronSecret);\n";
const NOTE_AUTH = "    const { user, error: authError } = await getSupabaseUserFromRequest(req);\n    if (authError || !user) {\n      return res.status(401).json({ error: 'UNAUTHORIZED' });\n    }\n";
const NOTE_READ = "    const { data: note, error: lookupError } = await supabase\n      .from('voice_notes')\n      .select('id, campaign_id')\n      .eq('id', String(noteId))\n      .maybeSingle();\n";
const HIDDEN_SERVICE = 'backend/services/wsfMutantTelemetry.ts';

const ROUTE_MUTANTS = [
  { id: 'R01', cls: 'move auth below a write', route: R.reject, expect: ['R5-ORDER'],
    mutate: (s) => moveBelow(s, REJECT_AUTHZ, REJECT_UPDATE, 'R01') },
  { id: 'R02', cls: 'remove the auth call', route: R.gpt, expect: ['R1', 'R5-ORDER'],
    mutate: (s) => replaceOnce(s, GPT_AUTH, "  const user = { id: String(req.body.userId) };\n", 'R02') },
  { id: 'R03', cls: 'replace auth with an unrelated helper', route: R.gpt, expect: ['R1', 'R5-ORDER'],
    mutate: (s) => replaceOnce(s, 'await getSupabaseUserFromRequest(req);', 'await getUserFromHeaders(req);', 'R03')
      + "\nasync function getUserFromHeaders(r: NextApiRequest) { return { user: { id: String(r.headers['x-user-id']) }, error: null }; }\n" },
  { id: 'R04', cls: 'move tenant authz below the side effect', route: R.templates, expect: ['R6-ORDER'],
    mutate: (s) => moveBelow(s, TPL_BIND, TPL_CREATE, 'R04') },
  { id: 'R05', cls: 'remove the tenant check', route: R.templates, expect: ['R6-ORDER', 'R3'],
    mutate: (s) => replaceOnce(s, TPL_BIND, '', 'R05') },
  { id: 'R06', cls: 'remove the only (tenant) primitive before a write', route: R.reject, expect: ['R1', 'R5-ORDER'],
    mutate: (s) => replaceOnce(s, REJECT_AUTHZ, '', 'R06') },
  { id: 'R07', cls: 'hide the side effect behind a same-module helper (before auth)', route: R.reject, expect: ['R5-ORDER'],
    mutate: (s) => replaceOnce(replaceOnce(s, REJECT_UPDATE, '  const { error: updateError } = await rejectProposal(proposalId);\n', 'R07 (call)'),
      '  const organizationId = proposal.organization_id as string;\n',
      "  await rejectProposal(proposalId);\n  const organizationId = proposal.organization_id as string;\n", 'R07 (early)')
      + "\nasync function rejectProposal(id: string) { return supabase.from('campaign_proposals').update({ status: 'rejected' }).eq('id', id); }\n" },
  { id: 'R08', cls: 'hide the side effect behind an imported service (before auth)', route: R.gpt, expect: ['R5-ORDER'],
    modules: { [HIDDEN_SERVICE]: "import { supabase } from '../db/supabaseClient';\nexport async function recordChatAttempt(body: object) { await supabase.from('chat_attempts').insert({ body }); }\n" },
    mutate: (s) => "import { recordChatAttempt } from '../../../backend/services/wsfMutantTelemetry';\n"
      + replaceOnce(s, GPT_AUTH, `  await recordChatAttempt(req.body);\n${GPT_AUTH}`, 'R08') },
  { id: 'R09', cls: 'reorder storage deletion before auth', route: R.upload, expect: ['R5-ORDER'],
    mutate: (s) => replaceOnce(s, UPLOAD_AUTH, `  await supabase.storage.from(UPLOAD_BUCKET).remove([id]);\n${UPLOAD_AUTH}`, 'R09') },
  { id: 'R10', cls: 'reorder queue enqueue before auth', route: R.posts, expect: ['R5-ORDER'],
    mutate: (s) => replaceOnce(s, POSTS_AUTH, `  await enqueueScheduledPostAt(String(req.body.id), '', '', '');\n${POSTS_AUTH}`, 'R10') },
  { id: 'R11', cls: 'reorder external API call before auth', route: R.gpt, expect: ['R5-ORDER'],
    mutate: (s) => replaceOnce(s, GPT_AUTH, `  await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify(req.body) });\n${GPT_AUTH}`, 'R11') },
  { id: 'R12', cls: 'reorder outbound communication before auth', route: R.gpt, expect: ['R5-ORDER'],
    mutate: (s) => "import { sendNotificationEmail } from '../../../backend/services/wsfMutantMail';\n"
      + replaceOnce(s, GPT_AUTH, `  await sendNotificationEmail(String(req.body.email));\n${GPT_AUTH}`, 'R12') },
  { id: 'R13', cls: 'secret guard downgraded to a non-constant-time comparison', route: R.cron, expect: ['R5-ORDER'],
    mutate: (s) => replaceOnce(s, CRON_GUARD, "  const triggeredByCronSecret = req.headers['authorization'] === `Bearer ${cronSecret}`;\n", 'R13') },
  { id: 'R14', cls: 'authorization against caller-controlled principal data', route: R.reject, expect: ['R7-PRINCIPAL'],
    mutate: (s) => replaceOnce(s, 'enforceCompanyAccess({ req, res, companyId: organizationId })', 'enforceCompanyAccess({ req, res, companyId: organizationId, userId: req.body.userId })', 'R14') },
  { id: 'R15', cls: 'protected read moved before auth (authFirst contract)', route: R.note, expect: ['R5-READ'],
    mutate: (s) => moveBelow(s, NOTE_AUTH, NOTE_READ, 'R15') },
];

function runRouteMutants() {
  const gate = require('./check-route-auth.js');
  const allowPath = path.join(__dirname, 'route-auth-allowlist.json');
  const allowlist = gate.loadAllowlist(allowPath);
  const methodExemptions = gate.loadMethodExemptions(allowPath);
  const knownOpen = gate.loadKnownOpen(allowPath);
  const ordering = gate.loadOrderingSections(allowPath);
  const results = [];
  for (const m of ROUTE_MUTANTS) {
    const raw = fs.readFileSync(path.join(ROOT, m.route), 'utf8');
    const opts = { knownOpen, ordering, modules: m.modules };
    const base = gate.analyzeRoute(m.route, raw, allowlist, methodExemptions, opts);
    let row;
    let error = null;
    try {
      row = gate.analyzeRoute(m.route, m.mutate(raw), allowlist, methodExemptions, opts);
    } catch (e) {
      error = e.message;
    }
    const got = row ? [...new Set(row.violations.map((v) => v.rule))].sort() : [];
    const killed = !error && base.violations.length === 0 && got.some((r) => m.expect.includes(r));
    results.push({ id: m.id, cls: m.cls, route: m.route, baselineClean: base.violations.length === 0, rules: got, expect: m.expect, killed, error });
  }
  return results;
}

// ───────────────────────────────────────────────────────────── checker mutants ──
const A = 'scripts/route-auth-ordering.js';
const P = 'scripts/route-auth-ordering-policy.js';
const S = 'scripts/route-auth-ordering-shapes.js';
const CHECKER_MUTANTS = [
  { id: 'C01', cls: 'weaken the parser to presence-only (an auth call anywhere covers every event)', file: P,
    from: '  for (const e of order.events) {', to: '  for (const e0 of order.events) {\n    const e = order.auth.length ? { ...e0, id: true, tenant: true } : e0;' },
  { id: 'C02', cls: 'dominance join weakened (either branch authenticates)', file: A,
    from: 'const both = (states) => states.reduce((a, b) => ({ id: a.id && b.id, tenant: a.tenant && b.tenant,', to: 'const both = (states) => states.reduce((a, b) => ({ id: a.id || b.id, tenant: a.tenant || b.tenant,' },
  { id: 'C03', cls: 'deferred callbacks dominate what follows', file: A,
    from: 'if (target && invokesParam(target.fn, i)) st = {', to: 'if (true) st = {' },
  { id: 'C04', cls: 'try-block auth covers the catch', file: A,
    from: 'const k = s.catchClause ? block(s.catchClause.block.statements, m, { ...st }', to: 'const k = s.catchClause ? block(s.catchClause.block.statements, m, { ...t.st }' },
  { id: 'C05', cls: 'right side of &&/||/?? dominates', file: A,
    from: '        expr(n.right, m, { ...l }, cx, scope);\n        return l;', to: '        return expr(n.right, m, { ...l }, cx, scope);' },
  { id: 'C06', cls: 'imported service effects not followed', file: A,
    from: '      if (r) for (const e of summarize(r.fn, r.m, 1, new Set())) record(', to: '      if (false) for (const e of summarize(r.fn, r.m, 1, new Set())) record(' },
  { id: 'C07', cls: 'same-module helpers not interpreted', file: A,
    from: '      if (r && (r.local || r.delegated)) {', to: '      if (r && r.delegated) {' },
  { id: 'C08', cls: 'storage sink dropped', file: S,
    from: "  if (names.has('storage') && STORAGE_METHODS.has(name)) return { kind: 'storage'", to: "  if (names.has('storage') && STORAGE_METHODS.has(name)) return null; if (false) return { kind: 'storage'" },
  { id: 'C09', cls: 'queue sink dropped', file: S,
    from: "    if (QUEUE_IDENT.test(c.text)) return", to: "    if (false) return" },
  { id: 'C10', cls: 'external-call sink dropped', file: S,
    from: '    if (EXTERNAL_IDENT.has(c.text) ||', to: '    if (false &&' },
  { id: 'C11', cls: 'outbound sink dropped', file: S,
    from: '    if (OUTBOUND_NAME.test(c.text)) return', to: '    if (false) return' },
  { id: 'C12', cls: 'R6 tenant ordering disabled', file: P,
    from: '  const tenantBound = !entry &&', to: '  const tenantBound = false && !entry &&' },
  { id: 'C13', cls: 'comparator guard accepts every call', file: A,
    from: "    if (nm === 'timingSafeEqual') {", to: "    if (nm) return true;\n    if (nm === 'timingSafeEqual') {" },
  { id: 'C14', cls: 'reassignable (let) comparator binding accepted', file: A,
    from: '        if (isConst && ts.isIdentifier(d.name)', to: '        if (ts.isIdentifier(d.name)' },
  { id: 'C15', cls: 'safe seam provenance dropped (name-only)', file: A,
    from: '    return Boolean(target && SAFE_SEAMS.some((x) => x.name === imp.imported && x.from.test(target)));', to: '    return SAFE_SEAMS.some((x) => x.name === c.text);' },
  { id: 'C16', cls: 'optional binding ignores which value was authorized', file: S,
    from: "    return authEvents.some((a) => (a.level === 'tenant' || a.level === 'platform') && re.test(a.args)) &&", to: "    return authEvents.some((a) => (a.level === 'tenant' || a.level === 'platform')) &&" },
  { id: 'C17', cls: 'database-loaded values treated as request input', file: S,
    from: '      if (hasLookup(n.initializer)) return;', to: '      if (false) return;' },
  { id: 'C18', cls: 'method-guarded authorization applied to every case', file: S,
    from: 'const underMethods = (st, methods) => (st.mc && methods && methods.size && [...methods].every((x) => st.mc.methods.has(x))', to: 'const underMethods = (st, methods) => (st.mc' },
  { id: 'C19', cls: 'ordering pattern narrows effects it does not list', file: P,
    from: '      if (covered.has(signature(e))) out.patterned.push(signature(e));', to: '      if (covered.size) out.patterned.push(signature(e));' },
  { id: 'C20', cls: 'ordering pattern shape check removed', file: P,
    from: '  else if (!ORDERING_PATTERNS[p.pattern].test(hit[0]))', to: '  else if (false)' },
  { id: 'C21', cls: 'authFirst read contract ignored', file: P,
    from: '  const readContract = Boolean(authFirst) ||', to: '  const readContract = false &&' },
  { id: 'C22', cls: 'R7 caller-controlled principal disabled', file: P,
    from: '  if (principal.length) out.violations.push', to: '  if (false) out.violations.push' },
  { id: 'C23', cls: 'ordering verifier no longer requires a 401/403 rejection', file: P,
    from: '  else if (!/status', to: '  else if (false && !/status' },
  { id: 'C24', cls: 'provable callback invocation (timeStage) not recognised', file: A,
    from: 'if (target && invokesParam(target.fn, i)) st = {', to: 'if (false) st = {' },
  { id: 'C25', cls: 'reviewed verifier names ignored', file: A,
    from: "    if (nm && extraAuth.has(nm)) return { level: 'machine'", to: "    if (false) return { level: 'machine'" },
  { id: 'C26', cls: 'branch that authenticates dominates the join (sibling branch)', file: A,
    from: '      const joined = both(live);', to: '      const joined = t.exits ? both(live) : { ...t.st };' },
];

function runSuite() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/jest/bin/jest.js'), 'backend/tests/unit/routeAuthOrdering.test.ts', '--silent'], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  const m = /Tests:\s+([^\n]+)/.exec(`${r.stdout}\n${r.stderr}`);
  return { status: r.status, summary: m ? m[1].trim() : 'no summary' };
}

function runCheckerMutants() {
  const originals = new Map([A, P, S].map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  const baseline = runSuite();
  if (baseline.status !== 0) return { baseline, results: [], aborted: 'green baseline failed' };
  const results = [];
  try {
    for (const m of CHECKER_MUTANTS) {
      const file = path.join(ROOT, m.file);
      let error = null;
      try {
        fs.writeFileSync(file, replaceOnce(originals.get(m.file), m.from, m.to, m.id));
      } catch (e) {
        error = e.message;
      }
      const run = error ? { status: 0, summary: 'not run' } : runSuite();
      fs.writeFileSync(file, originals.get(m.file));
      results.push({ id: m.id, cls: m.cls, file: m.file, killed: !error && run.status !== 0, suite: run.summary, error });
      console.log(`  ${m.id} ${!error && run.status !== 0 ? 'KILLED  ' : 'SURVIVED'} ${m.cls} — ${error || run.summary}`);
    }
  } finally {
    for (const [f, s] of originals) fs.writeFileSync(path.join(ROOT, f), s);
  }
  const restored = [...originals].every(([f, s]) => sha(fs.readFileSync(path.join(ROOT, f), 'utf8')) === sha(s));
  return { baseline, results, restored };
}

function main() {
  let failed = false;
  if (!args.has('--checker-only')) {
    const rr = runRouteMutants();
    console.log('ROUTE mutants (in-memory, repository allowlist):');
    for (const r of rr) console.log(`  ${r.id} ${r.killed ? 'KILLED  ' : 'SURVIVED'} ${r.cls} — ${r.route} → [${r.rules.join(', ')}]${r.error ? ` ERROR ${r.error}` : ''}${r.baselineClean ? '' : ' (BASELINE NOT CLEAN)'}`);
    const k = rr.filter((r) => r.killed).length;
    console.log(`ROUTE: ${k}/${rr.length} killed, 0 N/A`);
    if (k !== rr.length) failed = true;
  }
  if (!args.has('--routes-only')) {
    console.log('CHECKER mutants (on disk, WS-F suite):');
    const cr = runCheckerMutants();
    console.log(`green baseline: ${cr.baseline.status === 0 ? 'PASS' : 'FAIL'} (${cr.baseline.summary})`);
    if (cr.aborted) { console.log(`ABORTED: ${cr.aborted}`); failed = true; } else {
      const k = cr.results.filter((r) => r.killed).length;
      console.log(`CHECKER: ${k}/${cr.results.length} killed, 0 N/A; sources restored byte-identical: ${cr.restored}`);
      if (k !== cr.results.length || !cr.restored) failed = true;
    }
  }
  console.log(failed ? 'MUTATION BATTERY: FAIL' : 'MUTATION BATTERY: PASS');
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { ROUTE_MUTANTS, CHECKER_MUTANTS };
