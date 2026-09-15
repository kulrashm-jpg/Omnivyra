/**
 * SIX-WORKSTREAM UNION — interaction matrix: external sources and public presence.
 *
 * Each describe block names the workstreams whose invariants must BOTH survive
 * integration, and asserts the property that only holds if they do. Every workstream's
 * own suite proves its invariant in isolation; none can prove two workstreams still
 * agree once they share a codebase.
 *
 * Covers I6 (D5 × D6) and I8 (DG-011 × Report 1, and × DG-001). The full matrix is I1–I10 across unionMatrixEvidence,
 * unionMatrixReport1, unionMatrixSources and unionSerpRouting; the 17-mutation battery
 * in scripts/union-matrix-mutations.js proves these tests actually constrain what they
 * claim.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
// ROUTE-AUTH-001 (STEP 3AH-85): /api/trending/current now requires an authenticated caller.
// This suite pins the route's evidence contract, not authentication, so the identity
// provider is faked as a signed-in user (the 401 path is covered by routeAuth001AiContent).
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'route-auth-test-user' }, error: null }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// One controllable table source; tests that need specific rows swap them in.
const genericQuery = () => {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
  query.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  query.upsert = jest.fn(() => Promise.resolve({ data: null, error: null }));
  return query;
};
const mockFrom = jest.fn((_table: string) => genericQuery());
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

// The canonical outbound seam. Every provider fails unless a test says otherwise, so
// any value that reaches a payload had to come from code, not from a provider.
const safeFetch = jest.fn(async (..._args: unknown[]) => ({ ok: false }) as never);
const readCapped = jest.fn(async (_r: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
  readCapped: (response: unknown) => readCapped(response),
}));

import * as fs from 'fs';

import { observeSocialPresence } from '../../services/socialPresenceObservation';
import type { SerpKeywordResult } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import handler from '../../../pages/api/trending/current';
import { executable, productionDefiners } from '../helpers/unionMatrixFixtures';

beforeEach(() => {
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => genericQuery());
  safeFetch.mockReset();
  safeFetch.mockImplementation(async () => ({ ok: false }) as never);
  readCapped.mockReset();
  readCapped.mockImplementation(async () => Buffer.from(''));
});

// ── I6 — D5 × D6 ────────────────────────────────────────────────────────────

describe('I6 — D5 × D6: every trending lane is honest when every provider fails', () => {
  const FABRICATED = ['15420', '12300', '18700', '14200', '2.3M', '1.8M', '5.2M', '+45%', '+78%'];
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const invoke = async (platforms: string) => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })), json } as never;
    await (handler as unknown as (q: unknown, r: unknown) => Promise<void>)(
      { method: 'GET', query: { platforms } } as never,
      res,
    );
    return json.mock.calls[0][0] as Record<string, unknown>;
  };

  it('runs the real route with Google Trends, Reddit and YouTube all failing', async () => {
    // Every outbound provider refuses: the seam, and the YouTube path's own fetch.
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }) as never) as never;
    const body = await invoke('linkedin,twitter,instagram,facebook,youtube');
    const serialized = JSON.stringify(body);

    // Executed, not grepped: no invented engagement survives any lane.
    for (const literal of FABRICATED) expect(serialized).not.toContain(literal);

    // The lanes live under `trending`. This used to read `body.data ?? body` and skip
    // any undefined lane — and since `data` does not exist, EVERY lane was skipped and
    // the assertion checked nothing. Each lane is now required to be present.
    const lanes = body.trending as Record<string, unknown>;
    expect(lanes).toBeDefined();
    for (const lane of ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube']) {
      expect(lanes).toHaveProperty(lane);
      // An unavailable lane is an empty list — never a placeholder row.
      expect(lanes[lane]).toEqual([]);
    }
  });

  it('the fallback function pins every lane to its contract’s empty observation', () => {
    // WHY THIS IS STRUCTURAL. In the union, getFallbackTrendingData() is unreachable by
    // any provider failure: D4 made Google fail softly, D6 made Reddit fail softly, and
    // D5 made YouTube never fetch at all. Each was right on its own. Together they left
    // nothing in the aggregate that can throw — so no behavioural test can execute the
    // fallback, and D5's own "the fallback path invents nothing" test, which forces it
    // with a throwing fetch, silently stopped reaching it once D6 landed (on D5's own
    // branch Reddit still threw, so that test was real there).
    //
    // D6 already pins its two lanes in source. D5's guard only checks that the string
    // `youTubeTrendingUnavailable()` appears somewhere, which it does several times, so
    // a fabricated `youtube:` fallback lane passed it. This pins all five lanes by name,
    // so the fallback stays honest even though nothing can run it.
    const route = executable(fs.readFileSync('pages/api/trending/current.ts', 'utf8'));
    const start = route.indexOf('const getFallbackTrendingData');
    expect(start).toBeGreaterThan(-1);
    const body = route.slice(start, route.indexOf('\n};', start));

    expect(body).toMatch(/linkedin:\s*googleTrendsUnavailable\(\)/);
    expect(body).toMatch(/twitter:\s*redditTrendingUnavailable\(\)/);
    expect(body).toMatch(/instagram:\s*youTubeTrendingUnavailable\(\)/);
    expect(body).toMatch(/facebook:\s*redditTrendingUnavailable\(\)/);
    expect(body).toMatch(/youtube:\s*youTubeTrendingUnavailable\(\)/);
    // No lane may be an inline literal row — the shape every fabricated row took.
    expect(body).not.toMatch(/\[\s*\{/);
    for (const literal of FABRICATED) expect(body).not.toContain(literal);
  });

});


// ── I8 — DG-011 × Report 1 (and × DG-001) ───────────────────────────────────

describe('I8 — DG-011 × Report 1: presence is decided from organic rows, never from features', () => {
  const LINKEDIN = 'https://www.linkedin.com/company/drishik';

  const serp = (rows: Array<{ url: string; title?: string }>, features: SerpKeywordResult['features'] = []): SerpKeywordResult => ({
    status: 'ok',
    rows: rows.map((row, index) => ({
      position: index + 1,
      url: row.url,
      domain: new URL(row.url).hostname,
      title: row.title ?? null,
      snippet: null,
    })),
    reason: null,
    features,
  });

  const observe = (result: SerpKeywordResult) =>
    observeSocialPresence({
      candidateUrls: [LINKEDIN],
      companyName: 'Drishik',
      websiteDomain: 'drishik.com',
      fetchSerp: (async () => result) as never,
      now: () => new Date('2026-09-07T00:00:00.000Z'),
    });

  it('a profile seen in organic rows is observed, with provider text only', async () => {
    const [entry] = await observe(serp([{ url: LINKEDIN, title: 'Drishik | LinkedIn' }]));
    expect(entry.status).toBe('observed');
    expect(entry.source).toBe('serp');
    expect(entry.name).toBe('Drishik | LinkedIn');
  });

  it('a profile present ONLY as a DG-001 feature row is not promoted to observed', async () => {
    // A knowledge-panel link to the profile, with no organic row. DG-011 must not
    // start reading DG-001's sibling evidence as proof of presence.
    const [entry] = await observe(serp([], [
      { position: null, url: LINKEDIN, domain: 'www.linkedin.com', title: 'Drishik', snippet: null, result_type: 'knowledge_panel' } as never,
    ]));
    expect(entry.status).not.toBe('observed');
    expect(entry.observed_at).toBeNull();
  });

  it('an unreachable provider yields unreachable, and no entry carries an audience metric', async () => {
    const entries = await observeSocialPresence({
      candidateUrls: [LINKEDIN],
      companyName: 'Drishik',
      websiteDomain: 'drishik.com',
      fetchSerp: (async () => ({ status: 'failed', rows: [], reason: 'down', features: [] })) as never,
    });
    expect(entries[0].status).toBe('unreachable');
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'name', 'observed_at', 'platform', 'source', 'status', 'url']);
    }
  });

  it('one acquisition path, and Report 1 composition wires it', () => {
    expect(productionDefiners('export async function observeSocialPresence'))
      .toEqual(['backend/services/socialPresenceObservation.ts']);
    const obs = executable(fs.readFileSync('backend/services/socialPresenceObservation.ts', 'utf8'));
    expect(obs).not.toContain('features');
    const composer = executable(fs.readFileSync('backend/services/snapshotReportService.ts', 'utf8'));
    expect(composer).toContain('social_presence: socialPresence');
  });
});

