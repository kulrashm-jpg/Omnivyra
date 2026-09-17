#!/usr/bin/env node
/**
 * WS-D (STEP 3AH-116) mutation battery — /api/campaigns/:id and the five
 * campaign-version writers on the canonical campaign ownership resolver.
 *
 * Each entry reintroduces one way a route could again choose an owner from one
 * row (LIMIT 1, first row, the campaigns row alone), accept a caller-named
 * company, treat CONFLICT as owned or a lookup failure as not-found, skip or
 * postpone authorization, lose a tenant filter on a destructive write, report a
 * delete that removed nothing, pick an arbitrary "latest" version, or leak a
 * database error. KILLED means the suite ran and at least one test failed; a
 * suite that cannot run, or an anchor that does not match EXACTLY ONCE, is NOT
 * a kill. A SURVIVOR means the tests do not constrain that behaviour —
 * strengthen the TEST, never weaken the mutation.
 *
 * The unmutated suites must pass first (green-baseline gate). Every mutation is
 * applied in place, EOL-normalised, and reverted in a `finally`.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const BY_ID_SUITE = ['backend/tests/unit/wsdCampaignByIdOwnership.test.ts'];
const WRITERS_SUITE = ['backend/tests/unit/wsdVersionWritersOwnership.test.ts'];
const BY_ID = 'pages/api/campaigns/[id].ts';
const W = (name) => `pages/api/campaigns/[id]/${name}.ts`;

// ── shared anchors ───────────────────────────────────────────────────────────
const RESOLVE = '  const ownership = await resolveCampaignOwnership(id);';
const NOT_OWNED = "  if (ownership.status !== 'OWNED') {\n    return res.status(404).json({ error: 'Campaign not found' });\n  }";
const LOOKUP_503 = "  if (ownership.status === 'LOOKUP_FAILED') {\n    return res.status(503).json({";
const SORT = '  const [latest] = [...(data ?? [])].sort(compareLatestVersionFirst);';

const legacyNewestOwner = [
  "  const legacyRow = await supabase.from('campaign_versions').select('company_id').eq('campaign_id', id)",
  "    .order('created_at', { ascending: false }).limit(1).maybeSingle();",
  '  const ownership = legacyRow.error',
  "    ? { status: 'LOOKUP_FAILED' as const }",
  "    : legacyRow.data?.company_id",
  "      ? { status: 'OWNED' as const, companyId: String(legacyRow.data.company_id), orphan: false, sources: { campaignRecord: true, versionRowCount: 1 } }",
  "      : { status: 'NOT_FOUND' as const };",
].join('\n');
const legacyFirstRowOwner = legacyNewestOwner.replace(".order('created_at', { ascending: false }).limit(1)", '.limit(1)');
const campaignRowOnlyOwner = [
  "  const legacyRow = await supabase.from('campaigns').select('company_id').eq('id', id).maybeSingle();",
  '  const ownership = legacyRow.error',
  "    ? { status: 'LOOKUP_FAILED' as const }",
  "    : legacyRow.data?.company_id",
  "      ? { status: 'OWNED' as const, companyId: String(legacyRow.data.company_id), orphan: false, sources: { campaignRecord: true, versionRowCount: 0 } }",
  "      : { status: 'NOT_FOUND' as const };",
].join('\n');
const conflictAsOwned = [
  "  if (ownership.status !== 'OWNED' && ownership.status !== 'CONFLICT') {",
  "    return res.status(404).json({ error: 'Campaign not found' });",
  '  }',
  "  if (ownership.status === 'CONFLICT') Object.assign(ownership, { status: 'OWNED', companyId: ownership.companyIds[0], orphan: false, sources: ownership.sources });",
].join('\n');

const writerMutants = (name, extra) => {
  const file = W(name);
  const roleAnchor = ['approve-strategy', 'revise-strategy'].includes(name)
    ? '  if (!role || role !== Role.COMPANY_ADMIN) {'
    : "  if (role !== 'COMPANY_ADMIN') {";
  return [
    { id: 'W1', name: 'owner = newest version row (created_at DESC LIMIT 1)', file, from: RESOLVE, to: legacyNewestOwner },
    { id: 'W2', name: 'owner = first matching version row (LIMIT 1, no order)', file, from: RESOLVE, to: legacyFirstRowOwner },
    { id: 'W3', name: 'owner = campaigns row only', file, from: RESOLVE, to: campaignRowOnlyOwner },
    {
      id: 'W4', name: 'caller-named company substituted for the canonical owner', file,
      from: '  const companyId = ownership.companyId;',
      to: '  const companyId = String(req.query.companyId ?? (req.body || {}).companyId ?? ownership.companyId);',
    },
    { id: 'W5', name: 'COMPANY_ADMIN authorization bypassed', file, from: roleAnchor, to: '  if (false) {' },
    {
      id: 'W6', name: 'a write happens before ownership and authorization', file, from: RESOLVE,
      to: `  await supabase.from('audit_logs').insert({ action: 'PRE_AUTHORIZATION_WRITE', company_id: null });\n${RESOLVE}`,
    },
    { id: 'W7', name: 'CONFLICT treated as owned (first company)', file, from: NOT_OWNED, to: conflictAsOwned },
    { id: 'W8', name: 'ownership lookup failure answered as not-found', file, from: LOOKUP_503, to: "  if (ownership.status === 'LOOKUP_FAILED') {\n    return res.status(404).json({ error: 'Campaign not found' });\n    return res.status(503).json({" },
    {
      id: 'W9', name: 'latest version by created_at text only (NULLS FIRST, no tie-breaks)', file, from: SORT,
      to: '  const [latest] = [...(data ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));',
    },
    { id: 'W10', name: 'latest version = first row returned (no ordering)', file, from: SORT, to: '  const [latest] = [...(data ?? [])];' },
    ...extra.map((m) => ({ ...m, file })),
  ].map((m) => ({ ...m, id: `${name}:${m.id}`, suite: WRITERS_SUITE }));
};

const MUTATIONS = [
  ...writerMutants('approve-strategy', [
    { id: 'W11', name: 'raw database error returned', from: "  } catch {\n    return res.status(500).json({ error: 'Failed to approve strategy' });", to: "  } catch (err) {\n    return res.status(500).json({ error: (err as Error).message });" },
  ]),
  ...writerMutants('revise-strategy', [
    { id: 'W11', name: 'raw database error returned', from: "  } catch {\n    return res.status(500).json({ error: 'Failed to revise strategy' });", to: "  } catch (err) {\n    return res.status(500).json({ error: (err as Error).message });" },
  ]),
  ...writerMutants('propose-frequency-rebalance', [
    { id: 'W11', name: 'raw database error returned', from: "    return res.status(500).json({ error: 'Failed to save rebalance proposal' });", to: '    return res.status(500).json({ error: `Failed to save rebalance proposal: ${insertError.message}` });' },
    { id: 'W12', name: 'previous version not restricted to approved versions', from: "latestCompanyVersion(companyId, id, 'approved')", to: 'latestCompanyVersion(companyId, id)' },
  ]),
  ...writerMutants('approve-frequency-rebalance', [
    { id: 'W11', name: 'raw database error returned', from: "    return res.status(500).json({ error: 'Failed to approve rebalance' });", to: '    return res.status(500).json({ error: `Failed to approve rebalance: ${approvedError.message}` });' },
    { id: 'W12', name: 'proposal not restricted to proposed_rebalance versions', from: "latestCompanyVersion(companyId, id, 'proposed_rebalance')", to: 'latestCompanyVersion(companyId, id)' },
    { id: 'W13', name: 'raw database error returned on apply', from: "      return res.status(500).json({ error: 'Failed to apply frequency changes' });", to: '      return res.status(500).json({ error: `Failed to apply frequency changes: ${updateError.message}` });' },
  ]),
  ...writerMutants('reject-frequency-rebalance', [
    { id: 'W11', name: 'raw database error returned', from: "    return res.status(500).json({ error: 'Failed to reject rebalance' });", to: '    return res.status(500).json({ error: `Failed to reject rebalance: ${rejectedError.message}` });' },
    { id: 'W12', name: 'proposal not restricted to proposed_rebalance versions', from: "latestCompanyVersion(companyId, id, 'proposed_rebalance')", to: 'latestCompanyVersion(companyId, id)' },
  ]),

  // ── /api/campaigns/:id ──────────────────────────────────────────────────────
  ...[
    {
      id: 'D1', name: 'legacy local resolver: campaigns row preferred, else LIMIT 1 version row',
      from: RESOLVE,
      to: [
        "  const campRow = await supabase.from('campaigns').select('company_id').eq('id', id).maybeSingle();",
        "  const anyRow = await supabase.from('campaign_versions').select('company_id').eq('campaign_id', id).limit(1).maybeSingle();",
        '  const direct = campRow.data?.company_id ?? anyRow.data?.company_id;',
        '  const ownership = direct',
        "    ? { status: 'OWNED' as const, companyId: String(direct), orphan: !campRow.data, sources: { campaignRecord: Boolean(campRow.data?.company_id), versionRowCount: 1 } }",
        "    : { status: 'NOT_FOUND' as const };",
      ].join('\n'),
    },
    { id: 'D2', name: 'owner = newest version row (LIMIT 1)', from: RESOLVE, to: legacyNewestOwner },
    {
      id: 'D3', name: 'caller-named company substituted for the canonical owner',
      from: '  const campaignCompanyId = ownership.companyId;',
      to: '  const campaignCompanyId = String(req.query.companyId ?? (req.body || {}).companyId ?? ownership.companyId);',
    },
    { id: 'D4', name: 'tenant authorization result ignored', from: '  if (!tenantContext) return;', to: '' },
    { id: 'D5', name: 'role gate result ignored', from: '    if (!roleGate) return;', to: '' },
    {
      id: 'D6', name: 'destructive write before ownership and authorization', from: RESOLVE,
      to: `  if (req.method === 'DELETE') await supabase.from('scheduled_posts').delete().eq('campaign_id', id);\n${RESOLVE}`,
    },
    { id: 'D7', name: 'CONFLICT treated as owned (first company)', from: NOT_OWNED, to: conflictAsOwned },
    { id: 'D8', name: 'ownership lookup failure answered as not-found', from: LOOKUP_503, to: "  if (ownership.status === 'LOOKUP_FAILED') {\n    return res.status(404).json({ error: 'Campaign not found' });\n    return res.status(503).json({" },
    {
      id: 'D9', name: 'campaign_versions DELETE without the tenant filter',
      from: "        .eq('campaign_id', id)\n        .eq('company_id', campaignCompanyId)\n        .select('id');",
      to: "        .eq('campaign_id', id)\n        .select('id');",
    },
    { id: 'D10', name: 'company-bearing dependent tables deleted without the tenant filter', from: '        if (companyBound) query = query.eq(\'company_id\', campaignCompanyId);', to: '' },
    { id: 'D11', name: 'campaigns DELETE without the tenant filter', from: '        : campaignDelete.eq(\'company_id\', campaignCompanyId);', to: '        : campaignDelete;' },
    { id: 'D12', name: 'dependent delete errors swallowed (continues destroying)', from: '        if (dependentError && !MISSING_TABLE_CODES.has(String(dependentError.code))) {', to: '        if (false) {' },
    { id: 'D13', name: 'success reported when nothing authorized was deleted', from: '      if ((deletedCampaigns ?? []).length + (deletedVersions ?? []).length === 0) {', to: '      if (false) {' },
    {
      id: 'D14', name: 'versions deleted before the campaigns row (a partial state loses the owner)',
      edits: [
        {
          from: [
            '      const { data: deletedVersions, error: versionsError } = await supabase',
            "        .from('campaign_versions')",
            '        .delete()',
            "        .eq('campaign_id', id)",
            "        .eq('company_id', campaignCompanyId)",
            "        .select('id');",
            '      if (versionsError) {',
            "        console.error('Error deleting campaign versions:', versionsError.code);",
            "        return res.status(500).json({ error: 'Failed to delete campaign' });",
            '      }',
            '',
          ].join('\n'),
          to: '',
        },
        {
          from: "      let campaignDelete = supabase.from('campaigns').delete().eq('id', id);",
          to: [
            '      const { data: deletedVersions, error: versionsError } = await supabase',
            "        .from('campaign_versions')",
            '        .delete()',
            "        .eq('campaign_id', id)",
            "        .eq('company_id', campaignCompanyId)",
            "        .select('id');",
            '      if (versionsError) {',
            "        return res.status(500).json({ error: 'Failed to delete campaign' });",
            '      }',
            "      let campaignDelete = supabase.from('campaigns').delete().eq('id', id);",
          ].join('\n'),
        },
      ],
    },
    { id: 'D15', name: 'an unowned campaigns row is left behind by DELETE', from: '        ? campaignDelete.is(\'company_id\', null)', to: '        ? campaignDelete.eq(\'company_id\', campaignCompanyId)' },
    { id: 'D16', name: 'PUT does not bind an unowned campaigns row to its owner', from: '          ...(campaignRowUnowned && { company_id: campaignCompanyId }),\n', to: '' },
    { id: 'D17', name: 'PUT reports success when no row was updated', from: '      if (!campaign) {', to: '      if (false) {' },
    {
      id: 'D18', name: 'raw database error returned by DELETE',
      from: "        console.error('Error deleting campaign:', error.code);\n        return res.status(500).json({ error: 'Failed to delete campaign' });",
      to: "        return res.status(500).json({ error: `Failed to delete campaign: ${error.message}` });",
    },
  ].map((m) => ({ ...m, id: `[id]:${m.id}`, file: BY_ID, suite: BY_ID_SUITE })),
];

function runSuite(suite) {
  try {
    execFileSync(process.execPath, [JEST, ...suite, '--runInBand', '--forceExit', '--silent'], { stdio: 'pipe', encoding: 'utf8', timeout: 600_000 });
    return { passed: true, detail: 'suite passed' };
  } catch (err) {
    const out = String(err.stdout || '') + String(err.stderr || '');
    const hit = out.match(/Tests:\s+(\d+) failed/);
    if (hit) return { passed: false, behavioural: true, detail: `${hit[1]} test(s) failed` };
    return { passed: false, behavioural: false, detail: /Test suite failed to run/.test(out) ? 'suite failed to RUN' : 'suite failed (no test count)' };
  }
}

for (const suite of [BY_ID_SUITE, WRITERS_SUITE]) {
  const baseline = runSuite(suite);
  if (!baseline.passed) {
    console.error(`GREEN-BASELINE GATE FAILED for ${suite} (${baseline.detail}) — refusing to run mutations.`);
    process.exit(2);
  }
}
console.log('green baseline: unmutated suites pass');

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
    run = runSuite(m.suite);
  } finally {
    fs.writeFileSync(m.file, original, 'utf8');
  }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ WS-D MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(36)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
