/**
 * @jest-environment jsdom
 *
 * BillingProfileCaptureForm — lightweight geography-capture form tests.
 *
 * Covers: renders only the 3 lightweight fields, local ISO validation,
 * normalized submit payload, pre-fill from resolved context, submitting/
 * saved/error states, hidden-pricing preservation (no price/plan UI).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  BillingProfileCaptureForm,
  type BillingProfileCaptureValues,
} from '../../../components/billing/BillingProfileCaptureForm';

const base = {
  submitting: false,
  error: null as string | null,
  saved: false,
};

describe('BillingProfileCaptureForm — fields', () => {
  test('renders exactly the 3 lightweight fields (country, currency, region)', () => {
    render(<BillingProfileCaptureForm {...base} onSubmit={() => {}} />);
    expect(screen.getByTestId('bpf-country')).toBeTruthy();
    expect(screen.getByTestId('bpf-currency')).toBeTruthy();
    expect(screen.getByTestId('bpf-region')).toBeTruthy();
  });

  test('does NOT render full-onboarding / business-metadata fields', () => {
    const { container } = render(<BillingProfileCaptureForm {...base} onSubmit={() => {}} />);
    const text = (container.textContent ?? '').toLowerCase();
    for (const w of ['tax id', 'gstin', 'company name', 'business name', 'address line', 'strategy']) {
      expect(text).not.toContain(w);
    }
  });

  test('pre-fills from resolved context', () => {
    render(
      <BillingProfileCaptureForm
        {...base}
        initial={{ billing_country: 'IN', preferred_currency: 'INR', billing_region: 'KA' }}
        onSubmit={() => {}}
      />,
    );
    expect((screen.getByTestId('bpf-country') as HTMLInputElement).value).toBe('IN');
    expect((screen.getByTestId('bpf-currency') as HTMLInputElement).value).toBe('INR');
    expect((screen.getByTestId('bpf-region') as HTMLInputElement).value).toBe('KA');
  });
});

describe('BillingProfileCaptureForm — submit + validation', () => {
  test('submits normalized (uppercased) values', () => {
    let captured: BillingProfileCaptureValues | null = null;
    render(<BillingProfileCaptureForm {...base} onSubmit={(v) => { captured = v; }} />);
    fireEvent.change(screen.getByTestId('bpf-country'), { target: { value: 'in' } });
    fireEvent.change(screen.getByTestId('bpf-currency'), { target: { value: 'inr' } });
    fireEvent.click(screen.getByTestId('bpf-submit'));
    expect(captured).toEqual({ billing_country: 'IN', preferred_currency: 'INR', billing_region: '' });
  });

  test('rejects malformed country locally — onSubmit NOT called', () => {
    let called = false;
    render(<BillingProfileCaptureForm {...base} onSubmit={() => { called = true; }} />);
    fireEvent.change(screen.getByTestId('bpf-country'), { target: { value: 'XYZ' } });
    fireEvent.click(screen.getByTestId('bpf-submit'));
    expect(called).toBe(false);
    expect(screen.getByTestId('bpf-local-error')).toBeTruthy();
  });

  test('rejects malformed currency locally', () => {
    let called = false;
    render(<BillingProfileCaptureForm {...base} onSubmit={() => { called = true; }} />);
    fireEvent.change(screen.getByTestId('bpf-currency'), { target: { value: 'US' } });
    fireEvent.click(screen.getByTestId('bpf-submit'));
    expect(called).toBe(false);
  });

  test('rejects fully empty submit', () => {
    let called = false;
    render(<BillingProfileCaptureForm {...base} onSubmit={() => { called = true; }} />);
    fireEvent.click(screen.getByTestId('bpf-submit'));
    expect(called).toBe(false);
    expect(screen.getByTestId('bpf-local-error')).toBeTruthy();
  });

  test('region-only submit is allowed', () => {
    let captured: BillingProfileCaptureValues | null = null;
    render(<BillingProfileCaptureForm {...base} onSubmit={(v) => { captured = v; }} />);
    fireEvent.change(screen.getByTestId('bpf-region'), { target: { value: 'Bavaria' } });
    fireEvent.click(screen.getByTestId('bpf-submit'));
    expect(captured).not.toBeNull();
    expect(captured!.billing_region).toBe('Bavaria');
  });
});

describe('BillingProfileCaptureForm — states', () => {
  test('submitting → inputs + button disabled', () => {
    render(<BillingProfileCaptureForm {...base} submitting={true} onSubmit={() => {}} />);
    expect((screen.getByTestId('bpf-submit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('bpf-country') as HTMLInputElement).disabled).toBe(true);
  });

  test('saved → confirmation shown', () => {
    render(<BillingProfileCaptureForm {...base} saved={true} onSubmit={() => {}} />);
    expect(screen.getByTestId('bpf-saved')).toBeTruthy();
  });

  test('server error → error shown', () => {
    render(<BillingProfileCaptureForm {...base} error="http_500" onSubmit={() => {}} />);
    expect(screen.getByTestId('bpf-server-error')).toBeTruthy();
  });
});

describe('BillingProfileCaptureForm — hidden-pricing preservation', () => {
  test('renders NO pricing / plan / amount text', () => {
    const { container } = render(
      <BillingProfileCaptureForm
        {...base}
        initial={{ billing_country: 'IN', preferred_currency: 'INR' }}
        onSubmit={() => {}}
      />,
    );
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toMatch(/[$₹€£]/);
    for (const w of ['price', 'pricing', 'amount', 'plan', 'per month', 'subtotal', 'invoice', 'checkout', 'pay now']) {
      expect(text).not.toContain(w);
    }
  });
});
