/**
 * SIX-WORKSTREAM UNION — interaction I9: DG-001 × Report 1.
 *
 * Every Report 1 SERP acquisition must route through DG-001's canonical client, at the
 * depth its consumer is entitled to, against the provider Report 1 is pinned to. The
 * union put D8 and DG-011 into the same files DG-001 consolidated, so this re-proves
 * the routing holds with all three present rather than trusting DG-001's own suite,
 * which ran before either of them landed.
 *
 * Kept separate from unionInteractionMatrix.test.ts because it replaces the canonical
 * client for the whole module — the question here is what each consumer ASKS FOR.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

const fetchCanonicalSerp = jest.fn();
jest.mock('../../services/serp/canonicalSerpClient', () => ({
  ...jest.requireActual('../../services/serp/canonicalSerpClient'),
  fetchCanonicalSerp: (...args: unknown[]) => fetchCanonicalSerp(...args),
}));

import * as fs from 'fs';
import { execSync } from 'child_process';

import { fetchSerpResultsForKeyword } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { enrichCompetitorCandidate } from '../../services/competitorEnrichmentService';
import { REPORT_SERP_PROVIDER } from '../../services/serp/canonicalSerpClient';
import {
  SERP_RESULT_TYPES,
  normalizeSerpResultType,
  isPersistableSerpResultType,
} from '../../services/serp/serpResultTypes';

const ROWS = [
  { position: 1, url: 'https://drishik.com/a', domain: 'drishik.com', title: 'A', snippet: 'Snip A', result_type: 'organic' },
  { position: null, url: null, domain: null, title: 'What is Drishik?', snippet: null, result_type: 'people_also_ask' },
];
const ok = (rows: unknown[]) => ({ status: 'ok', refusedBy: null, rows, reason: null, provider: 'serpapi' });

const executable = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

beforeEach(() => {
  fetchCanonicalSerp.mockReset();
  fetchCanonicalSerp.mockResolvedValue(ok(ROWS));
});

const callFor = (operation: string) =>
  fetchCanonicalSerp.mock.calls.map((c) => c[0] as Record<string, unknown>).find((a) => a.operation === operation);

describe('I9 — DG-001 × Report 1: every Report 1 SERP path is the canonical one', () => {
  it('Path B (Report 1 search) asks the canonical client for depth 10', async () => {
    await fetchSerpResultsForKeyword('drishik', null);
    expect(fetchCanonicalSerp).toHaveBeenCalledTimes(1);
    expect(callFor('search')?.depth).toBe(10);
  });

  it('Path C (competitor enrichment) asks the canonical client for depth 5', async () => {
    await enrichCompetitorCandidate({ candidate: { name: 'Rival', domain: 'rival.test' }, useNetwork: true, useStoredCache: false } as never);
    expect(callFor('competitor_enrichment')?.depth).toBe(5);
  });

  it('the warehouse path (Report 2 / enterprise) keeps its own depth of 50', () => {
    const warehouse = fs.readFileSync('backend/services/serpAcquisitionService.ts', 'utf8');
    expect(executable(warehouse)).toContain('SERP_RESULT_DEPTH ?? 50');
  });

  it('Report 1 is pinned to SerpAPI — the real constant, not a mocked one', () => {
    expect(REPORT_SERP_PROVIDER).toBe('serpapi');
  });

  it('neither Path B nor Path C issues a provider request of its own', () => {
    for (const file of [
      'backend/services/reportCompetitorIntelligenceServiceHelpers.ts',
      'backend/services/competitorEnrichmentService.ts',
    ]) {
      const code = executable(fs.readFileSync(file, 'utf8'));
      expect(code).toContain('fetchCanonicalSerp');
      expect(code).not.toMatch(/serpapi\.com/);
    }
    // Across the codebase, only the two sanctioned modules fetch the provider.
    const requesters = execSync('git grep -l --untracked "serpapi\\.com" -- "backend" "pages" || true', { encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((f) => !f.includes('/tests/'))
      .filter((f) => {
        const code = executable(fs.readFileSync(f, 'utf8'));
        return /serpapi\.com/.test(code) && /(fetch|axios)/.test(code);
      });
    expect(requesters.sort()).toEqual([
      'backend/services/serp/canonicalSerpClient.ts',
      'backend/services/serpAcquisitionService.ts',
    ]);
  });

  it('features stay out of the organic ranking array in the union', async () => {
    const out = await fetchSerpResultsForKeyword('drishik', null);
    expect(out.rows.map((r) => r.domain)).toEqual(['drishik.com']);
    expect(out.features.map((f) => f.result_type)).toEqual(['people_also_ask']);
  });

  it('the feature vocabulary is closed: an unknown provider label is rejected, not guessed', () => {
    expect(normalizeSerpResultType('totally_new_block')).toBeNull();
    expect(normalizeSerpResultType('')).toBeNull();
    expect(normalizeSerpResultType(42)).toBeNull();
  });

  it('every provider label translates INTO the closed vocabulary, and nowhere else', () => {
    // The translator maps what providers actually emit. It is deliberately NOT an
    // identity over canonical names: no provider says bare `local` (they say
    // `local_pack`, `local_results`, `map_pack`), so `local` is not a label it accepts.
    // What closedness requires is that nothing it returns falls outside the set.
    const labels = [
      'organic_results', 'answer_box', 'related_questions', 'knowledge_graph', 'inline_sitelinks',
      'local_pack', 'map_pack', 'inline_images', 'inline_videos', 'top_stories', 'shopping_results', 'ads',
    ];
    const closed = new Set<string>(SERP_RESULT_TYPES);
    for (const label of labels) {
      const type = normalizeSerpResultType(label);
      expect(type).not.toBeNull();
      expect(closed.has(type as string)).toBe(true);
    }
    expect(normalizeSerpResultType('local_pack')).toBe('local');
    expect(normalizeSerpResultType('related_questions')).toBe('people_also_ask');
    expect(normalizeSerpResultType('knowledge_graph')).toBe('knowledge_panel');
  });

  it('features the deployed schema cannot hold are withheld, not relabelled', () => {
    // The widening migration is deliberately unapplied, so only the original four are
    // persistable; everything else must be withheld rather than stored as `other`.
    expect(isPersistableSerpResultType('organic')).toBe(true);
    expect(isPersistableSerpResultType('people_also_ask')).toBe(false);
    expect(isPersistableSerpResultType('knowledge_panel')).toBe(false);
  });
});
