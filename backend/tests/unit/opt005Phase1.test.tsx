/**
 * @jest-environment jsdom
 *
 * OPT-005 Phase 1 — SWR client, purge wiring, and hook parity.
 *
 * Covers the mandated cases: fetcher throws on every non-OK (incl. the
 * synthetic 503), retry policy (never 4xx, capped 5xx), full-cache purge on
 * principal change and on SIGNED_OUT, hook parity (error→empty, loading→
 * isValidating), and mutate() updating ALL subscribed consumers.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockApiFetch = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockAuthCallback: { current: ((event: string) => void) | null } = { current: null };
jest.mock('../../../lib/supabaseBrowser', () => ({
  getSupabaseBrowser: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        mockAuthCallback.current = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  }),
}));

const mockContext: { user: { userId: string } | null } = { user: { userId: 'user-A' } };
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => mockContext,
}));

import {
  swrJsonFetcher,
  swrOnErrorRetry,
  clearSwrCache,
  ApiFetchError,
  MAX_5XX_RETRIES,
  SWR_GLOBAL_CONFIG,
} from '../../../lib/swr/swrClient';
import { SwrCachePurgeWatcher } from '../../../components/swr/SwrCachePurgeWatcher';
import { usePlatformCounts } from '../../../hooks/usePlatformCounts';

// jsdom 29 has no global Response; the fetcher only touches ok/status/json().
const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.user = { userId: 'user-A' };
  mockAuthCallback.current = null;
});

describe('swrJsonFetcher', () => {
  test('OK response resolves parsed JSON', async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(swrJsonFetcher('/api/x')).resolves.toEqual({ ok: true });
  });

  test.each([[401], [403], [404], [500]])('non-OK %d throws ApiFetchError with status', async (status) => {
    mockApiFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, status));
    const err = await swrJsonFetcher('/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiFetchError);
    expect(err.status).toBe(status);
    expect(err.message).toBe('nope');
  });

  test('synthetic 503 (apiFetch network fallback) THROWS — never cached as data', async () => {
    // Exactly the Response apiFetch synthesizes on network failure.
    mockApiFetch.mockResolvedValue(
      jsonResponse({ error: 'Network unreachable', detail: 'Failed to fetch' }, 503)
    );
    const err = await swrJsonFetcher('/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiFetchError);
    expect(err.status).toBe(503);
  });
});

describe('swrOnErrorRetry', () => {
  const invoke = (status: number, retryCount: number) => {
    const revalidate = jest.fn();
    swrOnErrorRetry(
      new ApiFetchError('/api/x', status),
      '/api/x',
      SWR_GLOBAL_CONFIG as never,
      revalidate,
      { retryCount } as never
    );
    return revalidate;
  };

  test('never retries 4xx', () => {
    jest.useFakeTimers();
    for (const status of [400, 401, 403, 404]) {
      const revalidate = invoke(status, 0);
      jest.runAllTimers();
      expect(revalidate).not.toHaveBeenCalled();
    }
    jest.useRealTimers();
  });

  test('retries 5xx with backoff but stops at the cap', () => {
    jest.useFakeTimers();
    const first = invoke(503, 0);
    jest.runAllTimers();
    expect(first).toHaveBeenCalledTimes(1);
    const atCap = invoke(503, MAX_5XX_RETRIES);
    jest.runAllTimers();
    expect(atCap).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('clearSwrCache', () => {
  test('calls global mutate with a match-all filter and revalidate:false', async () => {
    const mutate = jest.fn().mockResolvedValue([]);
    await clearSwrCache(mutate);
    expect(mutate).toHaveBeenCalledTimes(1);
    const [matcher, data, opts] = mutate.mock.calls[0];
    expect(matcher('any-key')).toBe(true);
    expect(data).toBeUndefined();
    expect(opts).toEqual({ revalidate: false });
  });
});

// ── Hook parity + subscriber propagation ────────────────────────────────────

function CountsProbe({ label }: { label: string }) {
  const { counts, loading, error, refresh } = usePlatformCounts('org-1');
  return (
    <div>
      <span data-testid={`${label}-unread`}>{counts.linkedin?.unread_count ?? 'none'}</span>
      <span data-testid={`${label}-loading`}>{String(loading)}</span>
      <span data-testid={`${label}-error`}>{error ?? 'none'}</span>
      <button data-testid={`${label}-refresh`} onClick={() => void refresh()}>r</button>
    </div>
  );
}

const harness = (children: React.ReactNode) => (
  <SWRConfig value={{ ...SWR_GLOBAL_CONFIG, provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('usePlatformCounts (SWR facade)', () => {
  const countsBody = (unread: number) => ({
    counts: { linkedin: { thread_count: 3, unread_count: unread, max_priority_tier: 'high' } },
  });

  test('two subscribed consumers share ONE request and both update on refresh (mutate)', async () => {
    mockApiFetch.mockResolvedValue(jsonResponse(countsBody(5)));
    render(harness(<><CountsProbe label="a" /><CountsProbe label="b" /></>));

    await waitFor(() => expect(screen.getByTestId('a-unread').textContent).toBe('5'));
    expect(screen.getByTestId('b-unread').textContent).toBe('5');
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // dedupe across both mounts

    mockApiFetch.mockResolvedValue(jsonResponse(countsBody(2)));
    await act(async () => {
      screen.getByTestId('a-refresh').click();
    });
    await waitFor(() => expect(screen.getByTestId('a-unread').textContent).toBe('2'));
    // The OTHER subscriber updated too — the contract HTTP caching couldn't provide.
    expect(screen.getByTestId('b-unread').textContent).toBe('2');
  });

  test('error → empty counts + error string; loading settles false', async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ error: 'FORBIDDEN' }, 403));
    render(harness(<CountsProbe label="e" />));
    await waitFor(() => expect(screen.getByTestId('e-error').textContent).toBe('FORBIDDEN'));
    expect(screen.getByTestId('e-unread').textContent).toBe('none');
    await waitFor(() => expect(screen.getByTestId('e-loading').textContent).toBe('false'));
  });

  test('empty organizationId: no request, empty counts, not loading', async () => {
    function EmptyProbe() {
      const { counts, loading } = usePlatformCounts('');
      return <span data-testid="empty">{`${Object.keys(counts).length}-${String(loading)}`}</span>;
    }
    render(harness(<EmptyProbe />));
    await waitFor(() => expect(screen.getByTestId('empty').textContent).toBe('0-false'));
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

// ── Purge wiring ────────────────────────────────────────────────────────────

describe('SwrCachePurgeWatcher', () => {
  test('purges the whole cache when CompanyContext user.userId changes', async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse({ counts: { linkedin: { thread_count: 1, unread_count: 9, max_priority_tier: 'low' } } })
    );
    const { rerender } = render(
      harness(<><SwrCachePurgeWatcher /><CountsProbe label="p" /></>)
    );
    await waitFor(() => expect(screen.getByTestId('p-unread').textContent).toBe('9'));

    // Principal switch (covers cookie principals with no Supabase event).
    mockContext.user = { userId: 'user-B' };
    await act(async () => {
      rerender(harness(<><SwrCachePurgeWatcher /><CountsProbe label="p" /></>));
    });
    await waitFor(() => expect(screen.getByTestId('p-unread').textContent).toBe('none'));
  });

  test('purges the whole cache on Supabase SIGNED_OUT', async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse({ counts: { linkedin: { thread_count: 1, unread_count: 7, max_priority_tier: 'low' } } })
    );
    render(harness(<><SwrCachePurgeWatcher /><CountsProbe label="s" /></>));
    await waitFor(() => expect(screen.getByTestId('s-unread').textContent).toBe('7'));
    expect(mockAuthCallback.current).not.toBeNull();

    await act(async () => {
      mockAuthCallback.current?.('SIGNED_OUT');
    });
    await waitFor(() => expect(screen.getByTestId('s-unread').textContent).toBe('none'));
  });

  test('does NOT purge on first observation (mount baseline)', async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse({ counts: { linkedin: { thread_count: 1, unread_count: 4, max_priority_tier: 'low' } } })
    );
    render(harness(<><SwrCachePurgeWatcher /><CountsProbe label="m" /></>));
    await waitFor(() => expect(screen.getByTestId('m-unread').textContent).toBe('4'));
    // Data survived the watcher's initial mount — baseline established, no purge.
    expect(screen.getByTestId('m-unread').textContent).toBe('4');
  });
});
