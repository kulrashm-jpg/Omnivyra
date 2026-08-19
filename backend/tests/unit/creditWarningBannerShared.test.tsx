/**
 * @jest-environment jsdom
 */
/**
 * CreditWarningBanner reads the notifications SWR entry NotificationBell owns,
 * instead of issuing its own /api/notifications request for identical data.
 *
 * NotificationBell must remain the key's single revalidation owner, so this
 * subscription carries no refreshInterval and no focus/reconnect revalidation.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import CreditWarningBanner from '@/components/billing/CreditWarningBanner';

const NOTIFICATIONS_KEY = '/api/notifications';
const alert = (category: string, message?: string) =>
  ({ type: 'credit_alert', category, message });

const fetcher = jest.fn();

function renderBanner(payload: unknown, opts: { fail?: boolean } = {}) {
  fetcher.mockReset();
  if (opts.fail) fetcher.mockRejectedValue(new Error('notifications unavailable'));
  else fetcher.mockResolvedValue(payload);
  return render(
    <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0 }}>
      <CreditWarningBanner />
    </SWRConfig>,
  );
}

beforeEach(() => { sessionStorage.clear(); });

describe('A — shared cache subscription', () => {
  it('renders from the notifications key with no fetch of its own', async () => {
    renderBanner({ notifications: [alert('consumed_90', 'You have used 90%.')] });
    await waitFor(() => expect(screen.getByText(/You have used 90%/)).toBeTruthy());
    // One subscription to the shared key — the request the owner would make anyway.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(NOTIFICATIONS_KEY);
  });

  it('reads a bare-array payload too, as the previous implementation did', async () => {
    renderBanner([alert('consumed_80', 'You have used 80%.')]);
    await waitFor(() => expect(screen.getByText(/You have used 80%/)).toBeTruthy());
  });
});

describe('C — credit-alert filtering', () => {
  it('ignores non credit_alert rows and picks the highest threshold', async () => {
    renderBanner({ notifications: [
      { type: 'system', category: 'consumed_95', message: 'not a credit alert' },
      alert('consumed_80', 'eighty'),
      alert('consumed_95', 'ninety-five'),
    ] });
    await waitFor(() => expect(screen.getByText(/ninety-five/)).toBeTruthy());
    expect(screen.queryByText(/eighty/)).toBeNull();
    expect(screen.queryByText(/not a credit alert/)).toBeNull();
  });

  it('skips a threshold already dismissed this session', async () => {
    sessionStorage.setItem('omnivyra_credit_warn_consumed_95_dismissed', 'true');
    renderBanner({ notifications: [alert('consumed_95', 'ninety-five'), alert('consumed_80', 'eighty')] });
    await waitFor(() => expect(screen.getByText(/eighty/)).toBeTruthy());
  });
});

describe('D — empty / no-alert state', () => {
  it('renders nothing when there are no credit alerts', async () => {
    const { container } = renderBanner({ notifications: [{ type: 'system', category: 'x' }] });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });

  it('renders nothing for an empty payload', async () => {
    const { container } = renderBanner({ notifications: [] });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });
});

describe('F — error behaviour', () => {
  it('stays silent when the notifications request fails, as before', async () => {
    const { container } = renderBanner(null, { fail: true });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });
});

describe('B/E — source invariants', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../components/billing/CreditWarningBanner.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('B — issues no direct request of its own', () => {
    expect(code).not.toContain('apiFetch(');
    expect(code).not.toContain("fetch('/api/notifications')");
    expect(code).toContain('useSWR');
  });

  it('B — subscribes to the owner key rather than a second literal', () => {
    expect(code).toContain('NOTIFICATIONS_KEY');
    expect(code).not.toContain("useSWR('/api/notifications'");
  });

  it('E — adds no revalidation owner', () => {
    expect(code).not.toContain('refreshInterval');
    expect(code).not.toContain('useVisibilityPolling');
    expect(code).toContain('revalidateOnFocus: false');
    expect(code).toContain('revalidateOnReconnect: false');
  });

  it('E — NotificationBell keeps sole polling ownership', () => {
    const bell = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../components/NotificationBell.tsx'), 'utf8');
    expect(bell).toContain('useVisibilityPolling');
    expect(bell).toContain('export const NOTIFICATIONS_KEY');
  });

  it('evaluates once per mount, so a refresh cannot surface a dismissed-past threshold', () => {
    expect(code).toContain('evaluatedRef');
  });
});
