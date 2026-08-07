'use client';

/**
 * /billing — HIDDEN billing-shell foundation.
 *
 * NOT publicly discoverable: server-gated behind the BILLING_SHELL_ENABLED
 * env flag (getServerSideProps returns notFound → 404 when unset). NOT linked
 * in any navigation. `noindex,nofollow` so crawlers never surface it.
 *
 * Renders payment-PROVIDER discovery only — backend-authoritative, fetched
 * from /api/billing/payment-providers. Renders NO pricing: no amounts, no
 * plan prices, no subscription pricing, no top-up pricing, no invoice totals.
 * There is no real checkout here — provider cards are placeholders for a
 * future checkout-rendering step.
 *
 * Geography: the shell first fetches /api/billing/context (backend-resolved
 * org country + currency) and RELAYS those values verbatim as query params
 * to /api/billing/payment-providers. The frontend infers NO geography or
 * currency logic and does NO provider filtering — the backend resolver is
 * the sole authority.
 *
 * It also renders a lightweight billing-PROFILE capture form (geography only)
 * that PUTs to /api/billing/profile. Capturing geography re-runs provider
 * discovery so the available list reflects the new context immediately.
 * NO pricing, NO checkout, NO full-onboarding fields.
 */

import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { createIdempotentOperation } from '../../lib/idempotency';
import type { GetServerSideProps } from 'next';
import BillingProviderShell, { type ShellProvider } from '../../components/billing/BillingProviderShell';
import BillingProfileCaptureForm, { type BillingProfileCaptureValues } from '../../components/billing/BillingProfileCaptureForm';

interface ProviderApiResponse {
  source: string;
  visible: ShellProvider[];
  supported_methods: string[];
  recommended: string | null;
}

export const getServerSideProps: GetServerSideProps = async () => {
  // Hidden-flag gate — the shell does not exist unless an operator opts in.
  if (process.env.BILLING_SHELL_ENABLED !== 'true') {
    return { notFound: true };
  }
  return { props: {} };
};

export default function BillingShellPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ShellProvider[]>([]);
  const [supportedMethods, setSupportedMethods] = useState<string[]>([]);
  const [recommended, setRecommended] = useState<string | null>(null);

  // Billing-profile capture form state.
  const [initialCtx, setInitialCtx] = useState<Partial<BillingProfileCaptureValues>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaved, setFormSaved] = useState(false);

  /** Two-step provider discovery: backend context → relayed provider query. */
  const loadProviders = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // Step 1 — backend-authoritative org billing context (geography).
      let country: string | null = null;
      let currency: string | null = null;
      let region: string | null = null;
      const ctxRes = await fetch('/api/billing/context');
      if (ctxRes.ok) {
        const ctx = (await ctxRes.json()) as { country: string | null; currency: string | null; region: string | null };
        country = ctx.country ?? null;
        currency = ctx.currency ?? null;
        region = ctx.region ?? null;
      }
      setInitialCtx({
        billing_country: country ?? '',
        preferred_currency: currency ?? '',
        billing_region: region ?? '',
      });

      // Step 2 — relay the resolved context verbatim as query params.
      const params = new URLSearchParams();
      if (country) params.set('country', country);
      if (currency) params.set('currency', currency);
      const qs = params.toString();
      const res = await fetch(`/api/billing/payment-providers${qs ? `?${qs}` : ''}`);
      if (!res.ok) { setError(`http_${res.status}`); setLoading(false); return; }
      const data = (await res.json()) as ProviderApiResponse;
      setProviders(Array.isArray(data.visible) ? data.visible : []);
      setSupportedMethods(Array.isArray(data.supported_methods) ? data.supported_methods : []);
      setRecommended(data.recommended ?? null);
      setError(null);
      setLoading(false);
    } catch {
      setError('fetch_failed');
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  /** Lightweight billing-profile capture → re-runs provider discovery. */
  const handleProfileSubmit = useCallback(async (values: BillingProfileCaptureValues): Promise<void> => {
    setFormSubmitting(true);
    setFormError(null);
    setFormSaved(false);
    try {
      // OR-07 Action 1: the billing profile is a single-row upsert for this
      // org, so the operation identity is the org itself — a retried save
      // reuses the key.
      const profileOp = createIdempotentOperation('billing-profile-save');
      const res = await fetch('/api/billing/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...profileOp.headers },
        body: JSON.stringify({
          billing_country: values.billing_country || undefined,
          preferred_currency: values.preferred_currency || undefined,
          billing_region: values.billing_region || undefined,
        }),
      });
      if (!res.ok) { setFormError(`http_${res.status}`); setFormSubmitting(false); return; }
      setFormSaved(true);
      setFormSubmitting(false);
      // New geography → re-resolve providers.
      await loadProviders();
    } catch {
      setFormError('submit_failed');
      setFormSubmitting(false);
    }
  }, [loadProviders]);

  return (
    <>
      <Head>
        <title>Billing</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main>
        <h1>Billing</h1>
        <BillingProfileCaptureForm
          initial={initialCtx}
          submitting={formSubmitting}
          error={formError}
          saved={formSaved}
          onSubmit={handleProfileSubmit}
        />
        <BillingProviderShell
          loading={loading}
          error={error}
          providers={providers}
          supportedMethods={supportedMethods}
          recommended={recommended}
        />
      </main>
    </>
  );
}
