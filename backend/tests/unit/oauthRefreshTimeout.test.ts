/**
 * D2 (stall closure): OAuth token-refresh HTTP calls carry an axios timeout.
 *
 * axios waits forever by default. ingestComments refreshes an expiring or rejected
 * token INSIDE recentPublishedPostsIngest, whose timer re-arms only after its body
 * returns while its lease keeps renewing - so one OAuth endpoint that never answered
 * froze comment ingestion for every tenant (Orchestration review of ab4c6dd96).
 *
 * The axios mock models a provider that NEVER answers: with a timeout set it rejects
 * the way axios does when that timeout fires (ECONNABORTED); with no timeout it never
 * settles - so a refresh call without the timeout hangs this test instead of passing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const configs: Array<{ url: string; config: any }> = [];
function neverAnswers(url: string, config: any) {
  configs.push({ url, config });
  if (config?.timeout > 0) {
    const e: any = new Error(`timeout of ${config.timeout}ms exceeded`);
    e.code = 'ECONNABORTED';
    return Promise.reject(e);
  }
  return new Promise(() => undefined); // hangs forever: axios' default (timeout 0)
}
jest.mock('axios', () => {
  const post = (url: string, _body: unknown, config: any) => neverAnswers(url, config);
  const get = (url: string, config: any) => neverAnswers(url, config);
  return { __esModule: true, default: { post, get }, post, get };
});
jest.mock('@/config', () => ({ config: { LINKEDIN_CLIENT_ID: 'id', LINKEDIN_CLIENT_SECRET: 'secret' } }), { virtual: true });
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'secret' }),
}));
const mockSetToken = jest.fn();
jest.mock('../../auth/tokenStore', () => ({
  getToken: async () => ({ access_token: 'a', refresh_token: 'r' }),
  setToken: (...a: unknown[]) => mockSetToken(...a),
  markSocialAccountNeedsReauth: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));

import { refreshLinkedInToken, refreshFacebookToken, refreshYouTubeToken } from '../../auth/tokenRefreshCore';
import { refreshSpotifyToken, refreshTikTokToken, refreshRedditToken, refreshPinterestToken } from '../../auth/tokenRefreshFlows';
import { OAUTH_REFRESH_TIMEOUT_MS } from '../../auth/oauthRefreshTimeout';

const TOKEN = { access_token: 'a', refresh_token: 'r', expires_at: new Date().toISOString(), token_type: 'Bearer' } as any;

beforeEach(() => { configs.length = 0; mockSetToken.mockClear(); });

it('the timeout is 15 seconds', () => {
  expect(OAUTH_REFRESH_TIMEOUT_MS).toBe(15_000);
});

it.each([
  ['linkedin', refreshLinkedInToken],
  ['facebook', refreshFacebookToken],
  ['youtube', refreshYouTubeToken],
  ['spotify', refreshSpotifyToken],
  ['tiktok', refreshTikTokToken],
  ['reddit', refreshRedditToken],
  ['pinterest', refreshPinterestToken],
] as const)('%s: a refresh whose OAuth endpoint never answers ends as a failed refresh (null), never a hang', async (_p, refresh) => {
  const r = await (refresh as any)('acct-1', TOKEN, 'app-id', 'app-secret');
  expect(r).toBeNull();
  expect(configs.length).toBeGreaterThan(0);
  for (const c of configs) expect(c.config?.timeout).toBe(OAUTH_REFRESH_TIMEOUT_MS);
  expect(mockSetToken).not.toHaveBeenCalled(); // timeout only: nothing is stored
});

it('every axios call in the refresh modules (X/Twitter included, whose flow runs under a DB lock) carries the timeout', () => {
  for (const f of ['tokenRefreshCore.ts', 'tokenRefreshFlows.ts']) {
    const src = readFileSync(join(__dirname, '../../auth', f), 'utf8');
    const calls = src.match(/axios\.(post|get|put|patch|request)\(/g) ?? [];
    const timeouts = src.match(/timeout: OAUTH_REFRESH_TIMEOUT_MS,/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(timeouts.length).toBe(calls.length);
  }
});
