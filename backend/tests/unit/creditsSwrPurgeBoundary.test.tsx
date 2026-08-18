/**
 * @jest-environment jsdom
 */
/**
 * P1.9 — where a successful /api/admin/credits response stops becoming SWR data.
 *
 * Production: one request, HTTP 200, wallet present, body complete — and 148s
 * later SWR `data` and `error` were both still undefined, with no second
 * request. These tests drive the REAL hook (only the network and realtime
 * seams are mocked) to locate the boundary that fails.
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { mutate as globalMutate } from 'swr';
import { clearSwrCache } from '@/lib/swr/swrClient';

jest.mock('@/lib/swr/creditsRealtime', () => ({
  creditsBalanceKey: (companyId: string) => `/api/admin/credits?companyId=${encodeURIComponent(companyId)}`,
  ensureCreditsRealtime: jest.fn(),
}));

const apiFetchMock = jest.fn();
jest.mock('@/lib/apiFetch', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useCredits } = require('@/hooks/useCredits');

const WALLET = { credits: { lifetime_purchased: 4300, balance_credits: 1818, recent_transactions: [], lifetime_consumed: 2482 } };
const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function Probe({ companyId }: { companyId: string | null }) {
  const { status, remainingCredits } = useCredits(companyId);
  return <div data-testid="probe" data-status={status}>{status === 'ready' ? String(remainingCredits) : ''}</div>;
}

const statusOf = () => screen.getByTestId('probe').getAttribute('data-status');

beforeEach(async () => {
  apiFetchMock.mockReset();
  // Drop every key so each test starts from an empty cache.
  await act(async () => { await clearSwrCache(globalMutate as never); });
});

describe('fetch → JSON → fetcher → SWR data (undisturbed)', () => {
  it('a 200 response populates SWR data and the balance becomes visible', async () => {
    apiFetchMock.mockResolvedValue(okResponse(WALLET));
    render(<Probe companyId="c1" />);
    await waitFor(() => expect(statusOf()).toBe('ready'));
    expect(screen.getByTestId('probe').textContent).toBe('1818');
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the production failure: a cache purge lands while the request is in flight', () => {
  it('discards the resolved 200 and never refetches — stranded in loading', async () => {
    let release!: (v: unknown) => void;
    apiFetchMock.mockReturnValue(new Promise((res) => { release = res; }));

    render(<Probe companyId="c2" />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(statusOf()).toBe('loading');

    // clearSwrCache: mutate(() => true, undefined, { revalidate: false }).
    await act(async () => { await clearSwrCache(globalMutate as never); });

    // The response arrives AFTER the purge.
    await act(async () => { release(okResponse(WALLET)); await Promise.resolve(); });

    await new Promise((r) => setTimeout(r, 50));
    expect(statusOf()).toBe('loading');           // data discarded as stale
    expect(apiFetchMock).toHaveBeenCalledTimes(1); // revalidate:false ⇒ no recovery
  });

  it('mutation check — the same purge WITH revalidate recovers, isolating revalidate:false', async () => {
    let release!: (v: unknown) => void;
    apiFetchMock.mockReturnValueOnce(new Promise((res) => { release = res; }));

    render(<Probe companyId="c3" />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));

    apiFetchMock.mockResolvedValue(okResponse(WALLET));
    await act(async () => { await globalMutate(() => true, undefined, { revalidate: true }); });
    await act(async () => { release(okResponse(WALLET)); await Promise.resolve(); });

    await waitFor(() => expect(statusOf()).toBe('ready'));
    expect(apiFetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('a purge landing BEFORE the request starts is harmless', async () => {
    apiFetchMock.mockResolvedValue(okResponse(WALLET));
    await act(async () => { await clearSwrCache(globalMutate as never); });
    render(<Probe companyId="c4" />);
    await waitFor(() => expect(statusOf()).toBe('ready'));
  });
});
