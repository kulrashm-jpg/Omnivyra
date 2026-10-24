/**
 * @jest-environment jsdom
 */
/**
 * Closure-011 — the super-admin analytics WRITES (GA/GSC connect, property
 * selection, sync) and the rollout console go through the established
 * super-admin step-up flow instead of dead-ending on 401 STEP_UP_REQUIRED.
 *
 * Real: useAnalyticsTabController, submitSuperAdminWrite,
 * runStepUpFlowIfNeeded, classifyAuthFailure. Mocked: fetchWithAuth (a
 * route double counting POSTs), next/router, analytics tracking, and the
 * WebAuthn ceremony (no real passkey is exercised).
 */
import { act, renderHook } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

const mockCeremony = jest.fn();
jest.mock('../../../lib/security/stepUpClient', () => ({
  triggerWebAuthnStepUp: (...a: unknown[]) => mockCeremony(...a),
}));
jest.mock('next/router', () => ({ useRouter: () => ({ isReady: false, query: {} }) }));
jest.mock('@/lib/websiteAnalytics', () => ({ trackWebsiteEvent: jest.fn() }));

type Answer = { status: number; body: Record<string, unknown> };
const mockAnswers: Record<string, Answer[]> = {};
const mockPosts: string[] = [];
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: jest.fn(async (url: string, init?: { method?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') mockPosts.push(url);
    const queue = mockAnswers[`${method} ${url}`] ?? [];
    const a = queue.length > 1 ? queue.shift()! : (queue[0] ?? { status: 500, body: { error: 'no route' } });
    const make = (): unknown => ({
      ok: a.status >= 200 && a.status < 300, status: a.status,
      headers: { get: () => null }, json: async () => a.body, clone: () => make(),
    });
    return make();
  }),
}));

import { useAnalyticsTabController } from '../../../components/super-admin/tabs/AnalyticsTabController';

const PROPS = {
  isLoadingAnalytics: false, analyticsSummary: null, campaignHealth: null, isLoadingCampaignHealth: false,
  canShowExternalApisTab: false, externalApisHealth: null, companies: [], onNavigateToApis: () => undefined,
};
const STEP_UP: Answer = { status: 401, body: { code: 'STEP_UP_REQUIRED', error: 'Step-up authentication required', capability: 'integration.platform.oauth.manage' } };
const answer = (method: string, url: string, ...a: Answer[]) => { mockAnswers[`${method} ${url}`] = a; };

beforeEach(() => {
  for (const k of Object.keys(mockAnswers)) delete mockAnswers[k];
  mockPosts.length = 0;
  mockCeremony.mockReset();
  mockCeremony.mockResolvedValue({ stepUp: { id: 'su-1' } });
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true, status: 201 }));
  // GA not connected → the stale-data auto refresh never fires on mount.
  answer('GET', '/api/super-admin/ga-analytics-summary', { status: 200, body: { ga_status: { connected: false } } });
});

async function mount() {
  const hook = renderHook(() => useAnalyticsTabController(PROPS));
  await act(async () => { /* settle the mount-time summary load */ });
  return hook;
}
const posts = (url: string) => mockPosts.filter((u) => u === url).length;

describe('analytics writes through the established step-up flow', () => {
  it('a normal successful write is unchanged: one POST, success notice, no passkey prompt', async () => {
    answer('POST', '/api/super-admin/gsc-sync', { status: 200, body: { status: 'synced', records_written: 3 } });
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshSearchConsole(); });
    expect(posts('/api/super-admin/gsc-sync')).toBe(1);
    expect(mockCeremony).not.toHaveBeenCalled();
    expect(result.current.gaNotice).toBe('Search Console refreshed (3 records).');
    expect(result.current.gaAnalyticsError).toBeNull();
  });

  it('401 STEP_UP_REQUIRED → passkey ceremony → ONE retry → success (exactly two POSTs, the first did nothing server-side)', async () => {
    answer('POST', '/api/super-admin/gsc-sync', STEP_UP, { status: 200, body: { status: 'synced', records_written: 2 } });
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshSearchConsole(); });
    expect(mockCeremony).toHaveBeenCalledTimes(1);
    expect(posts('/api/super-admin/gsc-sync')).toBe(2);
    expect(result.current.gaNotice).toBe('Search Console refreshed (2 records).');
    expect(result.current.gaAnalyticsError).toBeNull();
  });

  it('the operator cancels the passkey prompt: one POST, an error, and NO success notice', async () => {
    mockCeremony.mockRejectedValue(new Error('NotAllowedError: cancelled'));
    answer('POST', '/api/super-admin/gsc-sync', STEP_UP, { status: 200, body: { status: 'synced' } });
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshSearchConsole(); });
    expect(posts('/api/super-admin/gsc-sync')).toBe(1);
    expect(result.current.gaAnalyticsError).toMatch(/cancelled/i);
    expect(result.current.gaNotice).toBeNull();
  });

  it('step-up is unavailable (no passkey): an explicit error, one POST, no success', async () => {
    mockCeremony.mockRejectedValue(new Error('No passkey registered for this account'));
    answer('POST', '/api/super-admin/ga-select-property', STEP_UP);
    const { result } = await mount();
    act(() => { result.current.setSelectedPropertyId('prop-1'); });
    await act(async () => { await result.current.handleSelectProperty(); });
    expect(posts('/api/super-admin/ga-select-property')).toBe(1);
    expect(result.current.gaAnalyticsError).toMatch(/not available/i);
    expect(result.current.gaNotice).toBeNull();
  });

  it('401 NOT_AUTHENTICATED is the session path: no passkey prompt, one POST, a session error', async () => {
    answer('POST', '/api/super-admin/gsc-sync', { status: 401, body: { code: 'NOT_AUTHENTICATED', error: 'Authorization required' } });
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshSearchConsole(); });
    expect(mockCeremony).not.toHaveBeenCalled();
    expect(posts('/api/super-admin/gsc-sync')).toBe(1);
    expect(result.current.gaAnalyticsError).toMatch(/session has expired/i);
  });

  it('403 (not a platform SUPER_ADMIN): no passkey prompt, no loop, the SERVER message is shown', async () => {
    answer('POST', '/api/super-admin/ga-select-property', { status: 403, body: { error: 'Forbidden', code: 'PLATFORM_SUPER_ADMIN_REQUIRED' } });
    const { result } = await mount();
    act(() => { result.current.setSelectedPropertyId('prop-1'); });
    await act(async () => { await result.current.handleSelectProperty(); });
    expect(mockCeremony).not.toHaveBeenCalled();
    expect(posts('/api/super-admin/ga-select-property')).toBe(1);
    expect(result.current.gaAnalyticsError).toBe('Forbidden (PLATFORM_SUPER_ADMIN_REQUIRED)');
    expect(result.current.gaNotice).toBeNull();
  });

  it('step-up succeeds but the retry is still denied: exactly one prompt and two POSTs — no loop, no success', async () => {
    answer('POST', '/api/super-admin/gsc-sync', STEP_UP, STEP_UP, STEP_UP);
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshSearchConsole(); });
    expect(mockCeremony).toHaveBeenCalledTimes(1);
    expect(posts('/api/super-admin/gsc-sync')).toBe(2);
    expect(result.current.gaAnalyticsError).toBeTruthy();
    expect(result.current.gaNotice).toBeNull();
  });

  it('a failing sync (502) shows the server message, not "Access denied"', async () => {
    answer('POST', '/api/super-admin/gsc-sync', { status: 502, body: { error: 'Search Console sync failed', code: 'GSC_SYNC_FAILED' } });
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshSearchConsole(); });
    expect(result.current.gaAnalyticsError).toBe('Search Console sync failed (GSC_SYNC_FAILED)');
    expect(mockCeremony).not.toHaveBeenCalled();
  });

  it('the AUTOMATIC GA refresh never raises a passkey prompt: one POST, a "run it from its button" message', async () => {
    answer('POST', '/api/super-admin/ga-sync', STEP_UP);
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshGoogleAnalytics({ automatic: true }); });
    expect(mockCeremony).not.toHaveBeenCalled();
    expect(posts('/api/super-admin/ga-sync')).toBe(1);
    expect(result.current.gaAnalyticsError).toMatch(/passkey confirmation/i);
  });

  it('the MANUAL GA refresh does run the ceremony and retries once', async () => {
    answer('POST', '/api/super-admin/ga-sync', STEP_UP, { status: 200, body: { status: 'synced' } });
    const { result } = await mount();
    await act(async () => { await result.current.handleRefreshGoogleAnalytics(); });
    expect(mockCeremony).toHaveBeenCalledTimes(1);
    expect(posts('/api/super-admin/ga-sync')).toBe(2);
    expect(result.current.gaNotice).toBe('Google Analytics refreshed.');
  });

  it('GA connect after step-up still navigates to the authorization URL exactly once', async () => {
    answer('POST', '/api/super-admin/ga-connect', STEP_UP, { status: 200, body: { authorizationUrl: 'https://accounts.example.test/o' } });
    const assign = jest.fn();
    const { result } = await mount();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { set href(v: string) { assign(v); }, get href() { return ''; } } });
    try {
      await act(async () => { await result.current.handleConnectGoogleAnalytics(); });
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
    expect(posts('/api/super-admin/ga-connect')).toBe(2);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://accounts.example.test/o');
  });
});

describe('every step-up write call site uses the shared flow (source-level)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');
  it('the analytics controller sends no step-up write except through analyticsWrite', () => {
    const src = read('components/super-admin/tabs/AnalyticsTabController.tsx');
    for (const route of ['ga-connect', 'gsc-connect', 'ga-select-property', 'gsc-select-property', 'ga-sync', 'gsc-sync']) {
      expect(src).toContain(`analyticsWrite('/api/super-admin/${route}'`);
      expect(src).not.toContain(`fetchWithAuth('/api/super-admin/${route}'`);
    }
  });
  it('the rollout console sends rollout-control through submitSuperAdminWrite and reports success only on 2xx', () => {
    const src = read('pages/super-admin/operations-center.tsx');
    expect(src).toMatch(/submitSuperAdminWrite\(fire/);
    expect(src).toMatch(/if \(result\.status === 'blocked'\) throw/);
    expect(src).toMatch(/if \(result\.status === 'failed'\) throw/);
  });
});
