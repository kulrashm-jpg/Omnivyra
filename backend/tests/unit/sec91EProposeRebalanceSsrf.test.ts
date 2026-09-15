/**
 * STEP 3AH-91 SEC-E1 — propose-frequency-rebalance must never make a
 * server-side request to a caller-chosen host, and must never forward the
 * caller's credentials anywhere.
 *
 * Before the fix the route fetched `${req.headers.origin}/api/campaigns/:id/
 * platform-allocation-advice` with the caller's Authorization + Cookie
 * headers: an SSRF that also delivered the caller's session to any host named
 * in the Origin header. The advice is now computed in-process
 * (campaignPlatformAllocationAdviceService) — no HTTP hop at all.
 *
 * Only the database and the identity provider are faked (routeAuthHarness);
 * rbacService, the version stores and the advice computation run for real.
 * `fetch` is replaced by a spy that fails the request, so a regression is both
 * observable (the spy records the URL) and harmless (no real network).
 */
import {
  seed, invoke, rows, CAMPAIGN_A, CO_A,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://app.canonical.test' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

import proposeHandler from '../../../pages/api/campaigns/[id]/propose-frequency-rebalance';
import adviceHandler from '../../../pages/api/campaigns/[id]/platform-allocation-advice';

const EVIL_ORIGIN = 'https://attacker.example';
const SESSION_COOKIE = 'sb-access-token=victim-session-cookie';

const recentIso = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

function seedWorld(): void {
  seed({
    platform_strategies: [
      { campaign_id: CAMPAIGN_A, platform: 'linkedin', content_frequency: { posts_per_week: 3 } },
      { campaign_id: CAMPAIGN_A, platform: 'x', content_frequency: 2 },
    ],
    audit_logs: [
      // current window: linkedin grows, x shrinks
      ...Array.from({ length: 6 }, () => ({ action: 'TRACKING_LINK_CLICK', created_at: recentIso(2), metadata: { campaign_id: CAMPAIGN_A, platform: 'linkedin' } })),
      { action: 'TRACKING_LINK_CLICK', created_at: recentIso(3), metadata: { campaign_id: CAMPAIGN_A, platform: 'x' } },
      // previous window
      { action: 'TRACKING_LINK_CLICK', created_at: recentIso(20), metadata: { campaign_id: CAMPAIGN_A, platform: 'linkedin' } },
      ...Array.from({ length: 5 }, () => ({ action: 'TRACKING_LINK_CLICK', created_at: recentIso(21), metadata: { campaign_id: CAMPAIGN_A, platform: 'x' } })),
    ],
  });
}

let fetchSpy: jest.Mock;
const realFetch = global.fetch;

beforeEach(() => {
  seedWorld();
  // Records every attempted URL; answers "not ok" so no real network is used.
  fetchSpy = jest.fn(async (..._args: unknown[]) => ({ ok: false, status: 599, json: async () => ({ error: 'network disabled in test' }) }));
  (global as any).fetch = fetchSpy;
});
afterAll(() => { (global as any).fetch = realFetch; });

describe('SEC-E1 propose-frequency-rebalance: no request-derived outbound fetch', () => {
  it('never fetches the caller-supplied Origin and never forwards credentials', async () => {
    const out = await invoke(proposeHandler, {
      method: 'POST',
      query: { id: CAMPAIGN_A },
      as: 'A',
      headers: { origin: EVIL_ORIGIN, cookie: SESSION_COOKIE },
    });

    const fetchedUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(fetchedUrls.filter((u) => u.includes('attacker.example'))).toEqual([]);
    // No outbound HTTP at all: the advice is computed in-process.
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(out.status).toBe(200);
    expect(Array.isArray(out.body.proposed_changes)).toBe(true);
    expect(out.body.proposed_changes.length).toBeGreaterThan(0);
  });

  it('computes the same advice the advice route returns and persists the proposal', async () => {
    const advice = await invoke(adviceHandler, { method: 'GET', query: { id: CAMPAIGN_A }, as: 'A' });
    expect(advice.status).toBe(200);

    seedWorld();
    const out = await invoke(proposeHandler, {
      method: 'POST',
      query: { id: CAMPAIGN_A },
      as: 'A',
      headers: { origin: EVIL_ORIGIN },
    });
    expect(out.status).toBe(200);

    const byPlatform = Object.fromEntries(
      (advice.body.platform_advice as any[]).map((a) => [a.platform, a.suggested_frequency_delta]),
    );
    for (const change of out.body.proposed_changes as any[]) {
      const current = change.platform === 'linkedin' ? 3 : change.platform === 'x' ? 2 : 0;
      expect(change.current_frequency).toBe(current);
      expect(change.recommended_frequency).toBe(Math.max(0, current + (byPlatform[change.platform] ?? 0)));
    }

    const proposal = rows('campaign_versions').find((r) => r.status === 'proposed_rebalance');
    expect(proposal).toBeDefined();
    expect(proposal?.company_id).toBe(CO_A);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a caller from another company is refused before any computation or fetch', async () => {
    const out = await invoke(proposeHandler, {
      method: 'POST',
      query: { id: CAMPAIGN_A },
      as: 'B',
      headers: { origin: EVIL_ORIGIN, cookie: SESSION_COOKIE },
    });
    expect(out.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows('campaign_versions').some((r) => r.status === 'proposed_rebalance')).toBe(false);
  });

  it('anonymous callers get 401 and nothing is fetched', async () => {
    const out = await invoke(proposeHandler, {
      method: 'POST',
      query: { id: CAMPAIGN_A },
      headers: { origin: EVIL_ORIGIN, cookie: SESSION_COOKIE },
    });
    expect(out.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
