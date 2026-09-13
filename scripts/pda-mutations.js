#!/usr/bin/env node
/**
 * PDA mutation battery.
 *
 * Each entry reintroduces one way `publicDomainAuditService` could go back to
 * making a crawl claim about a page it never read, or one way the fix could be
 * faked (abstaining in name while still reporting a fabricated number).
 *
 * A mutation is KILLED when the PDA suite fails with it applied; a SURVIVOR
 * means the suite does not constrain that behaviour.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/pdaReachabilityOrphanIntegrity.test.ts';
const SERVICE = 'backend/services/publicDomainAuditService.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'derive orphans over every row again, including never-crawled GA4 paths',
    file: SERVICE,
    from: '  const orphanLikePages = respondedPages.filter((page) => {',
    to: '  const orphanLikePages = pages.filter((page) => {',
  },
  {
    id: 'M2',
    name: 'restore the original predicate that folds the 0 sentinel into status errors',
    file: SERVICE,
    from: '  const pagesWithStatusErrors = observations.filter((item) => isHttpErrorOutcome(item.outcome)).map((item) => item.page);',
    to: '  const pagesWithStatusErrors = pages.filter((page) => Number(page.http_status ?? 200) >= 400 || Number(page.http_status ?? 200) === 0);',
  },
  {
    id: 'M3',
    name: 'drop the crawl-evidence guard so the finding fires on an unobserved corpus',
    file: SERVICE,
    from: '  if (crawlEvidenceAvailable && (pagesWithStatusErrors.length > 0 || orphanLikePages.length >= 2 || internalLinkAvg < 1.5)) {',
    to: '  if (pagesWithStatusErrors.length > 0 || orphanLikePages.length >= 2 || internalLinkAvg < 1.5) {',
  },
  {
    id: 'M4',
    name: 'dilute the internal-link average with rows that were never fetched',
    file: SERVICE,
    from: '  const internalLinkAvg = respondedPages.reduce((sum, page) => sum + Number(page.internal_link_count ?? 0), 0) / Math.max(1, respondedPages.length);',
    to: '  const internalLinkAvg = pages.reduce((sum, page) => sum + Number(page.internal_link_count ?? 0), 0) / Math.max(1, pages.length);',
  },
  {
    id: 'M5',
    name: 'treat every row as though it had answered',
    file: SERVICE,
    from: '  const respondedPages = observations.filter((item) => hasHttpResponse(item.outcome)).map((item) => item.page);',
    to: '  const respondedPages = observations.map((item) => item.page);',
  },
  {
    id: 'M6',
    name: 'reintroduce `?? 200` at the classification site, so an unobserved page reads as 200',
    file: SERVICE,
    from: '  const observations = pages.map((page) => ({ page, outcome: reachabilityForPage(page).outcome }));',
    to: '  const observations = pages.map((page) => ({ page, outcome: reachabilityForPage({ ...page, http_status: page.http_status ?? 200 }).outcome }));',
  },
  {
    id: 'M7',
    name: 'inflate the orphan count with unreachable rows',
    file: SERVICE,
    from: '        orphan_like_page_count: orphanLikePages.length,',
    to: '        orphan_like_page_count: orphanLikePages.length + unreachablePages.length,',
  },
  {
    id: 'M8',
    name: 'silently drop unreachable rows instead of reporting them',
    file: SERVICE,
    from: '        unreachable_pages: unreachablePages.map((page) => page.url).slice(0, 5),',
    to: '        unreachable_pages: [],',
  },
  {
    id: 'M9',
    name: 'fold unreachable pages back into the "returned an error" list',
    file: SERVICE,
    from: '        error_pages: pagesWithStatusErrors.map((page) => page.url).slice(0, 5),',
    to: '        error_pages: [...pagesWithStatusErrors, ...unreachablePages].map((page) => page.url).slice(0, 5),',
  },
  {
    id: 'M10',
    name: 'report a fabricated 0 link average instead of abstaining',
    file: SERVICE,
    from: '        internal_link_avg: crawlEvidenceAvailable ? internalLinkAvg : null,\n        internal_link_avg_state: crawlEvidenceAvailable ? \'measured\' : \'insufficient_signal\',\n        pages_observed: respondedPages.length,',
    to: '        internal_link_avg: internalLinkAvg,\n        internal_link_avg_state: crawlEvidenceAvailable ? \'measured\' : \'insufficient_signal\',\n        pages_observed: respondedPages.length,',
  },
  {
    id: 'M11',
    name: 'label an unmeasured link average as measured',
    file: SERVICE,
    from: '        internal_link_avg_state: crawlEvidenceAvailable ? \'measured\' : \'insufficient_signal\',\n        pages_observed: respondedPages.length,',
    to: '        internal_link_avg_state: \'measured\',\n        pages_observed: respondedPages.length,',
  },
  {
    id: 'M12',
    name: 'drop the crawl-evidence guard from the user-journey link-density disjunct',
    file: SERVICE,
    from: '  if ((crawlEvidenceAvailable && internalLinkAvg < 2) || (!pricingExists && !contactExists) || !productExists) {',
    to: '  if (internalLinkAvg < 2 || (!pricingExists && !contactExists) || !productExists) {',
    also: {
      file: SERVICE,
      from: '        internal_link_avg: crawlEvidenceAvailable ? internalLinkAvg : null,\n        internal_link_avg_state: crawlEvidenceAvailable ? \'measured\' : \'insufficient_signal\',\n      },',
      to: '        internal_link_avg: internalLinkAvg,\n        internal_link_avg_state: \'measured\',\n      },',
    },
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
    execSync(`npx jest ${SUITE} --silent`, { stdio: 'pipe', encoding: 'utf8' });
    detail = 'suite still passed';
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

console.log('\n================ PDA MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
