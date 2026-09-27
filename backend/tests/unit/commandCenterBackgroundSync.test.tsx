/**
 * @jest-environment jsdom
 *
 * Command center — stored-first features, recompute in the background.
 *
 * feature-completion?sync=true recomputes every feature before answering
 * (measured up to 21,722ms), and it gated both the cards and the rings. The
 * wave now reads the STORED state first (sync:false) and runs the recompute
 * after it has committed, reusing the profile the wave already loaded.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react';

type Call = { options: any };
let calls: Call[] = [];
let respond: (options: any) => Promise<any>;

jest.mock('../../../backend/services/commandCenterReadinessService', () => ({
  fetchReadinessData: (_companyId: string, options?: any) => {
    calls.push({ options });
    return respond(options);
  },
  getCardStateFromFeatures: (_cardId: string, features: any[]) => {
    const list = Array.isArray(features) ? features : [];
    if (list.length === 0) return 'unknown';
    return list.every((f: any) => f.status === 'completed') ? 'ready' : 'in_progress';
  },
  generateDynamicRequirements: () => [],
}));

const PROFILE = { name: 'Acme' };
(global as any).fetch = jest.fn(async (url: string) =>
  String(url).includes('/api/company-profile')
    ? { ok: true, json: async () => ({ profile: PROFILE }) }
    : { ok: false, json: async () => null },
);

jest.mock('../../../utils/getAuthToken', () => ({ getAuthToken: () => Promise.resolve(null) }));
jest.mock('../../../hooks/subscriptionFetcher', () => ({
  fetchSubscriptionOnce: () => Promise.resolve({ outcome: 'non_ok' }),
}));
jest.mock('../../../hooks/reportsFetcher', () => ({
  fetchReportsOnce: () => Promise.resolve({ outcome: 'non_ok' }),
}));
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({
    user: { userId: 'u1' }, userName: 'U', userRole: 'COMPANY_ADMIN',
    selectedCompanyName: 'C', selectedCompanyId: 'company-1',
    isLoading: false, authChecked: true, authUserId: 'auth-1',
  }),
}));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn(), query: {} }) }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: undefined, error: undefined }) }));
jest.mock('../../../lib/apiFetch', () => ({ apiFetch: () => Promise.resolve({ ok: false, status: 500 }) }));
jest.mock('../../../lib/swr/swrClient', () => ({ ApiFetchError: class extends Error {} }));
jest.mock('../../../backend/services/monetizationTriggersService', () => ({
  computeMonetizationState: () => null,
}));
jest.mock('../../../lib/analytics/commandCenterEvents', () => ({
  logCommandCenterViewed: () => {}, logCardClicked: () => {}, logCtaClicked: () => {},
}));
jest.mock('../../../components/command-center/preflightHelpers', () => ({
  toPreflightItems: () => [], getCardHoverMessage: () => null,
}));
const setupBuilds: any[] = [];
jest.mock('../../../lib/setup/buildSetupSignals', () => ({
  buildSetupSignals: (input: any) => { setupBuilds.push(input.features); return {}; },
}));
jest.mock('../../../config/setupRegistry', () => ({ SETUP_REGISTRY: [] }));
jest.mock('../../../lib/setup/setupEvents', () => ({ onSetupChanged: () => () => {} }));
jest.mock('../../../lib/readiness/buildReadinessSignals', () => ({ buildReadinessSignals: () => ({}) }));
jest.mock('../../../config/readinessRegistry', () => ({ READINESS_REGISTRY: [] }));
jest.mock('../../../lib/mastery/buildMasterySignals', () => ({ buildMasterySignals: () => ({}) }));
jest.mock('../../../config/masteryRegistry', () => ({ MASTERY_REGISTRY: [] }));
jest.mock('../../../lib/shared/capabilityRegistry', () => ({
  evaluateCapabilityRegistry: () => ({
    categories: [], overallPercent: 0,
    summary: { completedCount: 0, inProgressCount: 0, totalCount: 0 },
    availability: { evaluatedCount: 0, unavailableCount: 0, declaredCount: 0, complete: false },
  }),
}));
jest.mock('../../../config/commandCenterCards', () => ({
  getVisibleCards: () => [{ id: 'blogs', title: 'Create Content', route: '/blogs', requirements: [], cta: 'Open' }],
}));

const { useCommandCenter } = require('../../../hooks/useCommandCenterCore');

let observed: any = null;
function Probe() {
  observed = useCommandCenter();
  return null;
}

const result = (features: any[]) => ({
  features,
  readiness: { score: 0, level: '', completedFeatures: 0, totalFeatures: 0, features },
  featuresDegraded: false,
});
const STORED = [{ key: 'blog_created', status: 'in_progress', score: 0.5 }];
const SYNCED = [{ key: 'blog_created', status: 'completed', score: 1 }];

beforeEach(() => {
  calls = [];
  setupBuilds.length = 0;
  observed = null;
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

describe('stored-first, background recompute', () => {
  it('reads stored state first, then recomputes with the loaded profile', async () => {
    respond = (o) => Promise.resolve(result(o?.sync === false ? STORED : SYNCED));
    render(<Probe />);

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[0].options).toEqual({ sync: false });
    // Second call is the recompute (sync defaults to true) reusing the wave's profile.
    expect(calls[1].options?.sync).toBeUndefined();
    expect(calls[1].options?.profile).toEqual(PROFILE);

    // Cards and rings end on the recomputed state.
    await waitFor(() => expect(observed.features).toEqual(SYNCED));
    expect(setupBuilds[0]).toEqual(STORED);
    expect(setupBuilds[setupBuilds.length - 1]).toEqual(SYNCED);
  });

  it('cards commit from the stored read without waiting for the recompute', async () => {
    let releaseSync!: (v: any) => void;
    respond = (o) =>
      o?.sync === false
        ? Promise.resolve(result(STORED))
        : new Promise((r) => { releaseSync = r; });
    render(<Probe />);

    await waitFor(() => expect(observed.features).toEqual(STORED));
    await waitFor(() => expect(calls.length).toBe(2)); // recompute in flight
    await act(async () => { releaseSync(result(SYNCED)); });
    await waitFor(() => expect(observed.features).toEqual(SYNCED));
  });

  it('a failed stored read falls back to one recompute — never a second', async () => {
    respond = (o) => Promise.resolve(o?.sync === false ? null : result(SYNCED));
    render(<Probe />);

    await waitFor(() => expect(observed.features).toEqual(SYNCED));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls.map((c) => c.options?.sync)).toEqual([false, undefined]);
  });
});
