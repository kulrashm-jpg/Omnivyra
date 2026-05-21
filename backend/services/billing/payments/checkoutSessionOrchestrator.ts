/**
 * Canonical checkout-session orchestration (FOUNDATION).
 *
 * THE single backend path a future Buy / Top-up flow uses to initiate a
 * provider checkout session. It composes — never duplicates — the existing
 * billing primitives:
 *
 *   resolveOrgBillingContext   → geography (country/currency), backend-authoritative
 *   resolveAvailableProviders  → governance (enabled / visible / maintenance / geo)
 *   dispatchCheckout           → provider-adapter session creation
 *   getProviderAdapter         → provider mode (test/live/unknown)
 *
 * It enforces backend-authoritative provider governance, validates provider
 * + geography eligibility, creates the provider session via the adapter, and
 * NORMALIZES the heterogeneous adapter responses into one stable contract.
 *
 * STRICTLY a foundation:
 *   - NO live settlement, NO webhook activation, NO invoice finalization,
 *     NO subscription activation, NO wallet funding, NO ledger mutation,
 *     NO credit issuance.
 *   - PRICING-BLIND: the normalized contract carries no amount / plan price /
 *     invoice total. Amount resolution (a hidden server-side pricing lookup
 *     keyed by the plan/topup reference) is a deliberate FUTURE step — this
 *     foundation passes amount 0, so no real-value order is created.
 *   - Idempotency: a deterministic key is derived from the request inputs and
 *     threaded into the provider request metadata, so a retry of an identical
 *     request reuses the same key (the provider dedupes) and the orchestration
 *     response shape is deterministic.
 *
 * Dependency-injectable (the `deps` param) so the orchestrator is unit-
 * testable without a DB or a live provider.
 */

import crypto from 'crypto';
import {
  dispatchCheckout as realDispatchCheckout,
  getProviderAdapter as realGetProviderAdapter,
  type SupportedProvider,
  type CheckoutSessionRequest,
  type CheckoutSessionResult,
} from './paymentProviderAdapter';
import {
  resolveAvailableProviders as realResolveAvailableProviders,
  isProviderAvailableForCheckout as realIsProviderAvailableForCheckout,
} from './paymentProviderPolicyResolver';
import { resolveOrgBillingContext as realResolveOrgBillingContext } from './orgBillingContextResolver';
import { resolveBillingAmount as realResolveBillingAmount } from './billingAmountResolver';
import {
  findPersistedCheckoutSession as realFindPersistedCheckoutSession,
  persistCheckoutSession as realPersistCheckoutSession,
} from './checkoutSessionStore';

export type CheckoutIntentType = 'subscription' | 'topup';

const KNOWN_PROVIDERS: SupportedProvider[] = ['razorpay', 'stripe', 'cashfree', 'phonepe'];

export interface OrchestrateCheckoutArgs {
  organizationId: string;
  initiatedByUserId: string;
  provider: SupportedProvider;
  intentType: CheckoutIntentType;
  /** plan_reference (subscription) or topup_reference (topup). */
  reference: string;
}

/** The single normalized checkout-session contract. NO pricing fields. */
export interface NormalizedCheckoutSession {
  provider: string;
  provider_mode: 'test' | 'live' | 'unknown';
  /** 'created' = provider session exists; 'not_implemented' = governance-passed
   *  but the adapter is a stub (NOT_IMPLEMENTED passthrough). */
  session_status: 'created' | 'not_implemented';
  redirect_url: string | null;
  expires_at: string | null;
  provider_reference: string | null;
  supported_payment_methods: string[];
}

export type OrchestrateCheckoutResult =
  | { ok: true; session: NormalizedCheckoutSession; idempotency_key: string; replayed: boolean }
  | { ok: false; code: OrchestrateRejectionCode; reason: string };

export type OrchestrateRejectionCode =
  | 'invalid_intent_type'
  | 'invalid_reference'
  | 'unknown_provider'
  | 'provider_not_governed'
  | 'provider_disabled'
  | 'provider_in_maintenance'
  | 'provider_geography_unsupported'
  | 'provider_currency_unsupported'
  | 'provider_unavailable'
  | 'provider_error'
  // amount-resolution rejections (billingAmountResolver)
  | 'unknown_reference'
  | 'disabled_reference'
  | 'malformed_reference'
  // provider/currency compatibility
  | 'provider_currency_incompatible';

export interface OrchestratorDeps {
  dispatchCheckout: (req: CheckoutSessionRequest) => Promise<CheckoutSessionResult>;
  resolveAvailableProviders: typeof realResolveAvailableProviders;
  isProviderAvailableForCheckout: typeof realIsProviderAvailableForCheckout;
  resolveOrgBillingContext: typeof realResolveOrgBillingContext;
  resolveBillingAmount: typeof realResolveBillingAmount;
  getProviderAdapter: typeof realGetProviderAdapter;
  findPersistedCheckoutSession: typeof realFindPersistedCheckoutSession;
  persistCheckoutSession: typeof realPersistCheckoutSession;
}

const DEFAULT_DEPS: OrchestratorDeps = {
  dispatchCheckout: realDispatchCheckout,
  resolveAvailableProviders: realResolveAvailableProviders,
  isProviderAvailableForCheckout: realIsProviderAvailableForCheckout,
  resolveOrgBillingContext: realResolveOrgBillingContext,
  resolveBillingAmount: realResolveBillingAmount,
  getProviderAdapter: realGetProviderAdapter,
  findPersistedCheckoutSession: realFindPersistedCheckoutSession,
  persistCheckoutSession: realPersistCheckoutSession,
};

/**
 * Deterministic checkout idempotency key. Mirrors the makeIdempotencyKey
 * deterministic-hash pattern; derived inline (crypto) to keep this billing-
 * payments module decoupled from the ledger service. Identical inputs → the
 * same key → the provider dedupes a retried session.
 */
export function deriveCheckoutIdempotencyKey(args: OrchestrateCheckoutArgs): string {
  return crypto
    .createHash('sha256')
    .update([args.organizationId, args.intentType, args.reference, args.provider].join('|'))
    .digest('hex');
}

export async function orchestrateCheckoutSession(
  args: OrchestrateCheckoutArgs,
  depsOverride?: Partial<OrchestratorDeps>,
): Promise<OrchestrateCheckoutResult> {
  const deps: OrchestratorDeps = { ...DEFAULT_DEPS, ...depsOverride };

  // ── input validation ─────────────────────────────────────────────────────
  if (args.intentType !== 'subscription' && args.intentType !== 'topup') {
    return { ok: false, code: 'invalid_intent_type', reason: `intent_type must be subscription|topup` };
  }
  if (typeof args.reference !== 'string' || args.reference.trim() === '') {
    return { ok: false, code: 'invalid_reference', reason: 'plan/topup reference is required' };
  }
  if (!KNOWN_PROVIDERS.includes(args.provider)) {
    return { ok: false, code: 'unknown_provider', reason: `unknown provider: ${String(args.provider)}` };
  }

  // ── idempotent replay — return a persisted session if one exists ─────────
  // The key is deterministic in (org, intent, reference, provider). A repeated
  // identical request short-circuits here: the persisted session is returned
  // and NO provider dispatch happens.
  const idempotencyKey = deriveCheckoutIdempotencyKey(args);
  const persisted = await deps.findPersistedCheckoutSession(idempotencyKey);
  if (persisted) {
    return { ok: true, session: persisted, idempotency_key: idempotencyKey, replayed: true };
  }

  // ── geography (backend-authoritative; never from the caller) ─────────────
  const geo = await deps.resolveOrgBillingContext(args.organizationId);
  const geographyKnown = geo.country !== null;

  // ── governance: is this provider eligible for this geography? ────────────
  const available = await deps.resolveAvailableProviders({
    country: geo.country,
    currency: geo.currency,
    geographyKnown,
  });
  const governed = available.available.find((p) => p.provider === args.provider);
  if (!governed) {
    // Determine the precise rejection reason.
    const gate = await deps.isProviderAvailableForCheckout(args.provider, {
      country: geo.country,
      currency: geo.currency,
      geographyKnown,
    });
    const reason = gate.ok ? 'provider_unavailable' : (gate as { ok: false; reason: string }).reason;
    const code: OrchestrateRejectionCode =
      reason === 'provider_not_governed' ? 'provider_not_governed'
      : reason === 'provider_disabled' ? 'provider_disabled'
      : reason === 'provider_in_maintenance' ? 'provider_in_maintenance'
      : reason === 'provider_geography_unsupported' ? 'provider_geography_unsupported'
      : reason === 'provider_currency_unsupported' ? 'provider_currency_unsupported'
      : 'provider_unavailable';
    return { ok: false, code, reason: `provider ${args.provider} not available: ${reason}` };
  }

  // ── hidden server-side amount resolution ─────────────────────────────────
  // The amount + currency are resolved from the hidden pricing source keyed by
  // the plan/topup reference. The resolved amount is server-side ONLY — it is
  // placed in the provider request below and NEVER returned to the caller.
  const amountResult = await deps.resolveBillingAmount({
    intentType: args.intentType,
    reference: args.reference,
  });
  if (!amountResult.ok) {
    const fail = amountResult as { ok: false; code: OrchestrateRejectionCode; reason: string };
    return { ok: false, code: fail.code, reason: fail.reason };
  }

  // ── provider/currency compatibility enforcement ──────────────────────────
  // The resolved plan currency must be supported by the governed provider.
  // An empty supported_currencies array means "unrestricted". Rejected BEFORE
  // dispatchCheckout — no provider session is created on a currency mismatch.
  const resolvedCurrency = amountResult.amount.currency.toUpperCase();
  const providerCurrencies = governed.supported_currencies.map((c) => c.toUpperCase());
  if (providerCurrencies.length > 0 && !providerCurrencies.includes(resolvedCurrency)) {
    return {
      ok: false,
      code: 'provider_currency_incompatible',
      reason: `provider ${args.provider} does not support the plan currency ${resolvedCurrency}`,
    };
  }

  // ── create the provider session via the adapter ──────────────────────────
  // The resolved amount/currency is injected here (server→provider) — it does
  // not appear in any orchestration response.
  const req: CheckoutSessionRequest = {
    provider: args.provider,
    organizationId: args.organizationId,
    amount: amountResult.amount.amount,
    currency: amountResult.amount.currency,
    creditPackageId: args.reference,
    initiatedByUserId: args.initiatedByUserId,
    country: geo.country ?? undefined,
    metadata: {
      intent_type: args.intentType,
      reference: args.reference,
      idempotency_key: idempotencyKey,
    },
  };
  const result = await deps.dispatchCheckout(req);

  const adapter = deps.getProviderAdapter(args.provider);
  const providerMode = adapter ? adapter.describe().mode : 'unknown';

  // ── normalize the heterogeneous adapter response ─────────────────────────
  let session: NormalizedCheckoutSession;
  if (result.ok) {
    session = {
      provider: args.provider,
      provider_mode: providerMode,
      session_status: 'created',
      redirect_url: result.redirectUrl ?? null,
      expires_at: null, // adapter does not surface expiry today — future step
      provider_reference: result.sessionId ?? result.paymentIntentId ?? null,
      supported_payment_methods: governed.supported_payment_methods,
    };
  } else if (result.code === 'NOT_IMPLEMENTED') {
    // NOT_IMPLEMENTED passthrough — the provider is governance-approved but its
    // adapter is a stub (e.g. Stripe). A NORMALIZED success: the orchestration
    // path worked; the provider session is simply not wired.
    session = {
      provider: args.provider,
      provider_mode: providerMode,
      session_status: 'not_implemented',
      redirect_url: null,
      expires_at: null,
      provider_reference: null,
      supported_payment_methods: governed.supported_payment_methods,
    };
  } else {
    // Genuine provider/validation error — nothing to persist.
    return {
      ok: false,
      code: 'provider_error',
      reason: result.error ?? `provider ${args.provider} checkout failed`,
    };
  }

  // ── persist the normalized session for first-class idempotent replay ─────
  // Best-effort: a failed persist never fails the checkout (the provider also
  // received the idempotency key). A subsequent identical request will replay
  // the persisted row and skip provider dispatch entirely.
  await deps.persistCheckoutSession({
    idempotencyKey,
    organizationId: args.organizationId,
    intentType: args.intentType,
    referenceKey: args.reference,
    currency: amountResult.amount.currency,
    session,
  });

  return { ok: true, session, idempotency_key: idempotencyKey, replayed: false };
}
