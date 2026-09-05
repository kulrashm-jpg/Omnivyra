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
import { getProvider, hasCredential } from './registry';

export const ENRICHMENT_EXECUTOR_VERSION = 'a3.1';

/** How long an equivalent observation stays fresh enough to reuse. */
export const DEFAULT_FRESHNESS_DAYS = 30;

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
  }): Promise<CostDecision>;

  /** Release a reservation when the call produced nothing billable. */
  releaseCost(holdId: string | null, reason: string): Promise<void>;

  /**
   * The most recent equivalent observation, for duplicate suppression.
   * Equivalence is (tenant, entity, provider, attribute set) — the identity
   * `source_records.payload_hash` and `observation_count` already model.
   */
  findRecentObservation(input: {
    organizationId: string;
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
  }): Promise<{ sourceRecordId: string; canonicalWithheld: readonly { attribute: string; reason: string }[] }>;

  now(): string;
}

/**
 * The default cost port. It REFUSES.
 *
 * `executeWithCredits` is the canonical reservation seam, but it asserts a
 * canonical credit action and `featureRegistry` registers none for prospect
 * enrichment — `internal.profile_enrichment` is company-profile enrichment and
 * charging prospect work to it would mis-attribute the spend. Until an action
 * is registered, the honest answer is that cost cannot be authorised, so no
 * paid call may happen. Registering the action is what turns this on; no code
 * here changes.
 */
export const defaultCostPort: Pick<ExecuteEnrichmentPorts, 'authorizeCost' | 'releaseCost'> = {
  async authorizeCost() {
    return {
      authorized: false,
      reason:
        'no prospect-enrichment credit action is registered in featureRegistry, so provider spend '
        + 'cannot be reserved; refusing before any external call',
    };
  },
  async releaseCost() { /* nothing was reserved */ },
};

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

  // ── credential ───────────────────────────────────────────────────────────
  if (!adapter.isAvailable() || !hasCredential(adapter.credentialEnvVar)) {
    return outcomeResult('credential_missing', request, adapter.id,
      `${adapter.credentialEnvVar ?? 'the credential'} is not configured for '${adapter.id}'`);
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
    organizationId, entityId: request.entityId, providerId: adapter.id, attributes: supported,
  });
  if (recent && daysBetween(ports.now(), recent.observedAt) < freshnessDays) {
    return outcomeResult('duplicate_suppressed', request, adapter.id,
      `an equivalent observation from ${recent.observedAt} is still within the ${freshnessDays}-day window`);
  }

  // ── cost, BEFORE the call ────────────────────────────────────────────────
  const decision = await ports.authorizeCost({
    organizationId, providerId: adapter.id, attributes: supported, correlationId: request.correlationId,
  });
  // `'reason' in decision`, not `!decision.authorized`: the root tsconfig sets
  // `strict: false`, which disables union narrowing on a negated discriminant.
  if ('reason' in decision) {
    return outcomeResult('cost_denied', request, adapter.id, decision.reason);
  }

  // ── the single call ──────────────────────────────────────────────────────
  let response: ProviderResponse;
  try {
    response = await adapter.enrich({ ...request, organizationId, attributes: supported });
  } catch (err) {
    // One call, one classification, no retry. An unrecognised error becomes
    // `provider_unavailable`, never `no_match`.
    const outcome = classifyEnrichmentError(err);
    await ports.releaseCost(decision.holdId, `provider error: ${outcome}`);
    return outcomeResult(outcome, request, adapter.id,
      err instanceof Error ? err.message : String(err), true);
  }

  const usable = response.fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== '');
  if (!usable.length) {
    // The provider answered and had nothing. That is a fact worth keeping, but
    // there is no observation to persist and nothing billable to confirm.
    await ports.releaseCost(decision.holdId, `no usable field: ${response.outcome}`);
    return {
      ...outcomeResult(response.outcome === 'enriched' ? 'field_not_found' : response.outcome,
        request, adapter.id, response.detail ?? 'the provider returned no usable field', true),
      attributesNotReturned: response.notReturned.length ? response.notReturned : supported,
    };
  }

  // ── persist as an observation ────────────────────────────────────────────
  const persisted = await ports.persistObservation({
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
  });

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

  return {
    outcome: 'enriched',
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
