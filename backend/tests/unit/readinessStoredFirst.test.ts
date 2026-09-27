/**
 * fetchReadinessData — stored-first read and profile reuse.
 *
 * feature-completion?sync=true recomputes every feature before answering
 * (measured up to 21,722ms). The command center now renders the STORED state
 * (sync:false) and runs the recompute afterwards, reusing the profile its own
 * wave already loaded instead of issuing another company-profile request.
 *
 * Defaults are load-bearing: other callers (useUserState) pass no options and
 * must keep the original sync=true + own-profile-read behaviour.
 */
import { fetchReadinessData } from '../../services/commandCenterReadinessService';

const jsonRes = (body: unknown, ok = true) => ({
  ok, statusText: ok ? 'OK' : 'Server Error', json: async () => body,
});

const FEATURES_BODY = { data: { features: [{ key: 'report_generated', status: 'completed', score: 1 }] } };
const SCORE_BODY = { data: { score: 62, level: 'growing', completedFeatures: 3, totalFeatures: 8 } };
const PROFILE = { name: 'Acme', industry: 'SaaS', team_size: '10', website_url: 'https://acme.test', linkedin_url: 'https://l', x_url: 'https://x' };

let urls: string[] = [];
const realFetch = global.fetch;

beforeEach(() => {
  urls = [];
  (global as any).fetch = jest.fn(async (url: string) => {
    urls.push(String(url));
    if (String(url).includes('/api/feature-completion')) return jsonRes(FEATURES_BODY);
    if (String(url).includes('/api/readiness-score')) return jsonRes(SCORE_BODY);
    if (String(url).includes('/api/company-profile')) return jsonRes({ profile: PROFILE });
    return jsonRes({});
  });
});
afterAll(() => { (global as any).fetch = realFetch; });

const featureUrl = () => urls.find((u) => u.includes('/api/feature-completion'))!;
const profileCalls = () => urls.filter((u) => u.includes('/api/company-profile')).length;
const score = (out: any, key: string) => out.features.find((f: any) => f.key === key)?.score;

describe('sync option', () => {
  it('defaults to sync=true (existing callers unchanged)', async () => {
    await fetchReadinessData('company-1');
    expect(featureUrl()).toContain('sync=true');
  });

  it('sync:false reads stored state — no sync param', async () => {
    await fetchReadinessData('company-1', { sync: false });
    expect(featureUrl()).not.toContain('sync=');
    expect(featureUrl()).toContain('company_id=company-1');
  });
});

describe('profile reuse', () => {
  it('without a profile, reads its own (existing behaviour)', async () => {
    await fetchReadinessData('company-1');
    expect(profileCalls()).toBe(1);
  });

  it('with a profile, issues NO company-profile request', async () => {
    await fetchReadinessData('company-1', { profile: PROFILE });
    expect(profileCalls()).toBe(0);
  });

  it('a supplied profile yields the same signals as a fetched one', async () => {
    const fetched = await fetchReadinessData('company-1');
    const supplied = await fetchReadinessData('company-1', { profile: PROFILE });
    for (const key of ['website_connected', 'company_profile_completed', 'social_accounts_connected']) {
      expect(score(supplied, key)).toBe(score(fetched, key));
    }
    expect(score(supplied, 'social_accounts_connected')).toBe(0.7); // 2 socials
  });

  it('a null profile (loaded, but empty) scores zero without refetching', async () => {
    const out = await fetchReadinessData('company-1', { profile: null });
    expect(profileCalls()).toBe(0);
    expect(score(out, 'company_profile_completed')).toBe(0);
    expect(score(out, 'website_connected')).toBe(0);
  });
});
