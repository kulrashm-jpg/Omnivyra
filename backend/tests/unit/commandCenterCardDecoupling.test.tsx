/**
 * @jest-environment jsdom
 *
 * Phase 22 — card state must not wait on unrelated readiness requests.
 *
 * loadReadiness fires sixteen requests. Exactly ONE of them
 * (fetchReadinessData) produces `features`, and card state derives from
 * `features` alone; the other fifteen feed the Setup/Readiness/Mastery signal
 * builders. Awaiting all sixteen through one Promise.all meant the cards waited
 * for the SLOWEST of sixteen — so a page whose card data had arrived in the
 * first second could sit on "Checking…" until an unrelated request finished.
 *
 * These tests pin the dependency boundary: features commit when THEIR request
 * resolves, and never when an unrelated one does.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react';

// ── deferred helpers ─────────────────────────────────────────────────────────
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const readinessDeferred = { current: deferred<any>() };
const unrelatedDeferred = { current: deferred<any>() };
let unrelatedResolvedCount = 0;

jest.mock('../../../backend/services/commandCenterReadinessService', () => ({
  fetchReadinessData: () => readinessDeferred.current.promise,
  getCardStateFromFeatures: (cardId: string, features: any[]) => {
    const list = Array.isArray(features) ? features : [];
    if (list.length === 0) return 'unknown';
    return list.every((f: any) => f.status === 'completed') ? 'ready' : 'in_progress';
  },
  generateDynamicRequirements: () => [],
}));

// Every unrelated readiness request shares one deferred so the test controls it.
const mockFetch = jest.fn(() => {
  unrelatedResolvedCount += 1;
  return unrelatedDeferred.current.promise;
});
(global as any).fetch = mockFetch;

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
jest.mock('../../../lib/setup/buildSetupSignals', () => ({ buildSetupSignals: () => ({}) }));
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
  const state = useCommandCenter();
  observed = state;
  return null;
}

const READY_FEATURES = [{ key: 'blog_created', status: 'completed', score: 1 }];

beforeEach(() => {
  readinessDeferred.current = deferred<any>();
  unrelatedDeferred.current = deferred<any>();
  unrelatedResolvedCount = 0;
  observed = null;
  mockFetch.mockClear();
});

describe('Phase 22 — card dependency boundary', () => {
  it('A — CRITICAL: features commit while an unrelated request is STILL PENDING', async () => {
    render(<Probe />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled()); // wave started

    // Only the feature request resolves. Everything else stays pending.
    await act(async () => {
      readinessDeferred.current.resolve({
        features: READY_FEATURES,
        readiness: { score: 50, level: '', completedFeatures: 1, totalFeatures: 2, features: READY_FEATURES },
        featuresDegraded: false,
      });
    });

    await waitFor(() => {
      const card = (observed?.enhancedCards || [])[0];
      expect(card?.state).toBe('ready');
    });
    // Proves the cards did not wait for the batch: it never resolved.
    expect(unrelatedResolvedCount).toBeGreaterThan(0); // requests were issued
  });

  it('B — cards stay unknown ("Checking…") until the feature request resolves', async () => {
    render(<Probe />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    // Unrelated requests resolve first; the feature request does not.
    await act(async () => {
      unrelatedDeferred.current.resolve({ ok: true, json: async () => ({}) });
    });

    const card = (observed?.enhancedCards || [])[0];
    expect(card?.state).toBe('unknown');
    expect(card?.state).not.toBe('ready');
    expect(card?.state).not.toBe('not_started');
  });

  it('D — a failed feature request never fabricates a card state', async () => {
    render(<Probe />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await act(async () => {
      readinessDeferred.current.resolve(null); // fetchReadinessData failure contract
      unrelatedDeferred.current.resolve({ ok: true, json: async () => ({}) });
    });

    const card = (observed?.enhancedCards || [])[0];
    expect(card?.state).toBe('unknown');   // K2 preserved
    expect(card?.state).not.toBe('ready');
    expect(card?.state).not.toBe('not_started');
  });
});

describe('Phase 22 — source invariants (mutation guards)', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(process.cwd(), 'hooks/useCommandCenterCore.tsx'), 'utf-8');

  it('MUTATION GUARD: fetchReadinessData is NOT inside the awaited signal batch', () => {
    // Reintroducing the barrier — putting fetchReadinessData back into the
    // Promise.all that the signal destructure awaits — must fail here.
    const batchStart = SRC.indexOf('const signalBatch = Promise.all([');
    const batchEnd = SRC.indexOf('] = await signalBatch;');
    expect(batchStart).toBeGreaterThan(-1);
    expect(batchEnd).toBeGreaterThan(batchStart);
    expect(SRC.slice(batchStart, batchEnd)).not.toContain('fetchReadinessData');
  });

  it('MUTATION GUARD: features are committed BEFORE the signal batch is awaited', () => {
    const commitAt = SRC.indexOf('setFeatures(data.features);');
    const batchAwaitAt = SRC.indexOf('] = await signalBatch;');
    expect(commitAt).toBeGreaterThan(-1);
    expect(batchAwaitAt).toBeGreaterThan(-1);
    expect(commitAt).toBeLessThan(batchAwaitAt);
  });

  it('the feature branch is awaited on its own promise', () => {
    expect(SRC).toContain('const featurePromise = fetchReadinessData(selectedCompanyId);');
    expect(SRC).toContain('const data = await featurePromise;');
  });

  it('every signal-batch request is bounded by a timeout', () => {
    expect(SRC).toContain('READINESS_SIGNAL_TIMEOUT_MS');
    expect(SRC).toContain('ctrl.abort()');
    expect(SRC).toMatch(/signal: ctrl\.signal/);
    // the one member that cannot be aborted is capped instead
    expect(SRC).toContain('capped(');
  });

  it('the timeout sits above the measured legitimate maximum (21,722ms)', () => {
    const m = SRC.match(/READINESS_SIGNAL_TIMEOUT_MS = ([0-9_]+)/);
    expect(m).toBeTruthy();
    expect(Number(String(m![1]).replace(/_/g, ''))).toBeGreaterThan(21722);
  });

  it('a stale wave cannot overwrite a newer one', () => {
    expect(SRC).toContain('const runId = ++readinessRunRef.current;');
    expect(SRC).toContain('const isStale = () => runId !== readinessRunRef.current;');
    expect(SRC).toContain('if (isStale()) return;');
  });

  it('MUTATION GUARD: a failed feature request still does not clear features', () => {
    const failBlock = SRC.slice(SRC.indexOf('const data = await featurePromise;'),
                                SRC.indexOf('setFeatures(data.features);'));
    expect(failBlock).not.toMatch(/setFeatures\(\[\]\)/);
  });
});
