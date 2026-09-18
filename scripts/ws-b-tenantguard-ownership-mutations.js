#!/usr/bin/env node
/**
 * WS-B (STEP 3AH-114) mutation battery — TenantGuard.requireCampaignTenantAccess
 * on the canonical campaign ownership resolver.
 *
 * Each entry reintroduces one way the shared campaign tenant hook could again
 * pick an owner, admit a caller it should refuse, hide a lookup failure, or
 * let a side effect run before authorization. KILLED means the suite ran and
 * at least one test failed; a suite that cannot run, or an anchor that does
 * not match EXACTLY ONCE, is NOT a kill and is reported as such. A SURVIVOR
 * means the tests do not constrain that behaviour — strengthen the TEST,
 * never weaken the mutation.
 *
 * A mutation may carry several edits (`edits`); every edit must match exactly
 * once. The unmutated suite must pass first (green-baseline gate). Every
 * mutation is applied in place, EOL-normalised, and reverted in a `finally`.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = [
  'backend/tests/unit/tenantGuardCanonicalOwnership.test.ts',
  // Its foreign-campaign leak assertions now exempt exactly the guard's
  // canonical campaign_versions ownership read; L1–L3 prove that exemption
  // cannot hide a real read.
  'backend/tests/unit/analyticsSecurityAudit.test.ts',
];
const GUARD = 'backend/security/TenantGuard.ts';
const ROUTE = 'pages/api/campaigns/save-strategy.ts';
const REPORT = 'pages/api/analytics/report.ts';
const REPORT_GUARD = '      const campaignAccess = await requireCampaignTenantAccess(req, res, campaignId);';

const OWNED = [
  "  if (ownership.status === 'OWNED') {",
  '    return requireTenantAccess(req, res, ownership.companyId, options);',
  '  }',
].join('\n');

const MUTATIONS = [
  {
    id: 'B1', name: 'CONFLICT resolves to one of its companies (the first)',
    file: GUARD, from: OWNED,
    to: [
      OWNED,
      "  if (ownership.status === 'CONFLICT') {",
      '    return requireTenantAccess(req, res, ownership.companyIds[0], options);',
      '  }',
    ].join('\n'),
  },
  {
    id: 'B2', name: 'CONFLICT is authorized for a member of one of the conflicting companies',
    file: GUARD, from: OWNED,
    to: [
      OWNED,
      "  if (ownership.status === 'CONFLICT') {",
      '    const principal = await resolvePrincipal(req);',
      '    if (principal.ok === true) {',
      '      for (const companyId of ownership.companyIds) {',
      '        const decision = await assertTenantAccess({',
      '          userId: principal.principal.userId, supabaseUid: principal.principal.supabaseUid, organizationId: companyId, options,',
      '        });',
      '        if (decision.ok === true) return requireTenantAccess(req, res, companyId, options);',
      '      }',
      '    }',
      '  }',
    ].join('\n'),
  },
  {
    id: 'B3', name: 'LOOKUP_FAILED answered as NOT_FOUND',
    file: GUARD,
    from: [
      '    res.status(503).json({',
      "      error: 'Campaign ownership check is temporarily unavailable. Please try again.',",
      "      code: 'CAMPAIGN_LOOKUP_ERROR',",
      '      retryable: true,',
      '    });',
    ].join('\n'),
    to: "    res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });",
  },
  {
    id: 'B4', name: 'UNOWNED allowed (adopted by the company the caller names)',
    file: GUARD, from: OWNED,
    to: [
      OWNED,
      "  if (ownership.status === 'UNOWNED') {",
      '    return requireTenantAccess(req, res, extractTenantIdFromRequest(req), options);',
      '  }',
    ].join('\n'),
  },
  {
    id: 'B5a', name: 'tenant comparison reversed in the membership decision',
    file: GUARD,
    // The analytics suite's hand-written client has no .neq(), so this mutant
    // would crash that suite's process instead of failing a test; it is judged
    // by the focused suite, whose harness implements .neq().
    suite: ['backend/tests/unit/tenantGuardCanonicalOwnership.test.ts'],
    from: "\n      .eq('user_id', userId)\n      .eq('company_id', organizationId)\n",
    to: "\n      .eq('user_id', userId)\n      .neq('company_id', organizationId)\n",
  },
  {
    id: 'B5b', name: 'ownership status test inverted (non-OWNED reaches the tenant guard)',
    file: GUARD,
    from: "  if (ownership.status === 'OWNED') {",
    to: "  if (ownership.status !== 'OWNED' && ownership.status !== 'INVALID' && ownership.status !== 'LOOKUP_FAILED') {",
  },
  {
    id: 'B6', name: 'canonical resolver bypassed (legacy campaigns.company_id read restored)',
    file: GUARD,
    from: '  const ownership = await resolveCampaignOwnership(campaignId);',
    to: [
      "  const legacy = campaignId ? await supabase.from('campaigns').select('company_id').eq('id', campaignId).maybeSingle() : null;",
      '  const legacyOwner = legacy && !legacy.error ? (legacy.data as { company_id?: string | null } | null)?.company_id : null;',
      '  const ownership = !campaignId',
      "    ? { status: 'INVALID' as const }",
      "    : legacy?.error ? { status: 'LOOKUP_FAILED' as const }",
      "      : legacyOwner ? { status: 'OWNED' as const, companyId: String(legacyOwner) } : { status: 'NOT_FOUND' as const };",
    ].join('\n'),
  },
  {
    id: 'B7a', name: 'authorization moved after the side effect (real caller route)',
    file: ROUTE,
    edits: [
      { from: '    const access = await requireCampaignTenantAccess(req, res, campaignId);\n    if (!access) return;\n', to: '' },
      { from: '    if (strategyError) {', to: '    const access = await requireCampaignTenantAccess(req, res, campaignId);\n    if (!access) return;\n    if (strategyError) {' },
    ],
  },
  {
    id: 'B7b', name: 'the authorization result is ignored (side effect runs after a denial)',
    file: ROUTE,
    from: '    const access = await requireCampaignTenantAccess(req, res, campaignId);\n    if (!access) return;\n',
    to: '    await requireCampaignTenantAccess(req, res, campaignId);\n',
  },
  {
    id: 'B8a', name: 'caller-controlled ownership: the named company overrides the canonical owner',
    file: GUARD,
    from: '    return requireTenantAccess(req, res, ownership.companyId, options);',
    to: '    return requireTenantAccess(req, res, extractTenantIdFromRequest(req) ?? ownership.companyId, options);',
  },
  {
    id: 'B8b', name: 'caller-controlled ownership: a conflict is settled by the company the caller names',
    file: GUARD, from: OWNED,
    to: [
      OWNED,
      "  if (ownership.status === 'CONFLICT') {",
      '    const claimed = extractTenantIdFromRequest(req);',
      '    if (claimed && ownership.companyIds.includes(claimed)) return requireTenantAccess(req, res, claimed, options);',
      '  }',
    ].join('\n'),
  },
  {
    id: 'B9', name: 'INVALID performs a lookup and answers NOT_FOUND',
    file: GUARD,
    from: "  if (ownership.status === 'INVALID') {\n    res.status(400).json({ error: 'campaignId required', code: 'NO_RESOURCE_ID' });",
    to: "  if (ownership.status === 'INVALID') {\n    await supabase.from('campaigns').select('company_id').eq('id', String(campaignId)).maybeSingle();\n    res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });",
  },
  {
    id: 'B10', name: 'CONFLICT gets its own answer (a new existence/conflict oracle)',
    file: GUARD,
    from: "    logger.warn('campaign_ownership_conflict_denied', { distinct_company_count: ownership.companyIds.length });",
    to: [
      "    logger.warn('campaign_ownership_conflict_denied', { distinct_company_count: ownership.companyIds.length });",
      "    res.status(409).json({ error: 'Campaign ownership conflict', code: 'CAMPAIGN_OWNERSHIP_CONFLICT' });",
      '    return null;',
    ].join('\n'),
  },
  {
    id: 'B11', name: 'conflict telemetry carries the conflicting company ids',
    file: GUARD,
    from: '{ distinct_company_count: ownership.companyIds.length }',
    to: '{ distinct_company_count: ownership.companyIds.length, company_ids: ownership.companyIds }',
  },
  {
    id: 'L1', name: 'a foreign campaign_versions DATA read before authorization hides behind the ownership exemption',
    file: REPORT, from: REPORT_GUARD,
    to: `      await supabase.from('campaign_versions').select('*').eq('campaign_id', campaignId);
${REPORT_GUARD}`,
  },
  {
    id: 'L2', name: 'a second ownership-shaped campaign_versions read of the foreign campaign',
    file: REPORT, from: REPORT_GUARD,
    to: `      await supabase.from('campaign_versions').select('company_id').eq('campaign_id', campaignId);
${REPORT_GUARD}`,
  },
  {
    id: 'L3', name: 'foreign campaign metrics read before authorization',
    file: REPORT, from: REPORT_GUARD,
    to: `      await supabase.from('content_performance_metrics').select('*').eq('campaign_id', campaignId);
${REPORT_GUARD}`,
  },
];

function runSuite(suite = SUITE) {
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
    run = runSuite(m.suite);
  } finally {
    fs.writeFileSync(m.file, original, 'utf8');
  }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ WS-B MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(5)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
