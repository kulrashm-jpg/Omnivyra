/**
 * Section D — provider credentials + mode + startup validation.
 *
 * Mode is resolved from env (`PAYMENT_PROVIDER_MODE`), DEFAULT 'test'. Each mode
 * has its own credential env vars; validation requires the keys for the ACTIVE
 * mode (test keys in test, live keys in live) and fails fast on missing creds.
 *
 * `assertConfiguredProvidersOrThrow` is intentionally NOT called from global
 * bootstrap (that would crash key-less environments). Call at orchestrator init.
 *
 * Live mode is ARCHITECTURE ONLY — it is never enabled here; default stays test.
 */
import type { PaymentProvider, PaymentProviderId, ProviderMode } from './types';

/** Active provider mode. Default 'test'. Live requires explicit env opt-in. */
export function getActiveMode(): ProviderMode {
  return process.env.PAYMENT_PROVIDER_MODE === 'live' ? 'live' : 'test';
}

export interface ProviderCredentials {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

interface CredEnv { id: string; secret: string; webhook: string }

const CRED_ENV: Record<ProviderMode, Partial<Record<PaymentProviderId, CredEnv>>> = {
  test: {
    razorpay: { id: 'RAZORPAY_TEST_KEY_ID', secret: 'RAZORPAY_TEST_KEY_SECRET', webhook: 'RAZORPAY_WEBHOOK_SECRET' },
    cashfree: { id: 'CASHFREE_TEST_APP_ID', secret: 'CASHFREE_TEST_SECRET_KEY', webhook: 'CASHFREE_WEBHOOK_SECRET' },
  },
  live: {
    razorpay: { id: 'RAZORPAY_LIVE_KEY_ID', secret: 'RAZORPAY_LIVE_KEY_SECRET', webhook: 'RAZORPAY_LIVE_WEBHOOK_SECRET' },
    cashfree: { id: 'CASHFREE_PROD_APP_ID', secret: 'CASHFREE_PROD_SECRET_KEY', webhook: 'CASHFREE_PROD_WEBHOOK_SECRET' },
  },
};

export function getProviderCredentials(id: PaymentProviderId, mode: ProviderMode = getActiveMode()): ProviderCredentials {
  const env = CRED_ENV[mode]?.[id];
  if (!env) return {};
  return {
    keyId: process.env[env.id],
    keySecret: process.env[env.secret],
    webhookSecret: process.env[env.webhook] ?? process.env[env.secret],
  };
}

export function isProviderConfigured(id: PaymentProviderId, mode: ProviderMode = getActiveMode()): boolean {
  const c = getProviderCredentials(id, mode);
  return Boolean(c.keyId && c.keySecret);
}

export interface ConfigValidation {
  mode: ProviderMode;
  ok: boolean;
  errors: string[];
  configured: PaymentProviderId[];
  missing: PaymentProviderId[];
}

/** Validate each ENABLED provider has its required credentials for the active mode. */
export function validateConfiguredProviders(providers: PaymentProvider[], mode: ProviderMode = getActiveMode()): ConfigValidation {
  const errors: string[] = [];
  const configured: PaymentProviderId[] = [];
  const missing: PaymentProviderId[] = [];

  for (const p of providers.filter((x) => x.enabled)) {
    if (isProviderConfigured(p.provider_id, mode)) {
      configured.push(p.provider_id);
    } else {
      missing.push(p.provider_id);
      const env = CRED_ENV[mode]?.[p.provider_id];
      errors.push(`Provider '${p.provider_id}' enabled in ${mode} mode but missing credentials: ${env ? `${env.id}, ${env.secret}` : '(no mode mapping)'}`);
    }
  }
  return { mode, ok: errors.length === 0, errors, configured, missing };
}

/** Fail-fast. Call at orchestrator init / opt-in startup — NOT global bootstrap. */
export function assertConfiguredProvidersOrThrow(providers: PaymentProvider[], mode: ProviderMode = getActiveMode()): void {
  const v = validateConfiguredProviders(providers, mode);
  if (!v.ok) {
    throw new Error(`[paymentOrchestrator] provider configuration invalid (${mode}):\n - ${v.errors.join('\n - ')}`);
  }
}
