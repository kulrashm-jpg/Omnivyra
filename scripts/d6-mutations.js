#!/usr/bin/env node
/**
 * D6 mutation battery.
 *
 * Each entry reintroduces one way invented Reddit engagement could reach a
 * customer again, or one way the fix could be faked. A mutation is KILLED when
 * the D6 suite fails with it applied; a SURVIVOR means the suite does not
 * constrain that behaviour.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d6RedditFallbackFabrication.test.ts';
const CONTRACT = 'backend/services/trends/redditTrendingContract.ts';
const ROUTE = 'pages/api/trending/current.ts';
const UI = 'pages/creative-scheduler.tsx';

const INVENTED_TWITTER =
  '    return [\n' +
  '      { keyword: "AI Revolution", upvotes: 15420, subreddit: "technology", category: "Reddit", source: "Reddit" },\n' +
  '      { keyword: "Remote Work", upvotes: 12300, subreddit: "workfromhome", category: "Reddit", source: "Reddit" },\n' +
  '    ];';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore the invented upvote rows on the Reddit failure path',
    file: ROUTE,
    from: '    return redditTrendingUnavailable();\n  }\n  return redditTrendingPosts(listing);',
    to: INVENTED_TWITTER + '\n  }\n  return redditTrendingPosts(listing);',
  },
  {
    id: 'M2',
    name: 'restore the invented twitter fallback array',
    file: ROUTE,
    from: '    twitter: redditTrendingUnavailable(),',
    to: '    twitter: [\n'
      + '      { keyword: "AI Revolution", upvotes: 15420, subreddit: "technology", category: "Reddit", source: "Reddit" },\n'
      + '      { keyword: "Remote Work", upvotes: 12300, subreddit: "workfromhome", category: "Reddit", source: "Reddit" },\n'
      + '    ],',
  },
  {
    id: 'M3',
    name: 'restore the invented facebook fallback array',
    file: ROUTE,
    from: '    facebook: redditTrendingUnavailable(),',
    to: '    facebook: [\n'
      + '      { keyword: "Mental Health", upvotes: 18700, subreddit: "selfimprovement", category: "Reddit", source: "Reddit" },\n'
      + '      { keyword: "Community Building", upvotes: 14200, subreddit: "socialskills", category: "Reddit", source: "Reddit" },\n'
      + '    ],',
  },
  {
    id: 'M4',
    name: 'invent rows inside the contract instead of returning silence',
    file: CONTRACT,
    from: 'export function redditTrendingUnavailable(): RedditTrendingPost[] {\n  return [];',
    to: 'export function redditTrendingUnavailable(): RedditTrendingPost[] {\n'
      + "  return [redditTrendingPost({ data: { title: 'AI Revolution', ups: 15420, subreddit: 'technology' } })!];",
  },
  {
    id: 'M5',
    name: 'label a withheld score as measured',
    file: CONTRACT,
    from: "    upvotes_state: observed ? 'measured' : 'insufficient_signal',",
    to: "    upvotes_state: 'measured',",
  },
  {
    id: 'M6',
    name: 'convert a withheld score into zero',
    file: CONTRACT,
    from: '    upvotes: observed ? (raw as number) : null,',
    to: '    upvotes: observed ? (raw as number) : 0,',
  },
  {
    id: 'M7',
    name: 'ignore score_hidden and read the withheld number anyway',
    file: CONTRACT,
    from: '  const hidden = data?.score_hidden === true;',
    to: '  const hidden = false;',
  },
  {
    id: 'M8',
    name: 'complete a row whose community was never observed',
    file: CONTRACT,
    from: '  if (!keyword || !subreddit) return null;',
    to: "  if (!keyword) return null;",
    also: {
      file: CONTRACT,
      from: '    subreddit,\n    upvotes:',
      to: "    subreddit: subreddit || 'technology',\n    upvotes:",
    },
  },
  {
    id: 'M9',
    name: 'invent a category the listing never supplied',
    file: CONTRACT,
    from: '    category: null,\n    source: REDDIT_SOURCE_LABEL,',
    to: "    category: 'Reddit',\n    source: REDDIT_SOURCE_LABEL,",
  },
  {
    id: 'M10',
    name: 'declare support for engagement the listing cannot establish',
    file: CONTRACT,
    from: "  'popular_listing_membership',\n  'post_score',\n  'post_subreddit',\n]);",
    to: "  'popular_listing_membership',\n  'post_score',\n  'post_subreddit',\n  'estimated_engagement',\n]);",
  },
  {
    id: 'M11',
    name: 'bypass the contract and re-acquire the listing inline in the route',
    file: ROUTE,
    from: '  const listing = await fetchPopularListing();',
    to: "  const r = await fetch('https://www.reddit.com/r/popular.json?limit=5');\n  const listing = r.ok ? await r.json() : null;",
  },
  {
    id: 'M12',
    name: 'drop the upvote state from the AI suggestion, leaving a bare number',
    file: ROUTE,
    from: '        upvotes: trend.upvotes,\n        upvotesState: trend.upvotes_state,\n        clickable: true\n      });\n    });\n  }\n\n  // Instagram',
    to: '        upvotes: trend.upvotes,\n        clickable: true\n      });\n    });\n  }\n\n  // Instagram',
  },
  {
    id: 'M13',
    name: 'render the upvote count unconditionally again (twitter card)',
    file: UI,
    from: "                                      <span className=\"text-sky-400 text-xs\">\n                                        {trend.upvotes_state === 'measured' ? trend.upvotes : 'Score hidden'}\n                                      </span>",
    to: '                                      <span className="text-sky-400 text-xs">{trend.upvotes}</span>',
  },
  {
    id: 'M14',
    name: 'render the upvote count unconditionally again (facebook card)',
    file: UI,
    from: "                                      <span className=\"text-indigo-400 text-xs\">\n                                        {trend.upvotes_state === 'measured' ? trend.upvotes : 'Score hidden'}\n                                      </span>",
    to: '                                      <span className="text-indigo-400 text-xs">{trend.upvotes}</span>',
  },
  {
    id: 'M15',
    name: 'pad the lane up to the limit with a repeated observation',
    file: CONTRACT,
    from: '  return parsePopularListing(body)\n    .slice(0, limit)',
    to: '  const parsed = parsePopularListing(body);\n'
      + '  while (parsed.length > 0 && parsed.length < limit) parsed.push(parsed[0]);\n'
      + '  return parsed\n    .slice(0, limit)',
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

console.log('\n================ D6 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
