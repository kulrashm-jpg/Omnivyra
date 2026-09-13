#!/usr/bin/env node
/**
 * UNION interaction-matrix mutation battery.
 *
 * The workstream batteries each prove a workstream's suite constrains that workstream.
 * This one proves the UNION interaction tests constrain the cross-workstream invariants
 * — that I1–I10 can actually fail. It exists because a green first pass is not evidence:
 * the first draft of I6 read `body.data`, which does not exist, so every lane was skipped
 * and the lane assertion checked nothing while reporting success.
 *
 * Each mutation reverts ONE cross-workstream invariant in production code. A mutation is
 * KILLED when the union suites fail with it applied. A SURVIVOR means an interaction test
 * does not constrain that invariant — in which case the TEST is strengthened, never the
 * mutation weakened.
 *
 * `all: true` mutates every occurrence of an anchor, for invariants a workstream applies
 * in more than one place (DG-008 guards two renderers); mutating only one copy would let
 * the other keep the suite green and hide a real gap.
 *
 * Every mutation is applied, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

// The matrix is split by concern so no file exceeds the 500-line limit; the battery
// runs all four together, exactly as it ran the single file before the split.
const SUITES = [
  'backend/tests/unit/unionMatrixEvidence.test.ts',
  'backend/tests/unit/unionMatrixReport1.test.ts',
  'backend/tests/unit/unionMatrixSources.test.ts',
  'backend/tests/unit/unionSerpRouting.test.ts',
].join(' ');

const MUTATIONS = [
  {
    id: 'U1', interaction: 'I1', name: 'DG-008 renderer ignores D1’s verdict and prints the structural figure',
    file: 'backend/services/intelligence/exportRendererAssembly.ts', all: true,
    from: "const aiObserved = surfaces.ai_visibility_state.state !== 'unmeasured';",
    to: 'const aiObserved = true;',
  },
  {
    id: 'U2', interaction: 'I1', name: 'an LLM probe is reclassified as public observation',
    file: 'backend/services/evidenceProvenance.ts',
    from: "llm_probe: 'INFERRED'",
    to: "llm_probe: 'PUBLIC_OBSERVED'",
  },
  {
    id: 'U3', interaction: 'I2', name: 'D7 admits non-responding pages into its population (the `?? 200` defect)',
    file: 'backend/services/digitalExperience.ts',
    from: '  const pages = submitted.filter((page) => hasHttpResponse(reachabilityForPage(page).outcome));',
    to: '  const pages = submitted;',
  },
  {
    id: 'U4', interaction: 'I2', name: 'PDA counts a page that never answered as a status error',
    file: 'backend/services/publicDomainAuditService.ts',
    from: 'observations.filter((item) => isHttpErrorOutcome(item.outcome))',
    to: "observations.filter((item) => item.outcome !== 'success')",
  },
  {
    id: 'U5', interaction: 'I3/I7/I10', name: 'the D3 partition is bypassed — raw decisions reach every Report 1 consumer',
    file: 'backend/services/snapshotReportService.ts',
    from: '    partitionDecisionsForReport1(submittedDecisions);',
    to: '    { publicEvidence: submittedDecisions, connectedEvidence: [] as typeof submittedDecisions };',
  },
  {
    id: 'U6', interaction: 'I4', name: 'DG-010 promotes the HTTP Last-Modified header to a modification date',
    file: 'backend/services/crawlerService.ts',
    from: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? null,",
    to: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? (headers?.['last-modified'] as string) ?? null,",
  },
  {
    id: 'U7', interaction: 'I5', name: 'D8 synthesises competitor metrics from the customer’s when unobserved',
    file: 'backend/services/competitor/competitorMetricsEvidence.ts',
    from: '      metrics: null,',
    to: '      metrics: { ...companyMetrics },',
  },
  {
    id: 'U8', interaction: 'I6', name: 'D5 fabricated YouTube row restored on the fallback lane',
    file: 'pages/api/trending/current.ts',
    from: '    youtube: youTubeTrendingUnavailable(),',
    to: '    youtube: [{ keyword: "AI Tutorials", views: "5.2M", growth: "+78%", category: "Education", source: "YouTube" }] as never,',
  },
  {
    id: 'U9', interaction: 'I6', name: 'D6 fabricated Reddit row restored on the twitter fallback lane',
    file: 'pages/api/trending/current.ts',
    from: '    twitter: redditTrendingUnavailable(),',
    to: '    twitter: [{ keyword: "workfromhome", upvotes: 15420, source: "Reddit" }] as never,',
  },
  {
    id: 'U10', interaction: 'I8', name: 'DG-011 starts reading DG-001’s feature rows as proof of presence',
    file: 'backend/services/socialPresenceObservation.ts',
    from: '  for (const row of result.rows) {',
    to: '  for (const row of [...result.rows, ...((result as { features?: typeof result.rows }).features ?? [])]) {',
  },
  {
    id: 'U11', interaction: 'I10', name: 'the feature block claims `measured` when SERP never ran',
    file: 'backend/services/snapshotReport/searchFeatureHelpers.ts',
    from: "      state: acquisitionStatus === 'failed' ? 'failed' : 'unavailable',",
    to: "      state: 'measured',",
  },
  {
    id: 'U12', interaction: 'I9', name: 'Path B asks for the warehouse depth instead of 10',
    file: 'backend/services/reportCompetitorIntelligenceServiceHelpers.ts',
    from: 'const SERP_RESULTS_PER_QUERY = 10;',
    to: 'const SERP_RESULTS_PER_QUERY = 50;',
  },
  {
    id: 'U13', interaction: 'I9', name: 'Path C asks for the report depth instead of 5',
    file: 'backend/services/competitorEnrichmentService.ts',
    from: 'const SERP_ENRICHMENT_DEPTH = 5;',
    to: 'const SERP_ENRICHMENT_DEPTH = 10;',
  },
  {
    id: 'U14', interaction: 'I9', name: 'Report 1 is unpinned from SerpAPI',
    file: 'backend/services/serp/canonicalSerpClient.ts',
    from: "export const REPORT_SERP_PROVIDER = 'serpapi' as const;",
    to: "export const REPORT_SERP_PROVIDER = 'dataforseo' as const;",
  },
  {
    id: 'U15', interaction: 'I9', name: 'the vocabulary opens: an unknown provider label is guessed as `other`',
    file: 'backend/services/serp/serpResultTypes.ts',
    from: '  return PROVIDER_TYPE_ALIASES[key] ?? null;',
    to: "  return PROVIDER_TYPE_ALIASES[key] ?? 'other';",
  },
  {
    id: 'U16', interaction: 'I10', name: 'feature ownership is asserted for a feature with no domain',
    file: 'backend/services/reportCompetitorIntelligenceServiceHelpers.ts',
    from: '  if (!featureDomain) return null;\n  if (!ownDomain) return null;\n  return featureDomain === ownDomain;',
    to: '  return featureDomain === ownDomain;',
  },
  {
    id: 'U17', interaction: 'I7', name: 'competitor intelligence is fed the raw submission, not the partitioned set',
    file: 'backend/services/snapshotReportService.ts',
    from: '      decisions: baseCombined,',
    to: '      decisions: submittedDecisions,',
  },
];

const results = [];
for (const m of MUTATIONS) {
  const original = fs.readFileSync(m.file, 'utf8');
  if (!original.includes(m.from)) {
    results.push({ ...m, verdict: 'NOT APPLICABLE — anchor not found' });
    continue;
  }
  const mutated = m.all ? original.split(m.from).join(m.to) : original.replace(m.from, m.to);
  fs.writeFileSync(m.file, mutated, 'utf8');
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

console.log('\n================ UNION MATRIX MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${r.interaction.padEnd(10)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
