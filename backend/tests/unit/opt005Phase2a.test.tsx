/**
 * @jest-environment jsdom
 *
 * OPT-005 Phase 2A — credits family on SWR.
 *
 * Proves: ONE realtime channel per org for N consumers; INSERT triggers a
 * cache revalidation that updates every subscriber; duplicate request
 * elimination (credits chrome + executive banner/hook shared key); hook
 * parity (ready/unavailable/auth-error/malformed mapping, loading mirror);
 * polling parity (constant); org-scoped cache key isolation.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockApiFetch = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const channelsCreated: string[] = [];
const insertHandlers = new Map<string, () => void>();
jest.mock('../../../lib/supabaseBrowser', () => ({
  getSupabaseBrowser: () => ({
    channel: (name: string) => {
      channelsCreated.push(name);
      const chain: Record<string, unknown> = {};
      chain.on = (_event: string, _filter: unknown, cb: () => void) => {
        insertHandlers.set(name, cb);
        return chain;
      };
      chain.subscribe = () => chain;
      return chain;
    },
  }),
}));

jest.mock('../../../shared/monetization/featureRegistry', () => ({
  getFeatureDisplayGroup: () => ({ label: 'Content', color: '#00f' }),
}));

import { useCredits, CREDITS_REFRESH_INTERVAL_MS } from '../../../hooks/useCredits';
import { useExecutiveIntelligence } from '../../../hooks/useExecutiveIntelligence';
import { useCreditAdvisor } from '../../../hooks/useCreditAdvisor';
import CreditAdvisorBanner from '../../../components/credit-advisor/CreditAdvisorBanner';
import { SWR_GLOBAL_CONFIG } from '../../../lib/swr/swrClient';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown = {}) => ({ ok: false, status, json: async () => body });

const wallet = (remaining: number) => ({
  credits: {
    lifetime_purchased: 100,
    balance_credits: remaining,
    recent_transactions: [],
    lifetime_consumed: 0,
  },
});

function CreditsProbe({ label, org }: { label: string; org: string }) {
  const { status, remainingCredits, error } = useCredits(org);
  return (
    <div>
      <span data-testid={`${label}-status`}>{status}</span>
      <span data-testid={`${label}-remaining`}>{remainingCredits}</span>
      <span data-testid={`${label}-error`}>{error ?? 'none'}</span>
    </div>
  );
}

const harness = (children: React.ReactNode) => (
  <SWRConfig value={{ ...SWR_GLOBAL_CONFIG, provider: () => new Map() }}>{children}</SWRConfig>
);

beforeEach(() => {
  jest.clearAllMocks();
  channelsCreated.length = 0;
  insertHandlers.clear();
});

describe('useCredits — shared entry + single realtime owner', () => {
  test('polling parity: interval constant unchanged (5 minutes)', () => {
    expect(CREDITS_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  test('two consumers: ONE request, ONE realtime channel; INSERT revalidates BOTH', async () => {
    mockApiFetch.mockResolvedValue(ok(wallet(42)));
    render(harness(<><CreditsProbe label="a" org="org-rt1" /><CreditsProbe label="b" org="org-rt1" /></>));

    await waitFor(() => expect(screen.getByTestId('a-remaining').textContent).toBe('42'));
    expect(screen.getByTestId('b-remaining').textContent).toBe('42');
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // deduped across both mounts
    expect(channelsCreated).toEqual(['credit_balance_org-rt1']); // exactly one channel

    // INSERT event → revalidate (a refetch, not an optimistic write)
    mockApiFetch.mockResolvedValue(ok(wallet(41)));
    await act(async () => {
      insertHandlers.get('credit_balance_org-rt1')?.();
    });
    await waitFor(() => expect(screen.getByTestId('a-remaining').textContent).toBe('41'));
    expect(screen.getByTestId('b-remaining').textContent).toBe('41');
    expect(channelsCreated).toHaveLength(1); // still just the one channel
  });

  test('cache key isolation: two orgs → two channels, two fetches, independent values', async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      ok(wallet(url.includes('org-iso1') ? 10 : 20))
    );
    render(harness(<><CreditsProbe label="x" org="org-iso1" /><CreditsProbe label="y" org="org-iso2" /></>));
    await waitFor(() => expect(screen.getByTestId('x-remaining').textContent).toBe('10'));
    await waitFor(() => expect(screen.getByTestId('y-remaining').textContent).toBe('20'));
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(new Set(channelsCreated)).toEqual(
      new Set(['credit_balance_org-iso1', 'credit_balance_org-iso2'])
    );
  });

  test('parity: unavailable (wallet null), auth error message, malformed payload', async () => {
    mockApiFetch.mockResolvedValue(ok({ credits: null }));
    const { unmount } = render(harness(<CreditsProbe label="u" org="org-p1" />));
    await waitFor(() => expect(screen.getByTestId('u-status').textContent).toBe('unavailable'));
    unmount();

    mockApiFetch.mockResolvedValue(fail(403));
    const r2 = render(harness(<CreditsProbe label="e" org="org-p2" />));
    await waitFor(() => expect(screen.getByTestId('e-status').textContent).toBe('error'));
    expect(screen.getByTestId('e-error').textContent).toBe('Not authorized (HTTP 403)');
    r2.unmount();

    mockApiFetch.mockResolvedValue(ok('not-an-object'));
    render(harness(<CreditsProbe label="m" org="org-p3" />));
    await waitFor(() => expect(screen.getByTestId('m-status').textContent).toBe('error'));
    expect(screen.getByTestId('m-error').textContent).toBe('Malformed credits payload');
  });
});

describe('executive report — banner and hook share one request', () => {
  const REPORT = {
    display: { signature: 'sig-1', base_should_show: false },
    banner: { risk: 'Healthy', runway_days: 12, largest_driver: null, top_recommendation: null },
  };

  function ExecProbe({ org }: { org: string }) {
    const { status, report } = useExecutiveIntelligence(org);
    return <span data-testid="exec-status">{`${status}:${report?.banner?.runway_days ?? 'x'}`}</span>;
  }

  test('CreditAdvisorBanner + useExecutiveIntelligence: ONE request, both render', async () => {
    mockApiFetch.mockResolvedValue(ok(REPORT));
    render(harness(<><CreditAdvisorBanner orgId="org-ex1" /><ExecProbe org="org-ex1" /></>));
    await waitFor(() => expect(screen.getByTestId('exec-status').textContent).toBe('ready:12'));
    await waitFor(() =>
      expect(screen.getByText(/Credits projected to last ~12 days/)).toBeTruthy()
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // shared key, deduped
  });

  test('banner parity: silent on error (renders nothing)', async () => {
    mockApiFetch.mockResolvedValue(fail(500));
    const { container } = render(harness(<CreditAdvisorBanner orgId="org-ex2" />));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});

describe('useCreditAdvisor — facade parity', () => {
  function AdvisorProbe({ org }: { org: string }) {
    const { status, error } = useCreditAdvisor(org);
    return <span data-testid="adv">{`${status}:${error ?? 'none'}`}</span>;
  }

  test('unavailable when overview.missing; error message parity on failure', async () => {
    mockApiFetch.mockResolvedValue(ok({ overview: { missing: true } }));
    const first = render(harness(<AdvisorProbe org="org-ad1" />));
    await waitFor(() => expect(screen.getByTestId('adv').textContent).toBe('unavailable:none'));
    first.unmount();

    mockApiFetch.mockResolvedValue(fail(500));
    render(harness(<AdvisorProbe org="org-ad2" />));
    await waitFor(() =>
      expect(screen.getByTestId('adv').textContent).toBe('error:Request failed (500)')
    );
  });
});
