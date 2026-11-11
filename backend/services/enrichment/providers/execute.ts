/**
 * A3 — the enrichment executor.
 *
 * The one path from "PI wants an attribute" to "a provenance-carrying
 * observation exists". It owns the order of operations, and the order is the
 * safety property:
 *
 *   tenant → adapter → credential → freshness/duplicate → COST → call → classify
 *   → normalise → persist as observation
 *
 * ─── COST IS AUTHORISED BEFORE THE CALL, NEVER RECORDED AFTER IT ──────────
 * Every refusal that precedes `authorizeCost` costs nothing because no call is
 * made. `authorizeCost` itself must reserve before it returns, and the default
 * implementation refuses outright — no prospect-enrichment credit action is
 * registered in `featureRegistry`, so there is nothing to reserve against.
 * Failing closed is the correct behaviour for a paid API: an unbounded call
 * followed by a bill is exactly what this ordering exists to prevent.
 *
 * ─── RETRY IS THE EXECUTOR'S, AND IT IS NOT AUTOMATIC ─────────────────────
 * Adapters must not retry internally: a layer that cannot see the bill must not
 * be able to multiply it. This executor makes exactly ONE provider call per
 * authorised request. Backoff/classification primitives already exist in
 * `ai/safety/providerRetryPolicy`; a retry policy that re-authorises cost per
 * attempt is a deliberate later decision, not a default.
 *
 * ─── IT NEVER FABRICATES AND NEVER OVERWRITES ─────────────────────────────
 * A provider absence is recorded as an absence, not a value. Nothing here
 * writes a canonical field: observations go to the LI-2 persistence port, which
 * owns the canonical-value decision and already withholds where sources
 * disagree. A failed enrichment cannot corrupt an identity because it never
 * touches one.
 */

import { normalizeEnrichmentResult, type EnrichmentResult } from '../result';
import type { SourceCost } from '../planner';
import {
  classifyEnrichmentError, NON_CALLING_OUTCOMES, refuse,
  type EnrichmentOutcome, type EnrichmentRequest, type EnrichmentProviderAdapter,
  type ProviderResponse,
} from './contract';
import { getProvider } from './registry';

export const ENRICHMENT_EXECUTOR_VERSION = 'a3.1';

/** How long an equivalent observation stays fresh enough to reuse. */
export const DEFAULT_FRESHNESS_DAYS = 30;

/**
 * MODE B (owner, 2026-11-10): who pays the vendor for a call.
 *   'tenant'   the tenant's OWN vendor key; the vendor bills the tenant; no
 *              Omnivyra credits (the A3X economics, unchanged).
 *   'platform' Omnivyra's central vendor key, opted into by the tenant; charged
 *              in Omnivyra credits at vendor cost x 1.5.
 */
export type CredentialFunding = 'tenant' | 'platform';

/**
 * What `resolveCredential` may answer. A bare string is the original contract
 * and means TENANT-funded, so every existing port keeps its meaning.
 */
export type ResolvedCredential = string | { readonly value: string; readonly funding: CredentialFunding };

/** Normalise a resolved credential. Anything unusable is null. */
export function readResolvedCredential(r: ResolvedCredential | null | undefined): { value: string; funding: CredentialFunding } | null {
  if (typeof r === 'string') return r.trim() ? { value: r, funding: 'tenant' } : null;
  if (r && typeof r === 'object' && typeof r.value === 'string' && r.value.trim()
    && (r.funding === 'tenant' || r.funding === 'platform')) {
    return { value: r.value, funding: r.funding };
  }
  return null;
}

/** Outcomes where the vendor ANSWERED, and so billed the call (misses included: the owner's rule). */
export const BILLABLE_OUTCOMES: readonly EnrichmentOutcome[] = ['enriched', 'no_match', 'field_not_found'];

/** Outcome of a cost decision. `denied` must stop the call. */
export type CostDecision =
  | { readonly authorized: true; readonly holdId: string | null; readonly cost: SourceCost }
  | { readonly authorized: false; readonly reason: string };

export interface ExecuteEnrichmentPorts {
  /**
   * Reserve budget BEFORE the provider is contacted. Must not return
   * `authorized: true` unless a reservation actually exists.
   */
  authorizeCost(input: {
    organizationId: string;
    providerId: string;
    attributes: readonly string[];
    correlationId: string;
    /** Mode B. Who pays the vendor for this call. Absent from older callers means 'tenant'. */
    funding?: CredentialFunding;
    /** Mode B. Which subject the call is about, for per-call vendor unit pricing. */
    subject?: 'person' | 'account';
    entityId?: string;
  }): Promise<CostDecision>;

  /** Release a reservation when the call produced nothing billable. */
  releaseCost(holdId: string | null, reason: string): Promise<void>;

  /**
   * MODE B, OPTIONAL. Settle a reservation after the vendor call: confirm it
   * when the vendor answered (`billable`, see BILLABLE_OUTCOMES) and release it
   * otherwise. When ABSENT the executor behaves exactly as before: release on a
   * provider error or an empty answer, nothing on success.
   */
  settleCost?(input: {
    holdId: string | null;
    funding: CredentialFunding;
    billable: boolean;
    outcome: EnrichmentOutcome;
    correlationId: string;
    reason: string;
  }): Promise<number | void>;

  /**
   * A3M — resolve THIS TENANT's credential for this provider.
   *
   * Required, not optional, and deliberately so. Before A3M the executor asked
   * "is an environment variable present?" and treated the answer as evidence
   * that a tenant could use a provider. It is not: `process.env` holds ONE key
   * for the whole platform, so a tenant that had authorised nothing would have
   * spent Omnivyra's key under Omnivyra's bill, and every tenant would have
   * shared one rate limit. Nothing in the type system objected, because there
   * was no tenant in the question.
   *
   * Making this a REQUIRED port means a caller that has no tenant credential
   * source cannot construct a valid executor at all. An optional port would
   * have re-created the defect the moment someone omitted it.
   *
   * Returns null when this tenant has no credential for this provider. Null is
   * final: the executor answers `credential_missing` and stops. It MUST NOT
   * fall back to the environment — see `credentials.ts`.
   */
  resolveCredential(input: {
    organizationId: string;
    providerId: string;
  }): Promise<ResolvedCredential | null>;

  /**
   * The most recent equivalent observation, for duplicate suppression.
   * Equivalence is (tenant, SUBJECT, entity, provider, attribute set) — the
   * identity `source_records.payload_hash` and `observation_count` already
   * model.
   *
   * O-3 — the subject is REQUIRED, and typed as `persistObservation` types it
   * below. An id alone does not say which subject it names, and a person
   * assertion carries the account leg too, so a subject-blind lookup let an
   * employee's evidence suppress company enrichment.
   */
  findRecentObservation(input: {
    organizationId: string;
    subject: 'person' | 'account';
    entityId: string;
    providerId: string;
    attributes: readonly string[];
  }): Promise<{ observedAt: string } | null>;

  /** Hand the observation to LI-2. The ONLY write in this path. */
  persistObservation(input: {
    organizationId: string;
    providerId: string;
    subject: 'person' | 'account';
    entityId: string;
    fields: ProviderResponse['fields'];
    rawPayload: unknown;
    payloadHash: string | null;
    observedAt: string | null;
    correlationId: string;
    /**
     * PROVENANCE — the canonical prospect this enrichment is for, when the
     * caller knows it. Optional and additive: it only selects which prospect
     * the provider is recorded as a contributing source of.
     */
    prospectId?: string | null;
  }): Promise<{ sourceRecordId: string; canonicalWithheld: readonly { attribute: string; reason: string }[] }>;

  now(): string;
}

/**
 * The default authorization port — A3X, tenant-funded.
 *
 * It used to be `creditCostPort`, which asked the monetization registry to
 * reserve Omnivyra credits before provider spend. That is the right instrument
 * only when Omnivyra pays the vendor; under BYO-provider the tenant holds the
 * subscription and is billed directly, so pricing the action would have meant
 * inventing an Omnivyra charge for someone else's invoice.
 *
 * Authorization did not go away with billing: a tenant reaches this port only
 * after supplying its own credential, and platform capacity or rate limits
 * attach here through `makeTenantFundedExecutionPort({ allow })`. See `cost.ts`.
 */
export { tenantFundedExecutionPort as defaultCostPort } from './cost';

export interface ExecuteEnrichmentResult {
  readonly outcome: EnrichmentOutcome;
  readonly providerId: string | null;
  /** True only when an external provider was actually contacted. */
  readonly providerCalled: boolean;
  readonly attributesReturned: readonly string[];
  readonly attributesNotReturned: readonly string[];
  readonly sourceRecordId: string | null;
  readonly canonicalWithheld: readonly { attribute: string; reason: string }[];
  /** The normalised, provider-neutral result. Null when nothing was returned. */
  readonly normalized: EnrichmentResult | null;
  readonly reason: string;
  readonly correlationId: string;
  /**
   * A6A — the provider's own retry horizon, ISO-8601, or null.
   *
   * Null means the provider said nothing usable, NOT "retry now". Never
   * synthesised: no backoff, no fixed duration, nothing from the attempt number.
   */
  readonly retryAfterAt: string | null;
  /** The vendor's typed refusal, passed through from the adapter. Null otherwise. */
  readonly providerError?: unknown;
  /** The vendor's request-rate quota from its own headers. Null when it stated none. */
  readonly providerUsage?: unknown;
  /** Mode B: who paid the vendor for this call. Absent when no credential was resolved. */
  readonly funding?: CredentialFunding;
  /** Mode B: Omnivyra credits confirmed for this call (0 for own key or a released hold). */
  readonly creditsCharged?: number;
}

const outcomeResult = (
  outcome: EnrichmentOutcome, request: EnrichmentRequest, providerId: string | null,
  reason: string, providerCalled = false,
): ExecuteEnrichmentResult => ({
  outcome,
  providerId,
  providerCalled,
  attributesReturned: [],
  attributesNotReturned: request.attributes,
  sourceRecordId: null,
  canonicalWithheld: [],
  normalized: null,
  reason,
  correlationId: request.correlationId,
  retryAfterAt: null,          // A6A: only a provider response can supply one
  providerError: null,
  providerUsage: null,
});

const daysBetween = (a: string, b: string): number =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;

/**
 * Run one enrichment attempt.
 *
 * @param providerId which adapter to use. Chosen by the caller from
 *        `providersFor(...)`; never taken from client input.
 */
export async function executeEnrichment(
  request: EnrichmentRequest,
  providerId: string,
  ports: ExecuteEnrichmentPorts,
  options: { freshnessDays?: number; adapter?: EnrichmentProviderAdapter } = {},
): Promise<ExecuteEnrichmentResult> {
  // ── tenant ───────────────────────────────────────────────────────────────
  const organizationId = String(request.organizationId ?? '').trim();
  if (!organizationId) {
    return outcomeResult('provider_declined', request, providerId,
      'organizationId is required — an enrichment is never tenant-less');
  }
  if (!String(request.entityId ?? '').trim()) {
    return outcomeResult('provider_declined', request, providerId, 'entityId is required');
  }
  if (!request.attributes.length) {
    return outcomeResult('field_not_found', request, providerId, 'no attributes were requested');
  }

  // ── adapter ──────────────────────────────────────────────────────────────
  const adapter = options.adapter ?? getProvider(providerId);
  if (!adapter) {
    return outcomeResult('not_implemented', request, providerId,
      `no adapter is registered for provider '${providerId}'`);
  }

  // ── credential — TENANT-OWNED, never the environment (A3M) ───────────────
  // `adapter.isAvailable()` and `hasCredential(adapter.credentialEnvVar)` used
  // to stand here. Both read `process.env`, so both answered a question about
  // OMNIVYRA rather than about this tenant, and either one passing would have
  // let Tenant A spend a key Tenant A never supplied. They are gone from the
  // execution path on purpose; `listProviderStatus` still uses `isAvailable`
  // to describe an adapter, which is a display concern, not an authorisation.
  const resolvedCredential = readResolvedCredential(await ports.resolveCredential({
    organizationId, providerId: adapter.id,
  }));
  if (!resolvedCredential) {
    return outcomeResult('credential_missing', request, adapter.id,
      `no credential is configured for '${adapter.id}' by this tenant`);
  }

  const supported = request.attributes.filter((a) => adapter.supports.includes(a));
  if (!supported.length) {
    return outcomeResult('field_not_found', request, adapter.id,
      `'${adapter.id}' does not supply any of: ${request.attributes.join(', ')}`);
  }

  // ── duplicate suppression, BEFORE cost ───────────────────────────────────
  // Cheaper than a reservation and cheaper than a call. A recent equivalent
  // observation means the answer is already on file.
  const freshnessDays = options.freshnessDays ?? DEFAULT_FRESHNESS_DAYS;
  const recent = await ports.findRecentObservation({
    organizationId, subject: request.subject, entityId: request.entityId,
    providerId: adapter.id, attributes: supported,
  });
  if (recent && daysBetween(ports.now(), recent.observedAt) < freshnessDays) {
    return outcomeResult('duplicate_suppressed', request, adapter.id,
      `an equivalent observation from ${recent.observedAt} is still within the ${freshnessDays}-day window`);
  }

  // ── cost, BEFORE the call ────────────────────────────────────────────────
  const { value: credential, funding } = resolvedCredential;
  const decision = await ports.authorizeCost({
    organizationId, providerId: adapter.id, attributes: supported, correlationId: request.correlationId,
    funding, subject: request.subject, entityId: request.entityId,
  });
  // `'reason' in decision`, not `!decision.authorized`: the root tsconfig sets
  // `strict: false`, which disables union narrowing on a negated discriminant.
  if ('reason' in decision) {
    return outcomeResult('cost_denied', request, adapter.id, decision.reason);
  }

  // Settlement after the call. Without a `settleCost` port this is EXACTLY the
  // original behaviour: release when nothing billable came back, nothing on
  // success. With one (mode B) the port confirms or releases.
  let creditsCharged = 0;
  const settle = async (outcome: EnrichmentOutcome, reason: string): Promise<void> => {
    const billable = BILLABLE_OUTCOMES.includes(outcome);
    if (ports.settleCost) {
      const charged = await ports.settleCost({ holdId: decision.holdId, funding, billable, outcome, correlationId: request.correlationId, reason });
      // Only a PLATFORM-funded call can cost Omnivyra credits: an own key is
      // never charged, whatever a port returns (the ledger CHECK says the same).
      creditsCharged = funding === 'platform' && typeof charged === 'number' && charged > 0 ? charged : 0;
    } else if (outcome !== 'enriched') {
      await ports.releaseCost(decision.holdId, reason);
    }
  };

  // ── the single call ──────────────────────────────────────────────────────
  let response: ProviderResponse;
  try {
    // The tenant's credential is injected HERE and nowhere earlier: it lives
    // for the duration of one call and is never persisted, logged or returned.
    response = await adapter.enrich({ ...request, organizationId, attributes: supported, credential });
  } catch (err) {
    // One call, one classification, no retry. An unrecognised error becomes
    // `provider_unavailable`, never `no_match`.
    const outcome = classifyEnrichmentError(err);
    await settle(outcome, `provider error: ${outcome}`);
    return { ...outcomeResult(outcome, request, adapter.id,
      err instanceof Error ? err.message : String(err), true), funding, creditsCharged };
  }

  const usable = response.fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== '');
  if (!usable.length) {
    // The provider answered and had nothing. That is a fact worth keeping, but
    // there is no observation to persist and nothing billable to confirm.
    const finalOutcome = response.outcome === 'enriched' ? 'field_not_found' : response.outcome;
    await settle(finalOutcome, `no usable field: ${response.outcome}`);
    return {
      funding,
      creditsCharged,
      ...outcomeResult(response.outcome === 'enriched' ? 'field_not_found' : response.outcome,
        request, adapter.id, response.detail ?? 'the provider returned no usable field', true),
      attributesNotReturned: response.notReturned.length ? response.notReturned : supported,
      // A6A: a rate-limited or unavailable provider answers HERE, and this is
      // the only branch that can carry a horizon.
      retryAfterAt: response.retryAfterAt ?? null,
      // The vendor's exact refusal and quota, passed through unchanged.
      providerError: response.providerError ?? null,
      providerUsage: response.providerUsage ?? null,
    };
  }

  // ── persist as an observation ────────────────────────────────────────────
  // A persistence failure AFTER a paid answer gives the tenant nothing, so the
  // reservation is released (never confirmed) before the error propagates.
  const persistOrRelease = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (ports.settleCost) {
        await ports.settleCost({ holdId: decision.holdId, funding, billable: false, outcome: 'enriched',
          correlationId: request.correlationId, reason: 'persistence failed after the vendor answered' });
      }
      // The recorder closes this attempt from the thrown error; tell it who paid
      // the vendor, so a paid-not-stored row still reports its funding.
      if (err && typeof err === 'object') (err as { funding?: CredentialFunding }).funding = funding;
      throw err;
    }
  };
  const persisted = await persistOrRelease(() => ports.persistObservation({
    organizationId,
    providerId: adapter.id,
    subject: request.subject,
    entityId: request.entityId,
    fields: usable,
    rawPayload: response.rawPayload ?? null,
    payloadHash: response.payloadHash ?? null,
    // The PROVIDER's timestamp when it gave one. Our clock is not their
    // observation time, and recording it as such would age evidence wrongly.
    observedAt: usable.find((f) => f.observedAt)?.observedAt ?? null,
    correlationId: request.correlationId,
    prospectId: request.prospectId ?? null,
  }));

  const normalized = normalizeEnrichmentResult({
    organizationId,
    prospectId: request.entityId,
    requested: supported,
    source: adapter.id,
    returned: usable.map((f) => ({
      attribute: f.attribute, subject: f.subject, value: f.value,
      observedAt: f.observedAt, confidence: f.confidence,
    })),
    cost: response.cost,
    now: ports.now(),
  });

  await settle('enriched', 'enriched');

  return {
    outcome: 'enriched',
    funding,
    creditsCharged,
    retryAfterAt: null,          // A6A: a successful call imposes no wait
    providerError: null,
    providerUsage: response.providerUsage ?? null,
    providerId: adapter.id,
    providerCalled: true,
    attributesReturned: normalized.returnedAttributes,
    attributesNotReturned: normalized.notReturned,
    sourceRecordId: persisted.sourceRecordId,
    canonicalWithheld: persisted.canonicalWithheld,
    normalized,
    reason: normalized.reason,
    correlationId: request.correlationId,
  };
}

/** Whether an outcome means no external provider was contacted. */
export const wasFree = (outcome: EnrichmentOutcome): boolean =>
  NON_CALLING_OUTCOMES.includes(outcome);

export { refuse };
