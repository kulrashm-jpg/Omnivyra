#!/usr/bin/env node
/**
 * D5 mutation battery.
 *
 * Each entry reintroduces one way a fabricated YouTube observation could be
 * published again, or one way the fix could be faked. A mutation is KILLED when
 * the D5 suite fails with it applied; a SURVIVOR means the suite does not
 * constrain that behaviour.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d5YouTubeFabricatedEvidence.test.ts';
const CONTRACT = 'backend/services/trends/youtubeTrendsContract.ts';
const ROUTE = 'pages/api/trending/current.ts';
const UI = 'pages/creative-scheduler.tsx';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore the mock trending-video array in the route',
    file: ROUTE,
    from: '  const acquisition = youTubeTrendsAcquisition();',
    to: `  const mockTrendingVideos = [
    { keyword: "AI Revolution", views: "2.3M", growth: "+45%", category: "Technology", source: "YouTube" },
    { keyword: "Remote Work Tips", views: "1.8M", growth: "+32%", category: "Business", source: "YouTube" },
  ];
  return mockTrendingVideos as never;
  const acquisition = youTubeTrendsAcquisition();`,
  },
  {
    id: 'M2',
    name: 'restore the invented view counts on the observation',
    file: CONTRACT,
    from: "    views: null,\n    views_state: 'unavailable',",
    to: "    views: '2.3M' as never,\n    views_state: 'measured',",
  },
  {
    id: 'M3',
    name: 'restore the invented growth rate on the observation',
    file: CONTRACT,
    from: "    growth: null,\n    growth_state: 'unavailable',",
    to: "    growth: '+45%' as never,\n    growth_state: 'measured',",
  },
  {
    id: 'M4',
    name: 'label the unavailable view count as measured',
    file: CONTRACT,
    from: "    views_state: 'unavailable',",
    to: "    views_state: 'measured',",
  },
  {
    id: 'M5',
    name: 'label the unavailable growth as inferred rather than unavailable',
    file: CONTRACT,
    from: "    growth_state: 'unavailable',",
    to: "    growth_state: 'inferred',",
  },
  {
    id: 'M6',
    name: 'convert a missing view count into zero',
    file: CONTRACT,
    from: '  readonly views: null;',
    to: '  readonly views: number | null;',
    also: {
      file: CONTRACT,
      from: '    views: null,\n    views_state:',
      to: '    views: 0,\n    views_state:',
    },
  },
  {
    id: 'M7',
    name: 'declare a view growth rate supportable',
    file: CONTRACT,
    from: "export const YOUTUBE_TRENDS_UNSUPPORTABLE_EVIDENCE: ReadonlySet<string> = new Set([\n  'view_growth_rate',\n]);",
    to: 'export const YOUTUBE_TRENDS_UNSUPPORTABLE_EVIDENCE: ReadonlySet<string> = new Set([]);',
    also: {
      file: CONTRACT,
      from: 'export const YOUTUBE_TRENDS_SUPPORTED_EVIDENCE: ReadonlySet<string> = new Set([]);',
      to: "export const YOUTUBE_TRENDS_SUPPORTED_EVIDENCE: ReadonlySet<string> = new Set(['view_growth_rate']);",
    },
  },
  {
    id: 'M8',
    name: 'flip acquisition to available without any sanctioned path',
    file: CONTRACT,
    from: '  if (YOUTUBE_TRENDS_SUPPORTED_EVIDENCE.size === 0) {\n    return { available: false, reason: YOUTUBE_TRENDS_NO_ACQUISITION_REASON };\n  }\n  return { available: true };',
    to: '  return { available: true };',
  },
  {
    id: 'M9',
    name: 'return invented videos from the unavailable state',
    file: CONTRACT,
    from: 'export function youTubeTrendingUnavailable(): YouTubeTrendingObservation[] {\n  return [];',
    to: "export function youTubeTrendingUnavailable(): YouTubeTrendingObservation[] {\n  return [youTubeTrendingObservation('AI Tutorials'), youTubeTrendingObservation('Tech Reviews')];",
  },
  {
    id: 'M10',
    name: 'invent a category the trending list never supplied',
    file: CONTRACT,
    from: '    category: null,',
    to: "    category: 'Technology' as never,",
  },
  {
    id: 'M11',
    name: 'bypass the contract and rebuild the fallback rows inline',
    file: ROUTE,
    from: '    instagram: youTubeTrendingUnavailable(),',
    to: '    instagram: [\n      { keyword: "AI Revolution", views: "2.3M", growth: "+45%", category: "Technology", source: "YouTube" },\n    ] as never,',
  },
  {
    id: 'M12',
    name: 'bypass the contract on the youtube fallback key',
    file: ROUTE,
    from: '    youtube: youTubeTrendingUnavailable(),',
    to: '    youtube: [\n      { keyword: "AI Tutorials", views: "5.2M", growth: "+78%", category: "Education", source: "YouTube" },\n    ] as never,',
  },
  {
    id: 'M13',
    name: 'reintroduce the view count in the AI suggestion text',
    file: ROUTE,
    from: 'text: `📸 "${trend.keyword}" trending on YouTube`,',
    to: 'text: `📸 "${trend.keyword}" trending with ${trend.views} views`,',
  },
  {
    id: 'M14',
    name: 'reintroduce the growth rate as suggestion engagement',
    file: ROUTE,
    from: '        viewsState: trend.views_state,\n        growthState: trend.growth_state,\n        clickable: true\n      });\n    });\n  }\n\n  // Facebook',
    to: '        engagement: trend.growth,\n        clickable: true\n      });\n    });\n  }\n\n  // Facebook',
  },
  {
    id: 'M15',
    name: 'restore the "Free Tier" claim on the YouTube source rows',
    file: ROUTE,
    from: '{ name: "YouTube", platform: "Instagram/TikTok", status: "Unavailable", description: "No sanctioned YouTube trending source is configured" },',
    to: '{ name: "YouTube", platform: "Instagram/TikTok", status: "Free Tier", description: "Visual content & viral videos" },',
  },
  {
    id: 'M16',
    name: 'reintroduce the view count in the scheduler card',
    file: UI,
    from: '<div className="text-xs text-gray-400">Trending on YouTube</div>',
    to: '<div className="text-xs text-gray-400">{trend.views} views</div>',
  },
  {
    id: 'M17',
    name: 'reintroduce the growth rate beside the card icon',
    file: UI,
    from: '                                      <span className="text-xs text-pink-400">📸</span>\n                                    </div>',
    to: '                                      <span className="text-xs text-pink-400">📸</span>\n                                      <span className="text-pink-400 text-xs">{trend.growth}</span>\n                                    </div>',
  },
  {
    id: 'M18',
    name: 'reintroduce the fabricated view count in the generated post body',
    file: UI,
    from: 'content: `Visual trend: ${trend.keyword}`',
    to: 'content: `Visual trend: ${trend.keyword} with ${trend.views} views`',
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

console.log('\n================ D5 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
