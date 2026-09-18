#!/usr/bin/env node
/**
 * WS-A (STEP 3AH-113) mutation battery — canonical campaign ownership resolver,
 * latest-version ordering, and shadow safety.
 *
 * Each entry reintroduces one way the resolver could again pick an owner by
 * precedence or row order, hide a lookup failure, or let the shadow change a
 * request. KILLED means the suite ran and at least one test failed; a suite
 * that cannot run, or an anchor that does not match EXACTLY ONCE, is NOT a
 * kill and is reported as such. A SURVIVOR means the tests do not constrain
 * that behaviour — strengthen the TEST, never weaken the mutation.
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
  'backend/tests/unit/campaignCanonicalOwnershipResolver.test.ts',
  'backend/tests/unit/campaignOwnershipShadow.test.ts',
];
const RESOLVER = 'backend/services/campaignOwnershipService.ts';
const ORDER = 'backend/db/campaignVersionStore.ts';
const ACCESS = 'backend/services/campaignAccessService.ts';

const CONFLICT_LINE = "    if (companies.size > 1) return { status: 'CONFLICT', companyIds: Array.from(companies).sort(), sources };";
const OWNED_LINE = "    return { status: 'OWNED', companyId: Array.from(companies)[0], sources, orphan: !campaignRow };";

const MUTATIONS = [
  {
    id: 'M1', name: 'conflict resolves to the first company seen',
    file: RESOLVER, from: CONFLICT_LINE, to: '',
  },
  {
    id: 'M2', name: 'conflict resolves to campaigns.company_id (precedence)',
    file: RESOLVER,
    from: `${CONFLICT_LINE}\n${OWNED_LINE}`,
    to: [
      "    if (companies.size > 1 && !recordOwner) return { status: 'CONFLICT', companyIds: Array.from(companies).sort(), sources };",
      "    return { status: 'OWNED', companyId: recordOwner ?? Array.from(companies)[0], sources, orphan: !campaignRow };",
    ].join('\n'),
  },
  {
    id: 'M3', name: 'conflict resolves to the latest version row',
    file: RESOLVER,
    edits: [
      {
        from: "supabase.from('campaign_versions').select('company_id', { count: 'exact' })",
        to: "supabase.from('campaign_versions').select('company_id, created_at, version, id', { count: 'exact' })",
      },
      {
        from: CONFLICT_LINE,
        to: [
          '    if (companies.size > 1) {',
          "      const latest = [...versionRows].sort(require('../db/campaignVersionStore').compareLatestVersionFirst)[0];",
          "      return { status: 'OWNED', companyId: String(latest.company_id), sources, orphan: !campaignRow };",
          '    }',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'M4a', name: 'a failed read is reported as NOT_FOUND',
    file: RESOLVER,
    from: "    if (campaign.error || versions.error) return { status: 'LOOKUP_FAILED' };",
    to: "    if (campaign.error || versions.error) return { status: 'NOT_FOUND' };",
  },
  {
    id: 'M4b', name: 'a thrown lookup is reported as NOT_FOUND',
    file: RESOLVER,
    from: "  } catch {\n    return { status: 'LOOKUP_FAILED' };",
    to: "  } catch {\n    return { status: 'NOT_FOUND' };",
  },
  {
    id: 'M4c', name: 'an incomplete version read is trusted as the whole owner set',
    file: RESOLVER,
    from: '    if (typeof versions.count === \'number\' && versions.count > versionRows.length) {',
    to: '    if (false) {',
  },
  {
    id: 'M5', name: 'campaigns.company_id is ignored',
    file: RESOLVER,
    from: '    if (recordOwner) companies.add(recordOwner);',
    to: '',
  },
  {
    id: 'M6', name: 'version rows are ignored',
    file: RESOLVER,
    from: '      if (owner) companies.add(owner);',
    to: '      void owner;',
  },
  {
    id: 'M7', name: 'an orphan (versions without a campaigns row) is NOT_FOUND',
    file: RESOLVER,
    from: "    if (!campaignRow && versionRows.length === 0) return { status: 'NOT_FOUND' };",
    to: "    if (!campaignRow) return { status: 'NOT_FOUND' };",
  },
  {
    id: 'M8', name: 'an empty-string company id is a real company',
    file: RESOLVER,
    edits: [
      { from: '  return owner ? owner : null;', to: '  return String(value);' },
      { from: '    if (recordOwner) companies.add(recordOwner);', to: '    if (recordOwner !== null) companies.add(recordOwner);' },
      { from: '      if (owner) companies.add(owner);', to: '      if (owner !== null) companies.add(owner);' },
    ],
  },
  {
    id: 'M9a', name: 'created_at ordered NULLS FIRST',
    file: ORDER,
    from: "  { column: 'created_at', ascending: false, nullsFirst: false },",
    to: "  { column: 'created_at', ascending: false, nullsFirst: true },",
  },
  {
    id: 'M9b', name: 'the in-memory comparator puts NULL first regardless of the ordering',
    file: ORDER,
    from: '    if (av === null) return key.nullsFirst ? -1 : 1;\n    if (bv === null) return key.nullsFirst ? 1 : -1;',
    to: '    if (av === null) return -1;\n    if (bv === null) return 1;',
  },
  {
    id: 'M10', name: 'all tie-breaks removed (created_at only)',
    file: ORDER,
    from: "  { column: 'version', ascending: false, nullsFirst: false },\n  { column: 'id', ascending: false, nullsFirst: false },",
    to: '',
  },
  {
    id: 'M11a', name: 'id tie-break reversed (ascending)',
    file: ORDER,
    from: "  { column: 'id', ascending: false, nullsFirst: false },",
    to: "  { column: 'id', ascending: true, nullsFirst: false },",
  },
  {
    id: 'M11b', name: 'version tie-break reversed (ascending)',
    file: ORDER,
    from: "  { column: 'version', ascending: false, nullsFirst: false },",
    to: "  { column: 'version', ascending: true, nullsFirst: false },",
  },
  {
    id: 'M12', name: 'version tie-break removed',
    file: ORDER,
    from: "  { column: 'version', ascending: false, nullsFirst: false },",
    to: '',
  },
  // ── Shadow safety ──────────────────────────────────────────────────────────
  {
    id: 'S1', name: 'the canonical owner replaces the legacy owner in resolveCampaignCompanyId',
    file: ACCESS,
    from: '  return owner;\n}',
    to: [
      "  const canonical = await require('./campaignOwnershipService').resolveCampaignOwnership(campaignId);",
      "  return canonical.status === 'OWNED' ? canonical.companyId : null;",
      '}',
    ].join('\n'),
  },
  {
    id: 'S2', name: 'a failing shadow is not contained',
    file: RESOLVER,
    from: '    const task = runOwnershipShadow(seam, campaignId, legacy).catch(() => undefined);',
    to: '    const task = runOwnershipShadow(seam, campaignId, legacy);',
  },
  {
    id: 'S3', name: 'the shadow runs even when disabled',
    file: RESOLVER,
    from: '    if (!isCampaignOwnershipShadowEnabled()) return;',
    to: '',
  },
  {
    id: 'S3b', name: 'the shadow is on by default outside unit tests',
    file: RESOLVER,
    from: "  return String(process.env.CAMPAIGN_OWNERSHIP_SHADOW ?? '').trim().toLowerCase() === 'on';",
    to: [
      "  const flag = String(process.env.CAMPAIGN_OWNERSHIP_SHADOW ?? '').trim().toLowerCase();",
      "  if (flag === 'off') return false;",
      "  return flag === 'on' || process.env.NODE_ENV !== 'test';",
    ].join('\n'),
  },
  {
    id: 'S4', name: 'telemetry carries the raw campaign id',
    file: RESOLVER,
    from: '    campaign_ref: campaignRef(campaignId),',
    to: '    campaign_ref: campaignId,',
  },
  {
    id: 'S5', name: 'telemetry is emitted even when the resolvers agree',
    file: RESOLVER,
    from: '  if (comparison.agrees) return;',
    to: '',
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

console.log('\n============ WS-A MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(5)} ${tag} ${r.name}  [${r.verdict}]`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
