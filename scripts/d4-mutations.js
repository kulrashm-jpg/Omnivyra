#!/usr/bin/env node
/**
 * D4 mutation battery.
 *
 * Each entry reintroduces one way a search-volume claim could be attributed to
 * Google Trends again, or one way the fix could be faked. A mutation is KILLED
 * when the D4 suite fails with it applied; a SURVIVOR means the suite does not
 * constrain that behaviour.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d4SearchVolumeAttribution.test.ts';
const CONTRACT = 'backend/services/trends/googleTrendsContract.ts';
const ROUTE = 'pages/api/trending/current.ts';
const UI = 'pages/creative-scheduler.tsx';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore the hardcoded "High" on every topic',
    file: CONTRACT,
    from: '    search_volume: null,\n    search_volume_state: \'unavailable\',',
    to: "    search_volume: 'High',\n    search_volume_state: 'measured',",
  },
  {
    id: 'M2',
    name: 'restore invented topics attributed to Google Trends',
    file: CONTRACT,
    from: 'export function googleTrendsUnavailable(): GoogleTrendsTopic[] {\n  return [];',
    to: "export function googleTrendsUnavailable(): GoogleTrendsTopic[] {\n  return [googleTrendsTopic('ChatGPT'), googleTrendsTopic('Climate Change')];",
  },
  {
    id: 'M3',
    name: 'treat the trending signal as an absolute search volume',
    file: CONTRACT,
    from: "export const GOOGLE_TRENDS_SUPPORTED_EVIDENCE: ReadonlySet<string> = new Set([\n  'trending_topic',\n]);",
    to: "export const GOOGLE_TRENDS_SUPPORTED_EVIDENCE: ReadonlySet<string> = new Set([\n  'trending_topic',\n  'search_volume',\n]);",
  },
  {
    id: 'M4',
    name: 'label the unavailable volume as measured',
    file: CONTRACT,
    from: "    search_volume_state: 'unavailable',",
    to: "    search_volume_state: 'measured',",
  },
  {
    id: 'M5',
    name: 'convert missing volume into zero',
    file: CONTRACT,
    from: '  readonly search_volume: null;',
    to: '  readonly search_volume: number | null;',
    also: {
      file: CONTRACT,
      from: '    search_volume: null,\n    search_volume_state:',
      to: '    search_volume: 0,\n    search_volume_state:',
    },
  },
  {
    id: 'M6',
    name: 'invent a category the feed never supplied',
    file: CONTRACT,
    from: '    category: null,',
    to: "    category: 'General',",
  },
  {
    id: 'M7',
    name: 'bypass provenance on the observation',
    file: CONTRACT,
    from: "    provenance: 'PUBLIC_OBSERVED',",
    to: "    provenance: 'UNAVAILABLE',",
  },
  {
    id: 'M8',
    name: 'bypass the contract and re-acquire the feed inline in the route',
    file: ROUTE,
    from: '  const xmlText = await fetchHotTrendsFeed();',
    to: "  const r = await fetch('https://trends.google.com/trends/hottrends/atom/feed');\n  const xmlText = r.ok ? await r.text() : null;",
  },
  {
    id: 'M9',
    name: 'reintroduce the volume word into the AI suggestion',
    file: ROUTE,
    from: '        searchVolumeState: trend.search_volume_state,',
    to: "        searchVolume: 'High',",
  },
  {
    id: 'M10',
    name: 'reintroduce the false volume semantics in the renderer',
    file: UI,
    from: '<div className="text-xs text-gray-400">Currently trending on Google</div>',
    to: '<div className="text-xs text-gray-400">{trend.searchVolume} search volume</div>',
  },
];

const results = [];
for (const m of MUTATIONS) {
  const edits = [m, ...(m.also ? [m.also] : [])];
  const backups = new Map();
  let applicable = true;
  for (const edit of edits) {
    const original = backups.get(edit.file) ?? fs.readFileSync(edit.file, 'utf8');
    if (!backups.has(edit.file)) backups.set(edit.file, original);
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

console.log('\n================ D4 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
