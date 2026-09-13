#!/usr/bin/env node
/**
 * D7 mutation battery.
 *
 * Each entry reintroduces one way the secondary reachability reader could go back
 * to treating an unobserved page as a successful one, or could stop consuming the
 * D2 canonical contract. A mutation is KILLED when the D7 suite fails with it
 * applied; a SURVIVOR means the suite does not constrain that behaviour.
 *
 * M1 in particular is the reproduction proof: it restores the exact `?? 200`
 * default that was on main, so a passing M1 kill demonstrates the suite catches
 * the original defect rather than merely describing the fix.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d7SecondaryReachabilityIntegrity.test.ts';
const EXP = 'backend/services/digitalExperience.ts';
const REPO = 'backend/services/digitalExperienceRepository.ts';
const CONTRACT = 'backend/services/crawl/reachabilityOutcome.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore `?? 200` on the orphan predicate (the original defect)',
    file: EXP,
    from: "  const orphans = pages.filter((p) => Number(p.internal_link_count ?? 0) === 0 && reachabilityForPage(p).outcome === 'success');",
    to: '  const orphans = pages.filter((p) => Number(p.internal_link_count ?? 0) === 0 && (p.http_status ?? 200) === 200);',
    also: {
      file: EXP,
      from: '  const pages = submitted.filter((page) => hasHttpResponse(reachabilityForPage(page).outcome));',
      to: '  const pages = submitted;',
    },
  },
  {
    id: 'M2',
    name: 'stop excluding unobserved pages from the assessed population',
    file: EXP,
    from: '  const pages = submitted.filter((page) => hasHttpResponse(reachabilityForPage(page).outcome));',
    to: '  const pages = submitted;',
  },
  {
    id: 'M3',
    name: 'ignore actual 4xx/5xx statuses',
    file: EXP,
    from: '  const broken = pages.filter((p) => isHttpErrorOutcome(reachabilityForPage(p).outcome));',
    to: '  const broken = [];',
  },
  {
    id: 'M4',
    name: 'treat every non-success outcome as a broken page (overcorrection)',
    file: EXP,
    from: '  const broken = pages.filter((p) => isHttpErrorOutcome(reachabilityForPage(p).outcome));',
    to: "  const broken = pages.filter((p) => reachabilityForPage(p).outcome !== 'success');",
  },
  {
    id: 'M5',
    name: 'restore `?? 200` on the thin-content predicate',
    file: EXP,
    from: "  const thin = pages.filter((p) => reachabilityForPage(p).outcome === 'success' && Number(p.wordCount ?? 0) < THIN_PAGE_WORDS);",
    to: '  const thin = pages.filter((p) => (p.http_status ?? 200) === 200 && Number(p.wordCount ?? 0) < THIN_PAGE_WORDS);',
    also: {
      file: EXP,
      from: '  const pages = submitted.filter((page) => hasHttpResponse(reachabilityForPage(page).outcome));',
      to: '  const pages = submitted;',
    },
  },
  {
    id: 'M6',
    name: 'restore `?? 200` on the client-side-rendering reader',
    file: EXP,
    from: "  const ok = pages.filter((p) => reachabilityForPage(p).outcome === 'success');",
    to: '  const ok = pages.filter((p) => (p.http_status ?? 200) === 200);',
  },
  {
    id: 'M7',
    name: 'restore `?? 200` on PageSpeed probe eligibility',
    file: REPO,
    from: "  const eligible = params.pages.filter((p) => reachabilityForPage(p).outcome === 'success' && p.url);",
    to: '  const eligible = params.pages.filter((p) => (p.http_status ?? 200) === 200 && p.url);',
  },
  {
    id: 'M8',
    name: 'bypass the canonical contract — a null status becomes success',
    file: CONTRACT,
    from: "  if (typeof status !== 'number' || status === NO_HTTP_RESPONSE_STATUS) {",
    to: '  if (false) {',
  },
  {
    id: 'M9',
    name: 'the contract folds transport failure into the 4xx/5xx population',
    file: CONTRACT,
    from: "  return outcome === 'client_error' || outcome === 'server_error';",
    to: "  return outcome !== 'success' && outcome !== 'redirect';",
  },
  {
    id: 'M10',
    name: 'the contract reports an unobserved page as having responded',
    file: CONTRACT,
    from: "  return outcome !== 'transport_failure' && outcome !== 'timeout';",
    to: '  return true;',
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

console.log('\n================ D7 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
