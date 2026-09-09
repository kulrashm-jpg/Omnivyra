#!/usr/bin/env node
/**
 * DG-011 mutation battery.
 *
 * The original DG-011 work shipped 30 tests and no mutation evidence, so nothing
 * established that those tests actually CONSTRAIN the behaviour rather than
 * merely describe it. Each entry below reintroduces one way the public
 * social-presence capability could start claiming more than it observed.
 *
 * A mutation is KILLED when the DG-011 suite fails with it applied. A SURVIVOR
 * means the suite does not constrain that behaviour — in which case the TEST is
 * strengthened, never the mutation weakened.
 *
 * Every mutation is applied to a copy, run, and reverted even if the run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/g1SocialPresenceObservation.test.ts';
const OBS = 'backend/services/socialPresenceObservation.ts';
const TYPES = 'backend/services/canonicalReport/canonicalReportTypes.ts';
const RENDER = 'backend/services/intelligence/exportRendererSectionsB.ts';
const COMPOSE = 'backend/services/snapshotReportService.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'remove public-platform detection — any URL becomes an observable profile',
    file: OBS,
    from: '    const observable = !isGenericSocialUrl(normalized) && isLikelyCompanySocialLink(platform, normalized);',
    to: '    const observable = true;',
  },
  {
    id: 'M2',
    name: 'drop the URL-identity match — any returned row counts as this profile',
    file: OBS,
    from: '    const hit = candidate.observable ? observedByKey.get(candidate.key) : undefined;',
    to: '    const hit = candidate.observable ? [...observedByKey.values()][0] : undefined;',
  },
  {
    id: 'M3',
    name: 'promote every candidate to `observed` regardless of evidence',
    file: OBS,
    from: "      status: 'observed' as const,",
    to: "      status: 'observed' as const, // forced\n      _forced: true,",
    skipIfAbsent: true,
  },
  {
    id: 'M4',
    name: 'declared becomes observed — an unmatched profile claims public evidence',
    file: OBS,
    from: "    status: 'declared',\n    observed_at: null,",
    to: "    status: 'observed',\n    observed_at: null,",
  },
  {
    id: 'M5',
    name: 'unreachable becomes declared — "we could not look" reads as "not there"',
    file: OBS,
    from: "    status: 'unreachable',\n    observed_at: null,",
    to: "    status: 'declared',\n    observed_at: null,",
  },
  {
    id: 'M6',
    name: 'fabricate provider text when the provider returned none',
    file: OBS,
    from: '      name: hit.title,\n      description: hit.snippet,',
    to: "      name: hit.title ?? 'Official profile',\n      description: hit.snippet ?? 'Active on this platform',",
  },
  {
    id: 'M7',
    name: 'forge public provenance on a non-observed entry',
    file: OBS,
    from: "    status: 'declared',\n    observed_at: null,\n    name: null,\n    description: null,\n    source: 'unspecified',",
    to: "    status: 'declared',\n    observed_at: null,\n    name: null,\n    description: null,\n    source: 'serp',",
  },
  {
    id: 'M8',
    name: 'silently DROP ineligible candidates instead of reporting them declared',
    file: OBS,
    from: '    return candidates.map((candidate) => (candidate.observable ? unreachable(candidate) : declared(candidate)));\n  }\n\n  const result = await params.fetchSerp(query, params.geography ?? null);',
    to: '    return candidates.filter((c) => c.observable).map((candidate) => unreachable(candidate));\n  }\n\n  const result = await params.fetchSerp(query, params.geography ?? null);',
  },
  {
    id: 'M9',
    name: 'a failed provider yields nothing instead of `unreachable`',
    file: OBS,
    from: "  if (result.status !== 'ok') {\n    return candidates.map((candidate) => (candidate.observable ? unreachable(candidate) : declared(candidate)));",
    to: "  if (result.status !== 'ok') {\n    return [];",
  },
  {
    id: 'M10',
    name: 'bypass the canonical path — issue a query with no identity anchor',
    file: OBS,
    from: '  const query = observableCandidates.length > 0 ? buildSocialObservationQuery(params) : null;',
    to: "  const query = observableCandidates.length > 0 ? (buildSocialObservationQuery(params) ?? 'social profile') : null;",
  },
  {
    id: 'M11',
    name: 'add a fabricated follower metric to the exposed contract',
    file: TYPES,
    from: '  source: EvidenceSourceKind;\n};\n\nexport type CanonicalDeclaredEvidence = {',
    to: '  source: EvidenceSourceKind;\n  follower_count: number;\n};\n\nexport type CanonicalDeclaredEvidence = {',
  },
  {
    id: 'M12',
    name: 'renderer states presence as activity/audience',
    file: RENDER,
    from: 'Observation confirms the profile is indexed publicly; it is not a measure of activity or audience.',
    to: 'Observation confirms an active, engaged audience on each platform.',
  },
  {
    id: 'M13',
    name: 'renderer reports declared profiles as publicly observed',
    file: RENDER,
    from: "    const declared = social.filter((s) => s.status === 'declared');",
    to: "    const declared = [];",
  },
  {
    id: 'M14',
    name: 'renderer hides the unreachable lane, so absence of looking reads as absence',
    file: RENDER,
    from: "    const unreachable = social.filter((s) => s.status === 'unreachable');",
    to: '    const unreachable = [];',
  },
  {
    id: 'M15',
    name: 'composition drops social_presence from the Report 1 payload',
    file: COMPOSE,
    from: '        ? { ...publicAudit, declared_evidence: { ...publicAudit.declared_evidence, social_presence: socialPresence } }',
    to: '        ? { ...publicAudit }',
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

console.log('\n================ DG-011 MUTATION RESULTS ================');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
