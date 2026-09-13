#!/usr/bin/env node
/**
 * D8 mutation battery.
 *
 * Each entry reintroduces one of the ways competitor intelligence could go back to
 * publishing a competitive deficit that no observation supports. A mutation is KILLED
 * when the D8 suite fails with it applied; a SURVIVOR means the suite does not constrain
 * that behaviour — in which case the TEST is strengthened, never the mutation weakened.
 *
 * M1-M4 are the reproduction proofs: they restore the exact unconditional +6/+7/+8/+9
 * constants that were on main, so killing them demonstrates the suite catches the
 * original defect rather than merely describing the fix.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d8CompetitorEvidenceIntegrity.test.ts';
const SEAM = 'backend/services/competitor/competitorMetricsEvidence.ts';
const ENGINE = 'backend/services/reportCompetitorIntelligenceServiceEngine.ts';
const HELPERS = 'backend/services/reportCompetitorIntelligenceServiceHelpers.ts';
const SUMMARY = 'backend/services/snapshotReport/competitorSummaryHelpers.ts';
const VIEWUTILS = 'pages/api/reports/reportViewUtils.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore the unconditional +6 content lift (original defect)',
    file: SEAM,
    from: '      content_depth: clampMetric(signals.contentScore),',
    to: '      content_depth: clampMetric(signals.contentScore) + 6,',
  },
  {
    id: 'M2',
    name: 'restore the unconditional +7 AEO lift (original defect)',
    file: SEAM,
    from: '      aeo_readiness: clampMetric(signals.aiAnswerPresenceScore),',
    to: '      aeo_readiness: clampMetric(signals.aiAnswerPresenceScore) + 7,',
  },
  {
    id: 'M3',
    name: 'restore the unconditional +8 authority lift (original defect)',
    file: SEAM,
    from: '      authority_score: clampMetric(signals.authorityProxy),',
    to: '      authority_score: clampMetric(signals.authorityProxy) + 8,',
  },
  {
    id: 'M4',
    name: 'restore the unconditional +9 SEO lift (original defect)',
    file: SEAM,
    from: '      seo_coverage: clampMetric(signals.keywordCoverageScore),',
    to: '      seo_coverage: clampMetric(signals.keywordCoverageScore) + 9,',
  },
  {
    id: 'M5',
    name: 'fabricate the authority figure instead of deriving it from the observation',
    file: SEAM,
    from: '      authority_score: clampMetric(signals.authorityProxy),',
    to: '      authority_score: 88,',
  },
  {
    id: 'M6',
    name: 'restore the company-metric blend, making a competitor a function of the customer',
    file: SEAM,
    from: '      content_depth: clampMetric(signals.contentScore),',
    to: '      content_depth: clampMetric((companyMetrics.content_depth + signals.contentScore) / 2),',
  },
  {
    id: 'M7',
    name: 'convert insufficient evidence into a measured claim',
    file: SEAM,
    from: "      state: 'unavailable',",
    to: "      state: 'measured',",
  },
  {
    id: 'M8',
    name: 'publish the page-text proxy as MEASURED competitor authority',
    file: SEAM,
    from: "    state: 'inferred',",
    to: "    state: 'measured',",
  },
  {
    id: 'M9',
    name: 'synthesize metrics after a crawl failure instead of returning null',
    file: SEAM,
    from: `    return {
      state: 'unavailable',
      metrics: null,`,
    to: `    return {
      state: 'unavailable',
      metrics: { ...companyMetrics, content_depth: companyMetrics.content_depth + 8 },`,
  },
  {
    id: 'M10',
    name: 'replace absent metrics with arbitrary zeroes',
    file: SEAM,
    from: `    return {
      state: 'unavailable',
      metrics: null,`,
    to: `    return {
      state: 'unavailable',
      metrics: { content_depth: 0, authority_score: 0, publishing_frequency: 0, engagement_score: 0, seo_coverage: 0, geo_presence: 0, aeo_readiness: 0 },`,
  },
  {
    id: 'M11',
    name: 'treat an unobserved crawl (4xx/5xx/timeout/transport) as observed',
    file: SEAM,
    from: "  return outcome !== 'success' && outcome !== 'redirect';",
    to: '  return false;',
  },
  {
    id: 'M12',
    name: 'collapse every crawl failure back into one anonymous outcome',
    file: ENGINE,
    from: '  if (pages.length === 0) return { signals: null, outcome: failureOutcome };',
    to: "  if (pages.length === 0) return { signals: null, outcome: 'not_attempted' };",
  },
  {
    id: 'M13',
    name: 'mark fallback metrics as non-fallback',
    file: ENGINE,
    from: '      is_fallback_used: true,',
    to: '      is_fallback_used: false,',
  },
  {
    id: 'M14',
    name: 'allow unobserved competitors into the gap narrative',
    file: ENGINE,
    from: '  const observedEntries = params.entries.filter((entry) => entry.metrics != null);',
    to: '  const observedEntries = params.entries;',
  },
  {
    id: 'M15',
    name: 'narrate a comparison even when nothing was observed',
    file: ENGINE,
    from: '  if (!averageMetrics) return [];',
    to: '  if (!averageMetrics) { /* proceed */ }',
  },
  {
    id: 'M16',
    name: 'average an empty observed set into confident-looking zeroes',
    file: HELPERS,
    from: '  if (observed.length === 0) return null;',
    to: '  if (observed.length === 0) return { content_depth: 0, authority_score: 0, publishing_frequency: 0, engagement_score: 0, seo_coverage: 0, geo_presence: 0, aeo_readiness: 0 };',
  },
  {
    id: 'M17',
    name: 'plot unobserved competitors on the customer-facing radar',
    file: SUMMARY,
    from: '  return entries.filter((entry) => entry.metrics != null);',
    to: '  return entries.filter(() => true);',
  },
  {
    id: 'M18',
    name: 'assert parity in the comparison table when nothing was observed',
    file: VIEWUTILS,
    from: "  if (!delta) return 'Not Observed';",
    to: "  if (!delta) return 'At Par';",
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

console.log('\n================ D8 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
