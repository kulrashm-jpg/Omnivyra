/**
 * @jest-environment jsdom
 *
 * Billing shell — org-context → provider-endpoint propagation tests.
 *
 * Covers: the shell fetches /api/billing/context, then RELAYS the resolved
 * country+currency verbatim as query params to /api/billing/payment-providers;
 * geography-filtered rendering; unsupported-region empty state; the frontend
 * does NO filtering of its own; hidden-pricing preservation.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// next/head — render children inline so jsdom is happy.
jest.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BillingShellPage from '../../../pages/billing/index';

interface FetchCall { url: string }
let __calls: FetchCall[] = [];

/** Install a fetch mock: context responds first, providers second. */
function installFetch(opts: {
  context: { country: string | null; currency: string | null } | { __status: number };
  providers: (url: string) => { visible: any[]; supported_methods: string[]; recommended: string | null } | { __status: number };
}) {
  __calls = [];
  (global as any).fetch = jest.fn(async (url: string) => {
    __calls.push({ url });
    if (url.startsWith('/api/billing/context')) {
      if ('__status' in opts.context) {
        return { ok: false, status: opts.context.__status, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => opts.context };
    }
    if (url.startsWith('/api/billing/payment-providers')) {
      const r = opts.providers(url);
      if ('__status' in r) return { ok: false, status: r.__status, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => r };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

afterEach(() => { delete (global as any).fetch; });

describe('billing shell — context → provider propagation', () => {
  test('relays resolved country + currency verbatim as query params', async () => {
    installFetch({
      context: { country: 'IN', currency: 'INR' },
      providers: () => ({
        visible: [{ provider: 'razorpay', supported_payment_methods: ['upi'] }],
        supported_methods: ['upi'], recommended: null,
      }),
    });
    render(<BillingShellPage />);
    await waitFor(() => expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('ready'));

    const providerCall = __calls.find((c) => c.url.startsWith('/api/billing/payment-providers'))!;
    expect(providerCall.url).toContain('country=IN');
    expect(providerCall.url).toContain('currency=INR');
    // context fetched BEFORE providers.
    expect(__calls[0].url).toContain('/api/billing/context');
  });

  test('null context → no query params relayed (backend returns unrestricted list)', async () => {
    installFetch({
      context: { country: null, currency: null },
      providers: (url) => {
        expect(url).toBe('/api/billing/payment-providers'); // no '?'
        return { visible: [{ provider: 'razorpay' }], supported_methods: [], recommended: null };
      },
    });
    render(<BillingShellPage />);
    await waitFor(() => expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('ready'));
    const providerCall = __calls.find((c) => c.url.startsWith('/api/billing/payment-providers'))!;
    expect(providerCall.url).not.toContain('?');
  });

  test('context fetch failure is non-fatal — shell still queries providers unrestricted', async () => {
    installFetch({
      context: { __status: 500 },
      providers: (url) => {
        expect(url).toBe('/api/billing/payment-providers');
        return { visible: [{ provider: 'razorpay' }], supported_methods: [], recommended: null };
      },
    });
    render(<BillingShellPage />);
    await waitFor(() => expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('ready'));
  });
});

describe('billing shell — geography-filtered rendering', () => {
  test('renders exactly the geography-filtered providers the backend returned', async () => {
    installFetch({
      context: { country: 'IN', currency: 'INR' },
      providers: () => ({
        visible: [{ provider: 'razorpay', supported_payment_methods: ['upi', 'card'] }],
        supported_methods: ['card', 'upi'], recommended: null,
      }),
    });
    render(<BillingShellPage />);
    await waitFor(() => expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('ready'));
    const cards = screen.getAllByTestId('provider-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute('data-provider')).toBe('razorpay');
  });

  test('unsupported region → backend returns empty list → graceful empty state', async () => {
    installFetch({
      context: { country: 'AQ', currency: 'XYZ' }, // unsupported region/currency
      providers: () => ({ visible: [], supported_methods: [], recommended: null }),
    });
    render(<BillingShellPage />);
    await waitFor(() => expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('empty'));
    expect(screen.queryAllByTestId('provider-card')).toHaveLength(0);
    expect(screen.getByText(/no payment providers/i)).toBeTruthy();
  });

  test('frontend does NO filtering — renders backend list verbatim even if larger', async () => {
    installFetch({
      context: { country: 'IN', currency: 'INR' },
      providers: () => ({
        visible: [{ provider: 'p1' }, { provider: 'p2' }, { provider: 'p3' }],
        supported_methods: [], recommended: null,
      }),
    });
    render(<BillingShellPage />);
    await waitFor(() => expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('ready'));
    expect(screen.getAllByTestId('provider-card')).toHaveLength(3);
  });
});

describe('billing shell — hidden-pricing preservation', () => {
  test('no price/amount/currency-symbol text rendered after geography fetch', async () => {
    installFetch({
      context: { country: 'IN', currency: 'INR' },
      providers: () => ({
        visible: [{ provider: 'razorpay', supported_payment_methods: ['upi'], topups_enabled: true }],
        supported_methods: ['upi'], recommended: null,
      }),
    });
    const { container } = render(<BillingShellPage />);
    await waitFor(() => expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('ready'));
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toMatch(/[$₹€£]/);
    for (const w of ['price', 'pricing', 'amount', 'plan', 'per month', 'subtotal', 'invoice total']) {
      expect(text).not.toContain(w);
    }
  });
});
