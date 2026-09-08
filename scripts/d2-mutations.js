#!/usr/bin/env node
/**
 * D2 mutation battery.
 *
 * Each entry reintroduces one specific way the false-success could come back.
 * A mutation is KILLED when the D2 suite fails with it applied. A SURVIVOR means
 * the suite does not constrain that behaviour, and the suite — not the code — is
 * what needs fixing.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d2CrawlerReachabilityIntegrity.test.ts';
const CRAWLER = 'backend/services/crawlerService.ts';
const ENGINE = 'backend/services/websiteIntelligence/technicalIntelligenceEngine.ts';
const VOCAB = 'backend/services/crawl/reachabilityOutcome.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'non-2xx response converted to success',
    file: VOCAB,
    from: "  if (status >= 400) return 'client_error';",
    to: "  if (status >= 400) return 'success';",
  },
  {
    id: 'M2',
    name: '404 discarded (thrown away before persistence, as before)',
    file: CRAWLER,
    from: '  if (isHttpErrorOutcome(reachability.outcome)) {\n    return { ok: false, reachability };\n  }',
    to: "  if (isHttpErrorOutcome(reachability.outcome)) {\n    throw new Error(`Request failed with status ${response.status}`);\n  }",
  },
  {
    id: 'M3',
    name: '500 discarded (server errors reclassified as reachable)',
    file: VOCAB,
    from: "  if (status >= 500) return 'server_error';",
    to: "  if (status >= 500) return 'redirect';",
  },
  {
    id: 'M4',
    name: 'transport failure converted to an empty successful result',
    file: VOCAB,
    from: "    outcome: timedOut ? 'timeout' : 'transport_failure',",
    to: "    outcome: 'success',",
  },
  {
    id: 'M5',
    name: 'timeout converted to a successful result',
    file: VOCAB,
    from: "  const timedOut = /timeout|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)/i.test(message);",
    to: '  const timedOut = false;',
  },
  {
    id: 'M6',
    name: 'broken-page count hardcoded to zero',
    file: ENGINE,
    from: '      const brokenPages = responded.filter((o) => isHttpErrorOutcome(o.reach.outcome)).map((o) => o.page);',
    to: '      const brokenPages: PageRow[] = [];',
  },
  {
    id: 'M7',
    name: 'perfect score emitted despite failed acquisition',
    file: ENGINE,
    from: '    if (responded.length === 0) {',
    to: '    if (false) {',
  },
  {
    id: 'M8',
    name: 'status code dropped before reachability evaluation',
    file: CRAWLER,
    from: '            http_status: reachability.status ?? NO_HTTP_RESPONSE_STATUS,',
    to: '            http_status: NO_HTTP_RESPONSE_STATUS,',
  },
  {
    id: 'M9',
    name: 'error path bypasses the canonical evidence state',
    file: CRAWLER,
    from: '              reachability,',
    to: '',
  },
  {
    id: 'M10',
    name: 'unobserved status defaults to 200 again',
    file: VOCAB,
    from: "  if (typeof status !== 'number' || status === NO_HTTP_RESPONSE_STATUS) {",
    to: '  if (false) {',
  },
  {
    id: 'M11',
    name: 'unreachable pages counted in the responded denominator',
    file: ENGINE,
    from: '      const d = responded.length;',
    to: '      const d = observed.length;',
  },
  {
    id: 'M12',
    name: 'transport failures folded into the 4xx/5xx population',
    file: VOCAB,
    from: "  return outcome === 'client_error' || outcome === 'server_error';",
    to: "  return outcome !== 'success' && outcome !== 'redirect';",
  },
  {
    id: 'M13',
    name: 'existing successful crawl behaviour altered (body no longer read)',
    file: CRAWLER,
    from: '  const html = (await readCapped(response)).toString(\'utf8\');',
    to: "  const html = '';",
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

console.log('\n================ D2 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
