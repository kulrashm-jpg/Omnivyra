#!/usr/bin/env node
/**
 * WS-C (STEP 3AH-115) mutation battery — POST /api/campaigns create-flow
 * ownership binding and id collision protection.
 *
 * Each entry reintroduces one way the create path could again adopt or
 * re-create an existing campaign, bind the wrong tenant (or none), hide a
 * lookup failure, write before the id is proven free, or leak a database
 * error. KILLED means the suite ran and at least one test failed; a suite that
 * cannot run, or an anchor that does not match EXACTLY ONCE, is NOT a kill and
 * is reported as such. A SURVIVOR means the tests do not constrain that
 * behaviour — strengthen the TEST, never weaken the mutation.
 *
 * A mutation may carry several edits (`edits`); every edit must match exactly
 * once. The unmutated suite must pass first (green-baseline gate). Every
 * mutation is applied in place, EOL-normalised, and reverted in a `finally`.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = ['backend/tests/unit/campaignCreateOwnershipBinding.test.ts'];
const ROUTE = 'pages/api/campaigns/index.ts';

const PRECHECK = [
  '      const existing = await resolveCampaignOwnership(requestedId);',
  "      if (existing.status === 'LOOKUP_FAILED') return res.status(503).json(CAMPAIGN_LOOKUP_FAILED);",
  "      if (existing.status !== 'NOT_FOUND') return res.status(409).json(CAMPAIGN_ID_TAKEN);",
].join('\n');
const TAKEN_LINE = "      if (existing.status !== 'NOT_FOUND') return res.status(409).json(CAMPAIGN_ID_TAKEN);";
const LOOKUP_LINE = "      if (existing.status === 'LOOKUP_FAILED') return res.status(503).json(CAMPAIGN_LOOKUP_FAILED);";
const BOUND_CHECK = '      if (bound.status !== \'OWNED\' || bound.companyId !== ownerCompanyId) {';

const MUTATIONS = [
  {
    id: 'C1', name: 'existing ids are no longer refused (collision check removed)',
    from: TAKEN_LINE, to: '',
  },
  {
    id: 'C2', name: 'only a foreign OWNED id is refused (same-tenant re-create allowed)',
    from: TAKEN_LINE,
    to: "      if (existing.status === 'OWNED' && existing.companyId !== ownerCompanyId) return res.status(409).json(CAMPAIGN_ID_TAKEN);",
  },
  {
    id: 'C3', name: 'orphan and unowned ids are adoptable through create',
    from: TAKEN_LINE,
    to: "      if (existing.status === 'CONFLICT' || (existing.status === 'OWNED' && !existing.orphan)) return res.status(409).json(CAMPAIGN_ID_TAKEN);",
  },
  {
    id: 'C4a', name: 'LOOKUP_FAILED treated as NOT_FOUND (create proceeds)',
    edits: [
      { from: LOOKUP_LINE, to: '' },
      { from: TAKEN_LINE, to: "      if (existing.status !== 'NOT_FOUND' && existing.status !== 'LOOKUP_FAILED') return res.status(409).json(CAMPAIGN_ID_TAKEN);" },
    ],
  },
  {
    id: 'C4b', name: 'LOOKUP_FAILED answered as a collision instead of a retryable 503',
    from: LOOKUP_LINE,
    to: "      if (existing.status === 'LOOKUP_FAILED') return res.status(409).json(CAMPAIGN_ID_TAKEN);",
  },
  {
    id: 'C5', name: 'campaigns row created with NULL ownership (company_id dropped)',
    from: '        id: requestedId,\n        company_id: ownerCompanyId,\n',
    to: '        id: requestedId,\n',
  },
  {
    id: 'C6', name: 'caller-controlled binding: the body company_id owns the version row',
    from: '          company_id: ownerCompanyId,\n          campaign_id: (campaign as { id: string }).id,',
    to: '          company_id: campaignData.company_id ?? ownerCompanyId,\n          campaign_id: (campaign as { id: string }).id,',
  },
  {
    id: 'C7', name: 'post-create binding verification removed',
    from: BOUND_CHECK, to: '      if (false) {',
  },
  {
    id: 'C8', name: 'verification failure keeps this request’s rows (no rollback)',
    from: `${BOUND_CHECK}\n        await discardCreatedCampaign((campaign as { id: string }).id, ownerCompanyId);`,
    to: BOUND_CHECK,
  },
  {
    id: 'C9', name: 'rollback scope too broad (deletes every version row of the id, including a foreign one)',
    from: "      const { error } = await ownedDbTable(table).delete().eq(key, campaignId).eq('company_id', ownerCompanyId);",
    to: "      const { error } = await ownedDbTable(table).delete().eq(key, campaignId);",
  },
  {
    id: 'C19', name: 'a rollback delete that returns an error is silently swallowed',
    from: "      if (error) failures.push(`${table}:${error.code ?? 'error'}`);",
    to: '      void error;',
  },
  {
    id: 'C10', name: 'a failed version insert leaves the campaigns row behind',
    from: "        await discardCreatedCampaign((campaign as { id: string }).id, ownerCompanyId);\n        return res.status(500).json({ error: 'Failed to create campaign mapping' });",
    to: "        return res.status(500).json({ error: 'Failed to create campaign mapping' });",
  },
  {
    id: 'C11a', name: 'raw database error leaked on campaigns insert failure',
    from: "        return res.status(500).json({ error: 'Failed to create campaign' });",
    to: "        return res.status(500).json({ error: 'Failed to create campaign', details: error.message });",
  },
  {
    id: 'C11b', name: 'raw database error leaked on version insert failure',
    from: "        return res.status(500).json({ error: 'Failed to create campaign mapping' });",
    to: "        return res.status(500).json({ error: 'Failed to create campaign mapping', details: versionError.message });",
  },
  {
    id: 'C12', name: 'losing the primary-key race is a 500 with the raw error',
    from: "        if (error.code === '23505') return res.status(409).json(CAMPAIGN_ID_TAKEN);",
    to: "        if (error.code === '23505') return res.status(500).json({ error: 'Failed to create campaign', details: error.message });",
  },
  {
    id: 'C13', name: 'the id check runs after the campaigns insert (side effect before binding)',
    edits: [
      { from: PRECHECK, to: '' },
      {
        from: '      const planning_context = campaignData.planning_context ?? campaignData.planningContext ?? null;',
        to: `${PRECHECK}\n      const planning_context = campaignData.planning_context ?? campaignData.planningContext ?? null;`,
      },
    ],
  },
  {
    id: 'C14', name: 'caller id accepted without UUID validation',
    from: "      if (idSupplied && (typeof requestedIdRaw !== 'string' || !UUID_RE.test(requestedIdRaw.trim()))) {",
    to: "      if (idSupplied && typeof requestedIdRaw !== 'string' && typeof requestedIdRaw !== 'number') {",
  },
  {
    id: 'C15', name: 'caller id not canonicalised (a case variant bypasses the collision check)',
    from: '      const requestedId = idSupplied ? String(requestedIdRaw).trim().toLowerCase() : randomUUID();',
    to: '      const requestedId = idSupplied ? String(requestedIdRaw).trim() : randomUUID();',
  },
  {
    id: 'C16', name: 'id existence answered before authorization (an oracle for unauthorized callers)',
    from: '    let requester: { id: string; role: string } | null = null;',
    to: [
      "    if (req.method === 'POST' && req.body?.id) {",
      '      const probe = await resolveCampaignOwnership(String(req.body.id).toLowerCase());',
      "      if (probe.status !== 'NOT_FOUND') return res.status(409).json(CAMPAIGN_ID_TAKEN);",
      '    }',
      '    let requester: { id: string; role: string } | null = null;',
    ].join('\n'),
  },
  {
    id: 'C17', name: 'distinct collision answers (own vs foreign) — an ownership oracle',
    from: TAKEN_LINE,
    to: [
      "      if (existing.status === 'OWNED' && existing.companyId === ownerCompanyId) return res.status(409).json({ ...CAMPAIGN_ID_TAKEN, owner: 'self' });",
      TAKEN_LINE,
    ].join('\n'),
  },
  {
    id: 'C18', name: 'ownership bound to the body company_id instead of the authorized company',
    from: '      const ownerCompanyId = UUID_RE.test(companyId) ? companyId.toLowerCase() : companyId;',
    to: "      const ownerCompanyId = String(req.body?.company_id ?? companyId);",
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
  fs.writeFileSync(file, mutated, 'utf8');
  let run;
  try {
    run = runSuite();
  } finally {
    fs.writeFileSync(file, original, 'utf8');
  }
  results.push({ ...m, verdict: run.passed ? `SURVIVED (${run.detail})` : run.behavioural ? `KILLED (${run.detail})` : `NOT BEHAVIOURAL (${run.detail})` });
}

console.log('\n============ WS-C MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(5)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
