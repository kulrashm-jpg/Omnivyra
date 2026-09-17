#!/usr/bin/env node
/**
 * WS-E (STEP 3AH-117) mutation battery — content/regenerate,
 * engagement/crm-export, engagement/reply and engagement/signal/status on the
 * canonical campaign ownership resolver.
 *
 * Each entry reintroduces one way a route could again take a campaign's owner
 * from one version row (LIMIT 1, newest) or the campaigns row alone, restore
 * its exact legacy check, accept a caller-named company in place of the
 * authorized one, authorize the role in the wrong company, treat CONFLICT or
 * UNOWNED as owned, turn a lookup failure into a denial, skip the ownership or
 * tenant check, compare tenants the wrong way round, act before authorizing,
 * or leak a database error. KILLED means the suite ran and at least one test
 * failed; a suite that cannot run, or an anchor that does not match EXACTLY
 * ONCE, is NOT a kill. A SURVIVOR means the tests do not constrain that
 * behaviour — strengthen the TEST, never weaken the mutation.
 *
 * The unmutated suite must pass first (green-baseline gate). Every mutation is
 * applied in place, EOL-normalised, and reverted in a `finally`.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = ['backend/tests/unit/wseS8CampaignOwnershipRoutes.test.ts'];
const REGEN = 'pages/api/content/regenerate.ts';
const CRM = 'pages/api/engagement/crm-export.ts';
const REPLY = 'pages/api/engagement/reply.ts';
const STATUS = 'pages/api/engagement/signal/status.ts';

/** `const ownership = …` built from one row, in the resolver's result shape. */
const legacyOwner = (indent, db, campaignExpr, mode) => {
  const i = indent;
  const query = mode === 'campaigns-row'
    ? `${db}.from('campaigns').select('company_id').eq('id', ${campaignExpr}).maybeSingle()`
    : mode === 'newest'
      ? `${db}.from('campaign_versions').select('company_id').eq('campaign_id', ${campaignExpr}).order('created_at', { ascending: false }).limit(1).maybeSingle()`
      : `${db}.from('campaign_versions').select('company_id').eq('campaign_id', ${campaignExpr}).limit(1).maybeSingle()`;
  return [
    `${i}const legacyRow = await ${query};`,
    `${i}const ownership = legacyRow.error`,
    `${i}  ? { status: 'LOOKUP_FAILED' as const }`,
    `${i}  : legacyRow.data?.company_id`,
    `${i}    ? { status: 'OWNED' as const, companyId: String(legacyRow.data.company_id) }`,
    `${i}    : { status: 'NOT_FOUND' as const };`,
  ].join('\n');
};

// ── content/regenerate ───────────────────────────────────────────────────────
const R_DB = "require('../../../backend/db/supabaseClient').supabase";
const R_OWN = '    const ownership = await resolveCampaignOwnership(asset.campaign_id);';
const R_LOOKUP = "    if (ownership.status === 'LOOKUP_FAILED') {\n      return res.status(503).json({";
const R_CLAIMS = '    const claimedCompanies = [authorizedCompanyId, req.query?.companyId, (req.body || {}).companyId]';
const R_CHECK = "    if (ownership.status !== 'OWNED' || claimedCompanies.some((claim) => claim !== ownership.companyId)) {";
const R_AUTHZ = '    const authorizedCompanyId = (req as NextApiRequest & { rbac?: RbacContext }).rbac?.companyId;';

const REGEN_MUTANTS = [
  { id: 'E1', name: 'owner = first matching version row (LIMIT 1)', from: R_OWN, to: legacyOwner('    ', R_DB, 'asset.campaign_id', 'first') },
  { id: 'E2', name: 'owner = newest version row', from: R_OWN, to: legacyOwner('    ', R_DB, 'asset.campaign_id', 'newest') },
  { id: 'E3', name: 'owner = campaigns row only', from: R_OWN, to: legacyOwner('    ', R_DB, 'asset.campaign_id', 'campaigns-row') },
  {
    id: 'E4', name: 'legacy binding restored: body company authorizes membership and is compared to one version row',
    edits: [
      { from: R_AUTHZ, to: '    const authorizedCompanyId = (req.body || {}).companyId;' },
      { from: R_OWN, to: legacyOwner('    ', R_DB, 'asset.campaign_id', 'first') },
      { from: R_CLAIMS, to: '    const claimedCompanies = [authorizedCompanyId]' },
    ],
  },
  { id: 'E5', name: 'query/role company substituted: the body claim is ignored', from: R_CLAIMS, to: '    const claimedCompanies = [req.query?.companyId ?? authorizedCompanyId]' },
  { id: 'E6', name: 'role authorized against the wrong company: only the body claim must match the owner', from: R_CLAIMS, to: '    const claimedCompanies = [(req.body || {}).companyId]' },
  { id: 'E7', name: 'CONFLICT treated as owned (first company)', from: R_CHECK, to: "    if (ownership.status === 'CONFLICT') Object.assign(ownership, { status: 'OWNED', companyId: ownership.companyIds[0] });\n" + R_CHECK },
  { id: 'E8', name: 'LOOKUP_FAILED converted to the ownership denial', from: R_LOOKUP, to: "    if (ownership.status === 'LOOKUP_FAILED') {\n      return res.status(403).json({ error: 'Access denied to asset' });\n      return res.status(503).json({" },
  { id: 'E9', name: 'UNOWNED allowed (adopted by the authorized company)', from: R_CHECK, to: "    if (ownership.status === 'UNOWNED') Object.assign(ownership, { status: 'OWNED', companyId: authorizedCompanyId });\n" + R_CHECK },
  { id: 'E10', name: 'ownership check bypassed', from: R_CHECK, to: '    if (false) {' },
  { id: 'E11', name: 'regenerate (side effect) before ownership and claim checks', from: R_OWN, to: `    await regenerateContentAsset({ assetId, instruction });\n${R_OWN}` },
  { id: 'E12', name: 'wrong tenant comparison (claims must DIFFER from the owner)', from: R_CHECK, to: "    if (ownership.status !== 'OWNED' || claimedCompanies.some((claim) => claim === ownership.companyId)) {" },
  { id: 'E13', name: 'tenant membership check result ignored', from: '    const access = await enforceCompanyAccess({ req, res, companyId: authorizedCompanyId });\n    if (!access) return;', to: '    const access = { userId: \'unknown\' };' },
  { id: 'E14', name: 'raw error message returned', from: "  } catch {\n    return res.status(500).json({ error: 'Failed to regenerate content' });", to: "  } catch (error) {\n    return res.status(500).json({ error: (error as Error).message });" },
].map((m) => ({ ...m, id: `regenerate:${m.id}`, file: REGEN }));

// ── engagement/crm-export ────────────────────────────────────────────────────
const C_OWN = '    const ownership = await resolveCampaignOwnership(signal.campaign_id);';
const C_LOOKUP = "    if (ownership.status === 'LOOKUP_FAILED') {\n      return res.status(503).json({";
const C_CHECK = "    if (ownership.status !== 'OWNED' || ownership.companyId !== String(organizationId)) {";
const C_DENY = "      return res.status(403).json({ error: 'Signal does not belong to caller organization' });";
const C_ACCESS = '    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });\n    if (!access) return;';
const C_LEGACY = [
  '    if (signal.campaign_id) {',
  '      const { data: version } = await supabase',
  "        .from('campaign_versions')",
  "        .select('company_id')",
  "        .eq('campaign_id', signal.campaign_id)",
  '        .limit(1)',
  '        .maybeSingle();',
  '      if (!version || version.company_id !== organizationId) {',
  "        return res.status(403).json({ error: 'Signal does not belong to caller organization' });",
  '      }',
  '    }',
].join('\n');
const CRM_MUTANTS = [
  { id: 'M1', name: 'owner = first matching version row (LIMIT 1)', from: C_OWN, to: legacyOwner('    ', 'supabase', 'signal.campaign_id', 'first') },
  { id: 'M2', name: 'owner = newest version row', from: C_OWN, to: legacyOwner('    ', 'supabase', 'signal.campaign_id', 'newest') },
  { id: 'M3', name: 'owner = campaigns row only', from: C_OWN, to: legacyOwner('    ', 'supabase', 'signal.campaign_id', 'campaigns-row') },
  {
    id: 'M4', name: 'legacy check restored exactly (LIMIT 1 version row, campaign-less signals unchecked)',
    edits: [
      { from: `${C_OWN}\n${C_LOOKUP}`, to: `    const ownership = { status: 'OWNED' as const, companyId: '' };\n    if (false) {\n      return res.status(503).json({` },
      { from: `${C_CHECK}\n${C_DENY}\n    }\n`, to: `${C_LEGACY}\n` },
    ],
  },
  { id: 'M5', name: 'caller/query company substituted in the ownership comparison', from: C_CHECK, to: "    if (ownership.status !== 'OWNED' || ownership.companyId !== String(req.query?.organization_id ?? req.query?.companyId ?? organizationId)) {" },
  { id: 'M6', name: 'caller/body alternate company substituted in the ownership comparison', from: C_CHECK, to: "    if (ownership.status !== 'OWNED' || ownership.companyId !== String((req.body || {}).company_id ?? organizationId)) {" },
  { id: 'M7', name: 'CONFLICT treated as owned (first company)', from: C_CHECK, to: "    if (ownership.status === 'CONFLICT') Object.assign(ownership, { status: 'OWNED', companyId: ownership.companyIds[0] });\n" + C_CHECK },
  { id: 'M8', name: 'LOOKUP_FAILED converted to the ownership denial', from: C_LOOKUP, to: `    if (ownership.status === 'LOOKUP_FAILED') {\n${C_DENY}\n      return res.status(503).json({` },
  { id: 'M9', name: 'UNOWNED allowed', from: C_CHECK, to: "    if (ownership.status === 'UNOWNED') Object.assign(ownership, { status: 'OWNED', companyId: String(organizationId) });\n" + C_CHECK },
  { id: 'M10', name: 'ownership check bypassed', from: C_CHECK, to: '    if (false) {' },
  { id: 'M11', name: 'tenant authorization bypassed', from: C_ACCESS, to: '' },
  {
    id: 'M12', name: 'export audit written before ownership is checked', from: C_OWN,
    to: `    await logAuditEvent({ operation: 'INSERT', table: 'engagement_crm_export', companyId: organizationId, userId: 'pre-auth', success: true, metadata: {} });\n${C_OWN}`,
  },
  { id: 'M13', name: 'wrong tenant comparison', from: C_CHECK, to: "    if (ownership.status !== 'OWNED' || ownership.companyId === String(organizationId)) {" },
  { id: 'M14', name: 'raw error message returned', from: "    return res.status(500).json({ error: 'Failed to export to CRM' });", to: '    return res.status(500).json({ error: (err as Error)?.message });' },
].map((m) => ({ ...m, id: `crm-export:${m.id}`, file: CRM }));

// ── engagement/reply ─────────────────────────────────────────────────────────
const P_OWN = '  const ownership = await resolveCampaignOwnership(signal.campaign_id);';
const P_LOOKUP = "  if (ownership.status === 'LOOKUP_FAILED') {\n    return { ok: false, code: 'CAMPAIGN_LOOKUP_ERROR'";
const P_CHECK = "  if (ownership.status !== 'OWNED' || ownership.companyId !== organizationId) {";
const P_CALL = '      const resolved = await resolveSignal(signalId, organizationId);';
const P_ACCESS = '    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });\n    if (!access) return;';
const P_ROLE = '      companyId: organizationId,\n      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],';
const P_LEGACY = [
  '  if (signal.campaign_id) {',
  '    const { data: version } = await supabase',
  "      .from('campaign_versions')",
  "      .select('company_id')",
  "      .eq('campaign_id', signal.campaign_id)",
  '      .limit(1)',
  '      .maybeSingle();',
  '    if (!version || version.company_id !== organizationId) {',
  "      return { ok: false, code: 'SIGNAL_TENANT_SCOPE', message: 'signal does not belong to caller organization' };",
  '    }',
  '  }',
].join('\n');
const REPLY_MUTANTS = [
  { id: 'M1', name: 'owner = first matching version row (LIMIT 1)', from: P_OWN, to: legacyOwner('  ', 'supabase', 'signal.campaign_id', 'first') },
  { id: 'M2', name: 'owner = newest version row', from: P_OWN, to: legacyOwner('  ', 'supabase', 'signal.campaign_id', 'newest') },
  { id: 'M3', name: 'owner = campaigns row only', from: P_OWN, to: legacyOwner('  ', 'supabase', 'signal.campaign_id', 'campaigns-row') },
  {
    id: 'M4', name: 'legacy check restored exactly (LIMIT 1 version row, campaign-less signals unchecked)',
    edits: [
      { from: `${P_OWN}\n${P_LOOKUP}`, to: "  const ownership = { status: 'OWNED' as const, companyId: '' };\n  if (false) {\n    return { ok: false, code: 'CAMPAIGN_LOOKUP_ERROR'" },
      { from: `${P_CHECK}\n    return { ok: false, code: 'SIGNAL_TENANT_SCOPE', message: 'signal does not belong to caller organization' };\n  }\n`, to: `${P_LEGACY}\n` },
    ],
  },
  { id: 'M5', name: 'caller/query company substituted for the authorized organization', from: P_CALL, to: '      const resolved = await resolveSignal(signalId, String(req.query?.organization_id ?? req.query?.companyId ?? organizationId));' },
  { id: 'M6', name: 'caller/body alternate company substituted for the authorized organization', from: P_CALL, to: '      const resolved = await resolveSignal(signalId, String((req.body || {}).company_id ?? organizationId));' },
  { id: 'M7', name: 'CONFLICT treated as owned (first company)', from: P_CHECK, to: "  if (ownership.status === 'CONFLICT') Object.assign(ownership, { status: 'OWNED', companyId: ownership.companyIds[0] });\n" + P_CHECK },
  { id: 'M8', name: 'LOOKUP_FAILED converted to not-found (404)', from: "        return retryable\n          ? res.status(503)", to: "        return retryable\n          ? res.status(404)" },
  { id: 'M9', name: 'UNOWNED allowed', from: P_CHECK, to: "  if (ownership.status === 'UNOWNED') Object.assign(ownership, { status: 'OWNED', companyId: organizationId });\n" + P_CHECK },
  { id: 'M10', name: 'ownership check bypassed', from: P_CHECK, to: '  if (false) {' },
  { id: 'M11', name: 'tenant authorization bypassed', from: P_ACCESS, to: '' },
  { id: 'M12', name: 'role authorized in the caller-named company instead of the authorized one', from: P_ROLE, to: '      companyId: String((req.body || {}).company_id ?? organizationId),\n      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],' },
  {
    id: 'M13', name: 'a reply row persisted before the signal ownership is resolved', from: P_CALL,
    to: `      await supabase.from('comment_replies').insert({ organization_id: organizationId, reply_text: replyText });\n${P_CALL}`,
  },
  { id: 'M14', name: 'wrong tenant comparison', from: P_CHECK, to: "  if (ownership.status !== 'OWNED' || ownership.companyId === organizationId) {" },
  { id: 'M15', name: 'raw database error returned on signal lookup', from: "    return { ok: false, code: 'SIGNAL_LOOKUP_FAILED', message: 'signal lookup is temporarily unavailable' };", to: "    return { ok: false, code: 'SIGNAL_LOOKUP_FAILED', message: error.message };" },
].map((m) => ({ ...m, id: `reply:${m.id}`, file: REPLY }));

// ── engagement/signal/status ─────────────────────────────────────────────────
const S_OWN = '    const ownership = await resolveCampaignOwnership(campaignId);';
const S_LOOKUP = "    if (ownership.status === 'LOOKUP_FAILED') {\n      return res.status(503).json({";
const S_CHECK = "    if (ownership.status !== 'OWNED' || ownership.companyId !== companyId) {";
const S_DENY = "      return res.status(403).json({ error: 'Campaign not accessible' });";
const S_LEGACY = [
  '    const { data: cv } = await supabase',
  "      .from('campaign_versions')",
  "      .select('campaign_id')",
  "      .eq('company_id', companyId)",
  "      .eq('campaign_id', (signal as { campaign_id: string }).campaign_id)",
  '      .limit(1)',
  '      .maybeSingle();',
  '',
  '    if (!cv && (signal as { campaign_id: string }).campaign_id) {',
].join('\n');
const STATUS_MUTANTS = [
  { id: 'M1', name: 'owner = first matching version row (LIMIT 1)', from: S_OWN, to: legacyOwner('    ', 'supabase', 'campaignId', 'first') },
  { id: 'M2', name: 'owner = newest version row', from: S_OWN, to: legacyOwner('    ', 'supabase', 'campaignId', 'newest') },
  { id: 'M3', name: 'owner = campaigns row only', from: S_OWN, to: legacyOwner('    ', 'supabase', 'campaignId', 'campaigns-row') },
  {
    id: 'M4', name: 'legacy any-version-row existence check restored exactly',
    edits: [
      { from: `${S_OWN}\n${S_LOOKUP}`, to: "    const ownership = { status: 'OWNED' as const, companyId: '' };\n    if (false) {\n      return res.status(503).json({" },
      { from: S_CHECK, to: S_LEGACY },
    ],
  },
  { id: 'M5', name: 'caller/query company substituted in the ownership comparison', from: S_CHECK, to: "    if (ownership.status !== 'OWNED' || ownership.companyId !== String(req.query?.companyId ?? companyId)) {" },
  { id: 'M6', name: 'caller/body alternate company substituted in the ownership comparison', from: S_CHECK, to: "    if (ownership.status !== 'OWNED' || ownership.companyId !== String((req.body || {}).company_id ?? companyId)) {" },
  { id: 'M7', name: 'CONFLICT treated as owned (first company)', from: S_CHECK, to: "    if (ownership.status === 'CONFLICT') Object.assign(ownership, { status: 'OWNED', companyId: ownership.companyIds[0] });\n" + S_CHECK },
  { id: 'M8', name: 'LOOKUP_FAILED converted to the ownership denial', from: S_LOOKUP, to: `    if (ownership.status === 'LOOKUP_FAILED') {\n${S_DENY}\n      return res.status(503).json({` },
  { id: 'M9', name: 'UNOWNED allowed', from: S_CHECK, to: "    if (ownership.status === 'UNOWNED') Object.assign(ownership, { status: 'OWNED', companyId });\n" + S_CHECK },
  { id: 'M10', name: 'ownership check bypassed', from: S_CHECK, to: '    if (false) {' },
  { id: 'M11', name: 'tenant authorization bypassed', from: '    if (!access) return;', to: '' },
  {
    id: 'M12', name: 'status written before ownership is checked', from: S_OWN,
    to: `    await supabase.from('campaign_activity_engagement_signals').update({ signal_status: status }).eq('id', signalId);\n${S_OWN}`,
  },
  { id: 'M13', name: 'wrong tenant comparison', from: S_CHECK, to: "    if (ownership.status !== 'OWNED' || ownership.companyId === companyId) {" },
  { id: 'M14', name: 'raw database error returned on update', from: "      return res.status(500).json({ error: 'Failed to update signal status' });", to: '      return res.status(500).json({ error: error.message });' },
].map((m) => ({ ...m, id: `signal/status:${m.id}`, file: STATUS }));

const MUTATIONS = [...REGEN_MUTANTS, ...CRM_MUTANTS, ...REPLY_MUTANTS, ...STATUS_MUTANTS];

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
  const original = fs.readFileSync(m.file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const edits = m.edits || [{ from: m.from, to: m.to }];
  let mutated = original;
  let anchorProblem = null;
  for (const e of edits) {
    const from = e.from.split('\n').join(eol);
    const to = e.to.split('\n').join(eol);
    const hits = mutated.split(from).length - 1;
    if (hits !== 1) { anchorProblem = `anchor matched ${hits}x (expected exactly 1): ${e.from.slice(0, 60)}`; break; }
    mutated = mutated.replace(from, () => to);
  }
  if (anchorProblem) {
    results.push({ ...m, verdict: `NOT APPLICABLE — ${anchorProblem}` });
    continue;
  }
  fs.writeFileSync(m.file, mutated, 'utf8');
  let run;
  try {
    run = runSuite();
  } finally {
    fs.writeFileSync(m.file, original, 'utf8');
  }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ WS-E MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(22)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
