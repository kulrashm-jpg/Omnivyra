#!/usr/bin/env node
/**
 * D3 mutation battery.
 *
 * Each entry reintroduces one specific way private connected-source evidence
 * could reach the public Report 1 surface, or one way the fix could be faked by
 * relabelling instead of by fixing the boundary. A mutation is KILLED when the
 * D3 suite fails with it applied; a SURVIVOR means the suite does not constrain
 * that behaviour.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d3Report1ProvenanceBoundary.test.ts';
const PROV = 'backend/services/evidenceProvenance.ts';
const COMPOSER = 'backend/services/snapshotReportService.ts';
const HELPER = 'backend/services/snapshotReport/visualIntelligenceHelpers.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'reintroduce CONNECTED_SOURCE decisions into public Report 1',
    file: COMPOSER,
    from: '  const { publicEvidence: report1Decisions } = partitionDecisionsForReport1(finalDecisions);',
    to: '  const report1Decisions = finalDecisions;',
  },
  {
    id: 'M2',
    name: 'convert CONNECTED_SOURCE to PUBLIC_OBSERVED',
    file: PROV,
    from: "  return CONNECTED_SOURCE_DECISION_SERVICES.has(service) ? 'CONNECTED_SOURCE' : 'PUBLIC_OBSERVED';",
    to: "  return 'PUBLIC_OBSERVED';",
  },
  {
    id: 'M3',
    name: 'convert CONNECTED_SOURCE to INFERRED without evidence',
    file: PROV,
    from: "  return CONNECTED_SOURCE_DECISION_SERVICES.has(service) ? 'CONNECTED_SOURCE' : 'PUBLIC_OBSERVED';",
    to: "  return CONNECTED_SOURCE_DECISION_SERVICES.has(service) ? 'INFERRED' : 'PUBLIC_OBSERVED';",
  },
  {
    id: 'M4',
    name: 'bypass the provenance filter (empty registry)',
    file: PROV,
    from: "export const CONNECTED_SOURCE_DECISION_SERVICES: ReadonlySet<string> = new Set([\n  'seoIntelligenceService',",
    to: "export const CONNECTED_SOURCE_DECISION_SERVICES: ReadonlySet<string> = new Set([\n  'notAService',",
  },
  {
    id: 'M5',
    name: 'remove ALL visual intelligence instead of filtering only private data',
    file: COMPOSER,
    from: '  const { publicEvidence: report1Decisions } = partitionDecisionsForReport1(finalDecisions);',
    to: '  const report1Decisions: typeof finalDecisions = [];',
  },
  {
    id: 'M6',
    name: 'break Report 2 connected-source consumption',
    file: 'backend/services/performanceSearchIntelligenceService.ts',
    from: "import {",
    to: "import { partitionDecisionsForReport1 } from './evidenceProvenance';\nimport {",
  },
  {
    id: 'M7',
    name: 'let mixed-source data collapse into one ambiguous value',
    file: PROV,
    from: '    (isReport1Decision(decision) ? publicEvidence : connectedEvidence).push(decision);',
    to: '    publicEvidence.push(decision);\n    connectedEvidence.push(decision);',
  },
  {
    id: 'M8',
    name: 'default missing public demand to zero',
    file: HELPER,
    from: '    : {\n        impressions: null,\n        clicks: null,\n        ctr: null,\n        estimated_lost_clicks: null,',
    to: '    : {\n        impressions: 0,\n        clicks: 0,\n        ctr: 0,\n        estimated_lost_clicks: 0,',
  },
  {
    id: 'M9',
    name: 'expose connected provenance under a misleading public label',
    file: HELPER,
    from: "        'heuristic',\n      ]\n    : null;",
    to: "        'GSC',\n      ]\n    : null;",
  },
  {
    id: 'M10',
    name: 'an unattributed decision silently becomes public',
    file: PROV,
    from: "  if (!service) return 'UNAVAILABLE';",
    to: "  if (!service) return 'PUBLIC_OBSERVED';",
  },
  {
    id: 'M11',
    name: 'restore the hardcoded GSC tag on keyword coverage',
    file: HELPER,
    from: '  const keywordSourceTags = opportunityCoverage.length > 0\n    ? [',
    to: "  const keywordSourceTags = opportunityCoverage.length > 0\n    ? ['GSC', 'heuristic'] ?? [",
  },
];

const results = [];
for (const m of MUTATIONS) {
  const original = fs.readFileSync(m.file, 'utf8');
  if (!original.includes(m.from)) {
    results.push({ ...m, verdict: 'NOT APPLICABLE — anchor not found' });
    continue;
  }
  fs.writeFileSync(m.file, original.replace(m.from, m.to), 'utf8');
  let killed = false;
  let detail = '';
  try {
    execSync(`npx jest ${SUITE} --silent`, { stdio: 'pipe', encoding: 'utf8' });
    detail = 'suite still passed';
  } catch (err) {
    killed = true;
    const out = String(err.stdout || '') + String(err.stderr || '');
    const hit = out.match(/Tests:\s+(\d+) failed/);
    detail = hit ? `${hit[1]} test(s) failed` : 'suite failed';
  } finally {
    fs.writeFileSync(m.file, original, 'utf8');
  }
  results.push({ ...m, verdict: killed ? `KILLED (${detail})` : `SURVIVED (${detail})` });
}

console.log('\n================ D3 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
