/**
 * BillingProfileCaptureForm — lightweight billing-geography capture form.
 *
 * Collects ONLY billing country, preferred currency, and an optional region.
 * NO full-onboarding fields, NO operational/business metadata, NO tax fields,
 * NO pricing. Pure presentational + local validation; the parent owns
 * submission (PUT /api/billing/profile) and the result state.
 *
 * Client-side validation is a UX convenience only — the backend endpoint is
 * authoritative (ISO normalization + rejection happen there too).
 */

import React, { useState } from 'react';

export interface BillingProfileCaptureValues {
  billing_country: string;
  preferred_currency: string;
  billing_region: string;
}

export interface BillingProfileCaptureFormProps {
  /** Pre-fill from already-resolved context (may be partial/empty). */
  initial?: Partial<BillingProfileCaptureValues>;
  submitting: boolean;
  error: string | null;
  saved: boolean;
  onSubmit: (values: BillingProfileCaptureValues) => void;
}

const ISO_COUNTRY = /^[A-Za-z]{2}$/;
const ISO_CURRENCY = /^[A-Za-z]{3}$/;

export function BillingProfileCaptureForm(props: BillingProfileCaptureFormProps): React.ReactElement {
  const { initial, submitting, error, saved, onSubmit } = props;
  const [country, setCountry] = useState(initial?.billing_country ?? '');
  const [currency, setCurrency] = useState(initial?.preferred_currency ?? '');
  const [region, setRegion] = useState(initial?.billing_region ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = country.trim();
    const cur = currency.trim();
    const r = region.trim();
    // Local validation — backend re-validates authoritatively.
    if (!c && !cur && !r) { setLocalError('Enter at least a country or currency.'); return; }
    if (c && !ISO_COUNTRY.test(c)) { setLocalError('Country must be a 2-letter ISO code (e.g. IN, US).'); return; }
    if (cur && !ISO_CURRENCY.test(cur)) { setLocalError('Currency must be a 3-letter ISO code (e.g. INR, USD).'); return; }
    if (r.length > 120) { setLocalError('Region is too long.'); return; }
    setLocalError(null);
    onSubmit({ billing_country: c.toUpperCase(), preferred_currency: cur.toUpperCase(), billing_region: r });
  };

  return (
    <form data-testid="billing-profile-form" onSubmit={handleSubmit}>
      <h2>Billing details</h2>
      <p>Tell us where you&apos;re billed so we can show the right payment options.</p>

      <label htmlFor="bpf-country">Billing country (ISO code)</label>
      <input
        id="bpf-country" data-testid="bpf-country" name="billing_country"
        value={country} maxLength={2}
        onChange={(e) => setCountry(e.target.value)}
        disabled={submitting}
      />

      <label htmlFor="bpf-currency">Preferred currency (ISO code)</label>
      <input
        id="bpf-currency" data-testid="bpf-currency" name="preferred_currency"
        value={currency} maxLength={3}
        onChange={(e) => setCurrency(e.target.value)}
        disabled={submitting}
      />

      <label htmlFor="bpf-region">Region / state (optional)</label>
      <input
        id="bpf-region" data-testid="bpf-region" name="billing_region"
        value={region} maxLength={120}
        onChange={(e) => setRegion(e.target.value)}
        disabled={submitting}
      />

      {localError && <p role="alert" data-testid="bpf-local-error">{localError}</p>}
      {error && !localError && <p role="alert" data-testid="bpf-server-error">Could not save billing details.</p>}
      {saved && !error && !localError && <p data-testid="bpf-saved">Billing details saved.</p>}

      <button type="submit" data-testid="bpf-submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save billing details'}
      </button>
    </form>
  );
}

export default BillingProfileCaptureForm;
