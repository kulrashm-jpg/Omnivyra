#!/usr/bin/env node
/**
 * D3 CONSUMER FOLLOW-UP mutation battery.
 *
 * Each entry reintroduces one way private Search Console evidence could reach Report 1
 * again. A mutation is KILLED when the D3 suites fail with it applied; a SURVIVOR means
 * the suites do not constrain that behaviour — in which case the TEST is strengthened,
 * never the mutation weakened.
 *
 * M1 is the reproduction proof: it restores the exact pre-fix composition, in which only
 * the visual-intelligence consumer was gated and the other nine received the raw list.
 *
 * Both D3 suites run together, because the follow-up must not be able to pass by
 * breaking the boundary the original D3 established.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITES = [
  'backend/tests/unit/d3ConsumerBoundaryIntegrity.test.ts',
  'backend/tests/unit/d3Report1ProvenanceBoundary.test.ts',
].join(' ');

const COMPOSER = 'backend/services/snapshotReportService.ts';
const PROVENANCE = 'backend/services/evidenceProvenance.ts';
const VISUALS = 'backend/services/snapshotReport/visualIntelligenceHelpers.ts';

const PARTITION_CALL = `  const { publicEvidence: baseCombined, connectedEvidence: withheldConnectedDecisions } =
    partitionDecisionsForReport1(submittedDecisions);`;

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore the pre-fix composition — only visual intelligence gated (original defect)',
    file: COMPOSER,
    from: PARTITION_CALL,
    to: `  const baseCombined = submittedDecisions;
  const withheldConnectedDecisions = [];`,
  },
  {
    id: 'M2',
    name: 'restore GSC avg_position prose by ungating section assembly',
    file: COMPOSER,
    from: PARTITION_CALL,
    to: `  const { connectedEvidence: withheldConnectedDecisions } =
    partitionDecisionsForReport1(submittedDecisions);
  const baseCombined = submittedDecisions;`,
  },
  {
    id: 'M3',
    name: 'bypass the provenance filter — every decision is Report 1 evidence',
    file: PROVENANCE,
    from: '  return isReport1Provenance(provenanceForDecisionService(decision.source_service));',
    to: '  return true;',
  },
  {
    id: 'M4',
    name: 'convert connected evidence to PUBLIC_OBSERVED at the classifier',
    file: PROVENANCE,
    from: "  return CONNECTED_SOURCE_DECISION_SERVICES.has(service) ? 'CONNECTED_SOURCE' : 'PUBLIC_OBSERVED';",
    to: "  return 'PUBLIC_OBSERVED';",
  },
  {
    id: 'M5',
    name: 'de-register the Search Console producer so its impressions become public',
    file: PROVENANCE,
    from: "export const CONNECTED_SOURCE_DECISION_SERVICES: ReadonlySet<string> = new Set([\n  'seoIntelligenceService',",
    to: 'export const CONNECTED_SOURCE_DECISION_SERVICES: ReadonlySet<string> = new Set([',
  },
  {
    id: 'M6',
    name: 'the partition routes connected decisions into the public half',
    file: PROVENANCE,
    from: '    (isReport1Decision(decision) ? publicEvidence : connectedEvidence).push(decision);',
    to: '    (isReport1Decision(decision) ? connectedEvidence : publicEvidence).push(decision);',
  },
  {
    id: 'M7',
    name: 'the partition silently keeps everything public',
    file: PROVENANCE,
    from: '  const publicEvidence: T[] = [];\n  const connectedEvidence: T[] = [];',
    to: '  const publicEvidence: T[] = [...decisions];\n  const connectedEvidence: T[] = [];',
  },
  {
    id: 'M8',
    name: 'alternate decision path — the section floor draws from the ungated pool',
    file: COMPOSER,
    from: '      fallbackPool: finalDecisions,',
    to: '      fallbackPool: submittedDecisions,',
  },
  {
    id: 'M9',
    name: 'alternate decision path — the score model reads the ungated pool',
    file: COMPOSER,
    from: '  const score = buildReportScoreModel({\n    decisions: finalDecisions,',
    to: '  const score = buildReportScoreModel({\n    decisions: submittedDecisions,',
  },
  {
    id: 'M10',
    name: 'alternate decision path — competitor candidates extracted from ungated decisions',
    file: COMPOSER,
    from: '      decisions: baseCombined,\n      resolvedInput: params.resolvedInput,',
    to: '      decisions: submittedDecisions,\n      resolvedInput: params.resolvedInput,',
  },
  {
    id: 'M11',
    name: 'replace the excluded search surface with zeroes instead of nulls',
    file: VISUALS,
    from: `        impressions: null,
        clicks: null,
        ctr: null,
        estimated_lost_clicks: null,
        confidence: 'low' as const,`,
    to: `        impressions: 0,
        clicks: 0,
        ctr: 0,
        estimated_lost_clicks: 0,
        confidence: 'low' as const,`,
  },
  {
    id: 'M12',
    name: 'report the excluded search surface as measured/high confidence',
    file: VISUALS,
    from: `        estimated_lost_clicks: null,
        confidence: 'low' as const,`,
    to: `        estimated_lost_clicks: null,
        confidence: 'high' as const,`,
  },
  {
    id: 'M13',
    name: 'stop counting withheld decisions, making the boundary invisible',
    file: COMPOSER,
    from: '      connected_source_decisions_withheld: withheldConnectedDecisions.length,',
    to: '      connected_source_decisions_withheld: 0,',
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
    execSync(`npx jest ${SUITES} --silent`, { stdio: 'pipe', encoding: 'utf8' });
    detail = 'suites still passed';
  } catch (err) {
    killed = true;
    const out = String(err.stdout || '') + String(err.stderr || '');
    const hit = out.match(/Tests:\s+(\d+) failed/);
    detail = hit ? `${hit[1]} test(s) failed` : 'suites failed';
  } finally {
    fs.writeFileSync(m.file, original, 'utf8');
  }
  results.push({ ...m, verdict: killed ? `KILLED (${detail})` : `SURVIVED (${detail})` });
}

console.log('\n========== D3 CONSUMER FOLLOW-UP MUTATION RESULTS ==========');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
