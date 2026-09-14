#!/usr/bin/env node
/**
 * DG-001 mutation battery.
 *
 * DG-001 arrived with 71 tests and no committed mutation battery, so nothing in the
 * repository established that those tests CONSTRAIN the consolidation rather than merely
 * describe it. Each entry below reintroduces one way the SERP consolidation could come
 * apart: a feature relabelled as organic, a consumer going around the canonical client, a
 * depth boundary quietly changed, or evidence invented for a feature the provider never
 * returned.
 *
 * A mutation is KILLED when the DG-001 suites fail with it applied. A SURVIVOR means the
 * suites do not constrain that behaviour — in which case the TEST is strengthened, never
 * the mutation weakened.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITES = [
  'backend/tests/unit/dg001SerpFeatureCapture.test.ts',
  'backend/tests/unit/dg001ConsumerContract.test.ts',
  'backend/tests/unit/dg001ReportIntegration.test.ts',
  // The raw-JSON collector's narrowing (M17–M21).
  'backend/tests/unit/dg001SiblingFeatureCollector.test.ts',
].join(' ');

const TYPES = 'backend/services/serp/serpResultTypes.ts';
const CLIENT = 'backend/services/serp/canonicalSerpClient.ts';
const REPORT_HELPERS = 'backend/services/reportCompetitorIntelligenceServiceHelpers.ts';
const ENRICHMENT = 'backend/services/competitorEnrichmentService.ts';
const ACQUISITION = 'backend/services/serpAcquisitionService.ts';
const FEATURES = 'backend/services/snapshotReport/searchFeatureHelpers.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'remove feature capture — the report stops observing features entirely',
    file: FEATURES,
    from: '    observed: [...observations],',
    to: '    observed: [],',
  },
  {
    id: 'M2',
    name: 'classify every SERP feature as organic at the vocabulary translator',
    file: TYPES,
    from: '  return PROVIDER_TYPE_ALIASES[key] ?? null;',
    to: "  return (PROVIDER_TYPE_ALIASES[key] ?? null) && 'organic';",
  },
  {
    id: 'M3',
    name: 'accept an unknown provider label instead of rejecting it (fabricated type)',
    file: TYPES,
    from: '  return PROVIDER_TYPE_ALIASES[key] ?? null;',
    to: "  return PROVIDER_TYPE_ALIASES[key] ?? 'other';",
  },
  {
    id: 'M4',
    name: 'contaminate organic search visibility with feature rows',
    file: REPORT_HELPERS,
    from: "  const organicRows = result.rows.filter((row) => (row.result_type ?? 'organic') === 'organic');",
    to: '  const organicRows = result.rows;',
  },
  {
    id: 'M5',
    name: 'collapse feature and organic structures — features merged into observations',
    file: FEATURES,
    from: "    state: observations.length > 0 ? 'measured' : 'insufficient_signal',",
    to: "    state: 'measured',",
  },
  {
    id: 'M6',
    name: 'fabricate feature evidence when acquisition never ran',
    file: FEATURES,
    from: `    return {
      state: acquisitionStatus === 'failed' ? 'failed' : 'unavailable',
      observed: [],
      counts: {},
    };`,
    to: `    return {
      state: 'measured',
      observed: [...observations],
      counts: {},
    };`,
  },
  {
    id: 'M7',
    name: 'violate Report 1 depth — 10 becomes 50',
    file: REPORT_HELPERS,
    from: 'const SERP_RESULTS_PER_QUERY = 10;',
    to: 'const SERP_RESULTS_PER_QUERY = 50;',
  },
  {
    id: 'M8',
    name: 'violate Path C enrichment depth — 5 becomes 10',
    file: ENRICHMENT,
    from: 'const SERP_ENRICHMENT_DEPTH = 5;',
    to: 'const SERP_ENRICHMENT_DEPTH = 10;',
  },
  {
    id: 'M9',
    name: 'violate enterprise depth — 50 becomes 10',
    file: ACQUISITION,
    from: '        depth: Number(process.env.SERP_RESULT_DEPTH ?? 50),',
    to: '        depth: Number(process.env.SERP_RESULT_DEPTH ?? 10),',
  },
  {
    id: 'M10',
    name: 'alter Report 1 provider policy away from the pinned SerpAPI',
    file: CLIENT,
    from: "export const REPORT_SERP_PROVIDER = 'serpapi' as const;",
    to: "export const REPORT_SERP_PROVIDER = 'dataforseo' as const;",
  },
  {
    id: 'M11',
    name: 'the canonical client ignores the caller depth and substitutes its own',
    file: CLIENT,
    from: "  url.searchParams.set('num', String(input.depth));",
    to: "  url.searchParams.set('num', '50');",
  },
  {
    id: 'M12',
    name: 'bypass the canonical client — Path B acquires SerpAPI directly',
    file: REPORT_HELPERS,
    from: `  const result = await fetchCanonicalSerp({
    query: keyword,
    geography,
    depth: SERP_RESULTS_PER_QUERY,
    operation: 'search',
  }, parse);`,
    to: `  const direct = await fetch(\`https://serpapi.com/search.json?q=\${encodeURIComponent(keyword)}\`);
  const raw = await direct.json().catch(() => ({}));
  const result = { status: 'ok', rows: parse(raw.organic_results ?? []), reason: null };`,
  },
  {
    id: 'M13',
    name: 'bypass the canonical client — Path C acquires SerpAPI directly',
    file: ENRICHMENT,
    from: `    const result = await fetchCanonicalSerp({
      query: domain ? \`\${name} \${domain}\` : name,`,
    to: `    const direct = await fetch('https://serpapi.com/search.json');
    const result = await fetchCanonicalSerp({
      query: domain ? \`\${name} \${domain}\` : name,`,
  },
  {
    id: 'M14',
    name: 'the canonical client skips the provider cost governor',
    file: CLIENT,
    from: '  const gov = authorizeProviderCall({ providerId });',
    to: '  const gov = { ok: true };',
  },
  {
    id: 'M15',
    name: 'the canonical client skips credential resolution and calls unauthenticated',
    file: CLIENT,
    from: '  const credential = await resolveProviderCredential(providerId);',
    to: "  const credential = { value: 'x', source: 'env' };",
  },
  {
    id: 'M16',
    name: 'assert ownership for a feature carrying no domain (collapse null to false)',
    file: REPORT_HELPERS,
    from: '  if (!featureDomain) return null;\n  if (!ownDomain) return null;\n  return featureDomain === ownDomain;',
    to: '  return featureDomain === ownDomain;',
  },
  // ── The collector's `unknown` narrowing. Each of these makes the shape check
  // cosmetic in a different way; the collector suite must notice every one. ────
  {
    id: 'M17',
    name: 'the shape check accepts anything — raw provider JSON is trusted again',
    file: ACQUISITION,
    from: "function isProviderEntry(value: unknown): value is ProviderEntry {\n  return typeof value === 'object' && value !== null;\n}",
    to: 'function isProviderEntry(value: unknown): value is ProviderEntry {\n  return true;\n}',
  },
  {
    id: 'M18',
    name: 'the body is read before it is proven to be an object',
    file: ACQUISITION,
    from: '  if (!isProviderEntry(body)) return items;\n',
    to: '',
  },
  {
    id: 'M19',
    name: 'the provider’s own `type` wins over the key’s canonical label',
    file: ACQUISITION,
    from: '        if (isProviderEntry(entry)) items.push({ ...entry, type: typeLabel });',
    to: '        if (isProviderEntry(entry)) items.push({ type: typeLabel, ...entry });',
  },
  {
    id: 'M20',
    name: 'an organic result is read for sitelinks before it is proven to be an object',
    file: ACQUISITION,
    from: '    if (!isProviderEntry(result)) continue;\n',
    to: '',
  },
  {
    id: 'M21',
    name: 'primitive entries inside a feature block are collected as if they were objects',
    file: ACQUISITION,
    from: '        if (isProviderEntry(entry)) items.push({ ...entry, type: typeLabel });',
    to: '        if (entry !== null && entry !== undefined) items.push({ ...(entry as object), type: typeLabel });',
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

console.log('\n================ DG-001 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
