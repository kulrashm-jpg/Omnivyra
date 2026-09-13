#!/usr/bin/env node
/**
 * DG-010 mutation battery.
 *
 * Each entry reintroduces one way a content date could be FABRICATED again, or one way the
 * DG-010 fix could be faked. A mutation is KILLED when the DG-010 suites fail with it applied;
 * a SURVIVOR means the suites do not constrain that behaviour.
 *
 * The two hazards this battery exists for:
 *   • a server- or build-emitted date (HTTP `Last-Modified`, sitemap `<lastmod>`) being adopted as
 *     the page's content date, which would report "updated today" for every dynamically served site;
 *   • declared STALENESS being dressed up as content DECAY, which this platform cannot measure —
 *     `canonical_pages` is upserted on (company_id, url) and `page_content` / `page_links` are
 *     deleted and reinserted on every re-crawl, so no per-page history exists.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITES = [
  'backend/tests/unit/dg010CrawlerModifiedDate.test.ts',
  'backend/tests/unit/dg010ContentModifiedDate.test.ts',
  'backend/tests/unit/report1ContentFreshness.test.ts',
].join(' ');

const CRAWLER = 'backend/services/crawlerService.ts';
const ENGINE = 'backend/services/websiteIntelligence/contentIntelligenceEngine.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'stop capturing the declared update date at all',
    file: CRAWLER,
    from: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? null,",
    to: '    modified_time: null,',
  },
  {
    id: 'M2',
    name: 'source the update date from the HTTP Last-Modified header',
    file: CRAWLER,
    from: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? null,",
    to: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? hv('last-modified') ?? null,",
  },
  {
    id: 'M3',
    name: 'prefer the HTTP Last-Modified header over the page declaration',
    file: CRAWLER,
    from: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? null,",
    to: "    modified_time: hv('last-modified') ?? metaTags['article:modified_time'] ?? ldDateModified ?? null,",
  },
  {
    id: 'M4',
    name: 'reuse <time datetime> as the update date',
    file: CRAWLER,
    from: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? null,",
    to: "    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? /<time[^>]+datetime=[\"']([^\"']+)[\"']/i.exec(rawHtml)?.[1] ?? null,",
  },
  {
    id: 'M5',
    name: 'adopt the sitemap <lastmod> as site-level content evidence',
    file: CRAWLER,
    from: "    sitemap_url_count: sitemap ? (sitemap.match(/<loc>/gi) || []).length : 0,",
    to: "    sitemap_url_count: sitemap ? (sitemap.match(/<loc>/gi) || []).length : 0,\n    sitemap_lastmod: sitemap ? (/<lastmod>([^<]+)<\\/lastmod>/i.exec(sitemap)?.[1] ?? null) : null,",
    also: {
      file: CRAWLER,
      from: '  site?: { robots_txt: boolean; sitemap_xml: boolean; sitemap_url_count: number };',
      to: '  site?: { robots_txt: boolean; sitemap_xml: boolean; sitemap_url_count: number; sitemap_lastmod?: string | null };',
    },
  },
  {
    id: 'M6',
    name: 'ignore the declared update date in the engine (revert to publication only)',
    file: ENGINE,
    from: '      const published = declaredMs(p.crawl_metadata?.signals?.published_time);\n      const modified = declaredMs(p.crawl_metadata?.signals?.modified_time);\n      if (published === null) return modified;\n      if (modified === null) return published;\n      return Math.max(published, modified);',
    to: '      return declaredMs(p.crawl_metadata?.signals?.published_time);',
  },
  {
    id: 'M7',
    name: 'let a stale update date overwrite a fresh publication date (last-wins, not max)',
    file: ENGINE,
    from: '      if (published === null) return modified;\n      if (modified === null) return published;\n      return Math.max(published, modified);',
    to: '      if (modified !== null) return modified;\n      return published;',
  },
  {
    id: 'M8',
    name: 'accept a future declaration as evidence of freshness',
    file: ENGINE,
    from: '      return Number.isNaN(ms) || ms > nowMs ? null : ms;',
    to: '      return Number.isNaN(ms) ? null : ms;',
  },
  {
    id: 'M9',
    name: 'treat an unparseable declaration as "now"',
    file: ENGINE,
    from: '      return Number.isNaN(ms) || ms > nowMs ? null : ms;',
    to: '      return Number.isNaN(ms) ? nowMs : (ms > nowMs ? null : ms);',
  },
  {
    id: 'M10',
    name: 'fall back to the crawl timestamp when the page declares nothing',
    file: ENGINE,
    from: '      if (published === null) return modified;\n      if (modified === null) return published;\n      return Math.max(published, modified);',
    to: '      if (published === null && modified === null) return declaredMs(p.last_crawled_at);\n      if (published === null) return modified;\n      if (modified === null) return published;\n      return Math.max(published, modified);',
  },
  {
    id: 'M11',
    name: 'drop the abstention floor and report on a single dated page',
    file: ENGINE,
    from: '    const MIN_DATED_PAGES = 3;',
    to: '    const MIN_DATED_PAGES = 1;',
  },
  {
    id: 'M12',
    name: 'count declarations instead of pages in the denominator',
    file: ENGINE,
    from: '    const datedMs = pages.map(contentDateMs).filter((ms): ms is number => ms !== null);',
    to: '    const datedMs = pages.flatMap((p) => [declaredMs(p.crawl_metadata?.signals?.published_time), declaredMs(p.crawl_metadata?.signals?.modified_time)]).filter((ms): ms is number => ms !== null);',
  },
  {
    id: 'M13',
    name: 'describe declared staleness as content decay',
    file: ENGINE,
    from: '      C(\'content_freshness\', \'Content freshness\', \'pass\', pct(recent, datedMs.length),\n        `${recent}/${datedMs.length} dated pages declare publication or update within the last 12 months`);',
    to: '      C(\'content_freshness\', \'Content decay\', \'pass\', pct(recent, datedMs.length),\n        `${datedMs.length - recent}/${datedMs.length} pages are decaying — traffic is declining as content ages`);',
  },
  {
    id: 'M14',
    name: 'score an abstaining check as zero instead of not_evaluable',
    file: ENGINE,
    from: "      C('content_freshness', 'Content freshness', 'not_evaluable', null,",
    to: "      C('content_freshness', 'Content freshness', 'pass', 0,",
  },
];

const results = [];
for (const m of MUTATIONS) {
  const edits = [m, ...(m.also ? [m.also] : [])];
  const backups = new Map();
  let applicable = true;
  for (const edit of edits) {
    if (!backups.has(edit.file)) backups.set(edit.file, fs.readFileSync(edit.file, 'utf8'));
    const current = fs.readFileSync(edit.file, 'utf8');
    if (!current.includes(edit.from)) { applicable = false; break; }
    fs.writeFileSync(edit.file, current.replace(edit.from, edit.to), 'utf8');
  }
  if (!applicable) {
    for (const [file, original] of backups) fs.writeFileSync(file, original, 'utf8');
    results.push({ ...m, verdict: 'NOT APPLICABLE — anchor not found' });
    continue;
  }
  let killed = false;
  let detail = '';
  try {
    execSync(`npx jest ${SUITES} --silent`, { stdio: 'pipe', encoding: 'utf8' });
    detail = 'suites still passed';
  } catch (err) {
    killed = true;
    const out = String(err.stdout || '') + String(err.stderr || '');
    const hit = out.match(/Tests:\s+(\d+) failed/);
    detail = hit ? `${hit[1]} test(s) failed` : 'suite failed';
  } finally {
    for (const [file, original] of backups) fs.writeFileSync(file, original, 'utf8');
  }
  results.push({ ...m, verdict: killed ? `KILLED (${detail})` : `SURVIVED (${detail})` });
}

console.log('\n================ DG-010 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
