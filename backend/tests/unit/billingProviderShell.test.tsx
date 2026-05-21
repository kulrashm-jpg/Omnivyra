/**
 * @jest-environment jsdom
 *
 * BillingProviderShell — frontend backend-authoritative rendering tests.
 *
 * Covers: renders ONLY backend-provided providers, no hardcoded
 * Razorpay/Stripe, graceful empty-provider handling, loading/error states,
 * recommendation placeholder, and hidden-pricing preservation (no price text
 * rendered for any provider).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { BillingProviderShell, type ShellProvider } from '../../../components/billing/BillingProviderShell';

const base = {
  loading: false,
  error: null as string | null,
  supportedMethods: [] as string[],
  recommended: null as string | null,
};

describe('BillingProviderShell — backend-authoritative rendering', () => {
  test('renders ONLY the providers the backend supplied', () => {
    const providers: ShellProvider[] = [
      { provider: 'acme_pay', supported_payment_methods: ['card'], topups_enabled: true },
    ];
    render(<BillingProviderShell {...base} providers={providers} />);
    const cards = screen.getAllByTestId('provider-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute('data-provider')).toBe('acme_pay');
  });

  test('does NOT hardcode razorpay/stripe — absent when backend returns neither', () => {
    const providers: ShellProvider[] = [
      { provider: 'some_other_gateway', supported_payment_methods: ['wallet'] },
    ];
    render(<BillingProviderShell {...base} providers={providers} />);
    expect(screen.queryByText(/razorpay/i)).toBeNull();
    expect(screen.queryByText(/stripe/i)).toBeNull();
    expect(screen.getByText('some_other_gateway')).toBeTruthy();
  });

  test('renders backend-provided providers verbatim (3 providers → 3 cards)', () => {
    const providers: ShellProvider[] = [
      { provider: 'p1' }, { provider: 'p2' }, { provider: 'p3' },
    ];
    render(<BillingProviderShell {...base} providers={providers} />);
    expect(screen.getAllByTestId('provider-card')).toHaveLength(3);
  });

  test('renders supported payment methods per provider', () => {
    const providers: ShellProvider[] = [
      { provider: 'p1', supported_payment_methods: ['card', 'upi', 'netbanking'] },
    ];
    render(<BillingProviderShell {...base} providers={providers} />);
    expect(screen.getAllByTestId('provider-method').map((e) => e.textContent))
      .toEqual(['card', 'upi', 'netbanking']);
  });
});

describe('BillingProviderShell — empty / loading / error states', () => {
  test('empty provider list → graceful empty state, no cards', () => {
    render(<BillingProviderShell {...base} providers={[]} />);
    const shell = screen.getByTestId('billing-shell');
    expect(shell.getAttribute('data-state')).toBe('empty');
    expect(screen.queryAllByTestId('provider-card')).toHaveLength(0);
    expect(screen.getByText(/no payment providers/i)).toBeTruthy();
  });

  test('loading state', () => {
    render(<BillingProviderShell {...base} loading={true} providers={[]} />);
    expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('loading');
  });

  test('error state', () => {
    render(<BillingProviderShell {...base} error="http_500" providers={[]} />);
    expect(screen.getByTestId('billing-shell').getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('BillingProviderShell — recommendation placeholder', () => {
  test('null recommendation → "no recommendation" placeholder', () => {
    render(<BillingProviderShell {...base} providers={[{ provider: 'p1' }]} recommended={null} />);
    expect(screen.getByTestId('recommendation-placeholder').textContent)
      .toMatch(/no recommendation/i);
  });
});

describe('BillingProviderShell — hidden-pricing preservation', () => {
  test('NO price/amount/plan text rendered for any provider', () => {
    const providers: ShellProvider[] = [
      { provider: 'p1', supported_payment_methods: ['card'], topups_enabled: true, subscriptions_enabled: true },
      { provider: 'p2', supported_payment_methods: ['upi'] },
    ];
    const { container } = render(
      <BillingProviderShell {...base} providers={providers}
        supportedMethods={['card', 'upi']} recommended={null} />,
    );
    const text = (container.textContent ?? '').toLowerCase();
    // No currency symbols, no pricing words.
    expect(text).not.toMatch(/[$₹€£]/);
    for (const word of ['price', 'pricing', 'amount', 'plan', '/mo', 'per month', 'subtotal', 'total', 'invoice']) {
      expect(text).not.toContain(word);
    }
  });

  test('ShellProvider prop type carries no pricing field at runtime', () => {
    const providers: ShellProvider[] = [{ provider: 'p1', topups_enabled: true }];
    render(<BillingProviderShell {...base} providers={providers} />);
    for (const f of ['price', 'amount', 'unit_price', 'plan_price', 'cost', 'total']) {
      expect(providers[0]).not.toHaveProperty(f);
    }
  });
});
