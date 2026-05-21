/**
 * BillingProviderShell — hidden billing-shell presentational component.
 *
 * Renders payment-provider cards STRICTLY from backend-supplied data. It
 * hardcodes NO provider (no literal 'razorpay'/'stripe'), decides NO
 * availability, and renders NO pricing — no amounts, no plans, no totals.
 *
 * Pure: takes already-fetched data as props. The page wrapper owns fetching
 * and the hidden-flag gate. This separation keeps the component unit-testable
 * without a network or a Next runtime.
 */

import React from 'react';

export interface ShellProvider {
  provider: string;
  subscriptions_enabled?: boolean;
  topups_enabled?: boolean;
  supported_payment_methods?: string[];
  sandbox_mode?: boolean;
}

export interface BillingProviderShellProps {
  loading: boolean;
  error: string | null;
  /** Visible providers, backend-resolved. May be empty. */
  providers: ShellProvider[];
  supportedMethods: string[];
  /** Future payment-intelligence placeholder. Always null today. */
  recommended: string | null;
}

export function BillingProviderShell(props: BillingProviderShellProps): React.ReactElement {
  const { loading, error, providers, supportedMethods, recommended } = props;

  if (loading) {
    return (
      <div data-testid="billing-shell" data-state="loading">
        <p>Loading payment providers…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="billing-shell" data-state="error">
        <p role="alert">Could not load payment providers.</p>
      </div>
    );
  }

  if (providers.length === 0) {
    // Graceful empty state — NO hardcoded provider fallback.
    return (
      <div data-testid="billing-shell" data-state="empty">
        <p>No payment providers are currently available.</p>
      </div>
    );
  }

  return (
    <div data-testid="billing-shell" data-state="ready">
      <section aria-label="Available payment providers">
        {providers.map((p) => (
          <article
            key={p.provider}
            data-testid="provider-card"
            data-provider={p.provider}
          >
            <h3>{p.provider}</h3>
            <ul>
              {(p.supported_payment_methods ?? []).map((m) => (
                <li key={m} data-testid="provider-method">{m}</li>
              ))}
            </ul>
            <dl>
              <dt>Top-ups</dt>
              <dd data-testid="cap-topups">{p.topups_enabled ? 'enabled' : 'disabled'}</dd>
              <dt>Subscriptions</dt>
              <dd data-testid="cap-subscriptions">{p.subscriptions_enabled ? 'enabled' : 'disabled'}</dd>
              <dt>Mode</dt>
              <dd data-testid="cap-mode">{p.sandbox_mode ? 'sandbox' : 'live'}</dd>
            </dl>
          </article>
        ))}
      </section>

      <section aria-label="Supported payment methods">
        <ul>
          {supportedMethods.map((m) => (
            <li key={m} data-testid="supported-method">{m}</li>
          ))}
        </ul>
      </section>

      {/* Recommendation placeholder — payment-intelligence routing not yet built. */}
      <section aria-label="Recommendation" data-testid="recommendation-placeholder">
        {recommended
          ? <p>Recommended: {recommended}</p>
          : <p>No recommendation available.</p>}
      </section>
    </div>
  );
}

export default BillingProviderShell;
