/**
 * WS-4 Phase-2 — enrichment orchestration: selection, fallback, conflict
 * resolution and aggregation.
 *
 * ─── CONFLICT RESOLUTION IS TOTALLY ORDERED ────────────────────────────────
 * Two providers will disagree about headcount. The winner is decided by a
 * comparison that can never tie:
 *      1. higher confidence
 *      2. then lower provider precedence  (a standing judgement about vendors)
 *      3. then lexicographically smaller provider id
 * Step 3 exists solely to remove the last source of nondeterminism. Without it
 * two equally-confident, equally-precedent providers would resolve by Map
 * iteration order, and the "same inputs ⇒ same outputs" property would hold
 * only by luck.
 *
 * ─── EVERY LOSER IS KEPT ───────────────────────────────────────────────────
 * A rejected value is retained as a contribution rather than discarded. The
 * question an operator eventually asks is never "what is the headcount" — it is
 * "why does this say 400 when the CRM says 900", and that is unanswerable if
 * the losing value was dropped at aggregation time.
 *
 * ─── FALLBACK IS NOT RETRY ─────────────────────────────────────────────────
 * If a provider is unavailable the next provider for that capability is
 * consulted; the failing one is NOT called again. Retrying a metered API inside
 * an aggregation loop is how a bounded enrichment becomes an unbounded bill.
 * Transport-level retry belongs in the adapter, against its own vendor's
 * documented semantics — not here.
 *
 * Pure given its injected providers and clock: no I/O of its own, no clock read,
 * no randomness.
 */

import type {
  CompanyEnrichmentProvider,
  EnrichmentCapability,
  EnrichmentField,
  EnrichmentRequest,
  ProviderResult,
  UnavailableReason,
} from './contract';
import { providersFor } from './registry';

/** One provider's claim about a field — winner or loser. */
export interface FieldContribution {
  provider: string;
  value: string;
  confidence: number;
  observedAt: string;
  precedence: number;
  won: boolean;
  /** Present on losers: why this claim did not win. */
  supersededBy?: string;
}

export interface ResolvedField {
  key: string;
  value: string;
  confidence: number;
  observedAt: string;
  provider: string;
  /** Every claim for this key, winner first, then losers in resolution order. */
  contributions: FieldContribution[];
  /** True when at least two providers claimed DIFFERENT values. */
  contested: boolean;
}

export interface CapabilityOutcome {
  capability: EnrichmentCapability;
  consulted: string[];
  answered: string[];
  unavailable: Array<{ provider: string; reason: UnavailableReason; detail: string | null }>;
}

export interface EnrichmentAggregate {
  companyId: string;
  domain: string | null;
  asOf: string;
  fields: ResolvedField[];
  capabilities: CapabilityOutcome[];
  /** Total metered units this aggregate cost. */
  costUnits: number;
  /** True when nothing at all could be measured — the honest empty state. */
  empty: boolean;
}

export interface OrchestrationOptions {
  capabilities?: readonly EnrichmentCapability[];
  /**
   * Injected provider list, for tests and for callers that want an explicit
   * set rather than the global registry.
   */
  providers?: readonly CompanyEnrichmentProvider[];
  /**
   * Stop consulting a capability's providers once one has answered. Default
   * true: consulting a second metered vendor for a field already measured
   * spends money to create a conflict.
   */
  stopOnFirstAnswer?: boolean;
}

/**
 * Enrich one company across the requested capabilities.
 *
 * Never throws. A provider that rejects is recorded as `provider_error` and the
 * aggregation continues — one broken vendor must not deny the caller the data
 * every other vendor returned.
 */
export async function enrichCompany(
  request: EnrichmentRequest,
  options: OrchestrationOptions = {},
): Promise<EnrichmentAggregate> {
  const capabilities = options.capabilities ?? (['firmographics', 'technology', 'funding', 'hiring', 'identity'] as const);
  const stopOnFirstAnswer = options.stopOnFirstAnswer !== false;

  const claims = new Map<string, FieldContribution[]>();
  const outcomes: CapabilityOutcome[] = [];
  let costUnits = 0;

  for (const capability of capabilities) {
    const providers = options.providers
      ? options.providers.filter((p) => p.capabilities.includes(capability))
      : providersFor(capability);

    const outcome: CapabilityOutcome = { capability, consulted: [], answered: [], unavailable: [] };

    for (const provider of providers) {
      outcome.consulted.push(provider.id);

      // An unconfigured provider is never called. This is the difference
      // between "we have no key" and "we called a vendor without a key and it
      // 401'd" — the second wastes a request and pollutes the vendor's logs.
      if (!provider.isConfigured()) {
        outcome.unavailable.push({ provider: provider.id, reason: 'no_credential', detail: null });
        continue;
      }

      const result = await safeFetch(provider, request, capability);
      costUnits += result.costUnits;

      if (result.state !== 'measured') {
        outcome.unavailable.push({
          provider: provider.id,
          reason: result.reasonUnavailable ?? 'provider_error',
          detail: result.detail,
        });
        continue;
      }

      outcome.answered.push(provider.id);
      for (const field of result.fields) {
        const list = claims.get(field.key) ?? [];
        list.push({
          provider: provider.id,
          value: field.value,
          confidence: clamp01(field.confidence),
          observedAt: field.observedAt,
          precedence: provider.precedence,
          won: false,
        });
        claims.set(field.key, list);
      }

      if (stopOnFirstAnswer) break;
    }

    outcomes.push(outcome);
  }

  const fields = resolveClaims(claims);
  return {
    companyId: request.companyId,
    domain: request.domain,
    asOf: request.asOf,
    fields,
    capabilities: outcomes,
    costUnits,
    empty: fields.length === 0,
  };
}

/** Total order over claims. Never returns 0 for two distinct providers. */
function betterClaim(a: FieldContribution, b: FieldContribution): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.precedence !== b.precedence) return a.precedence - b.precedence;
  return a.provider.localeCompare(b.provider);
}

function resolveClaims(claims: Map<string, FieldContribution[]>): ResolvedField[] {
  const out: ResolvedField[] = [];

  // Keys sorted so the aggregate's field order is stable across runs.
  for (const key of [...claims.keys()].sort()) {
    const list = [...(claims.get(key) ?? [])].sort(betterClaim);
    if (list.length === 0) continue;

    const winner = list[0];
    winner.won = true;
    for (const loser of list.slice(1)) loser.supersededBy = winner.provider;

    out.push({
      key,
      value: winner.value,
      confidence: winner.confidence,
      observedAt: winner.observedAt,
      provider: winner.provider,
      contributions: list,
      // Contested means genuine disagreement. Two providers reporting the SAME
      // value is corroboration, and flagging it as a conflict would train
      // operators to ignore the flag.
      contested: new Set(list.map((c) => c.value)).size > 1,
    });
  }

  return out;
}

async function safeFetch(
  provider: CompanyEnrichmentProvider,
  request: EnrichmentRequest,
  capability: EnrichmentCapability,
): Promise<ProviderResult> {
  try {
    return await provider.fetch(request, capability);
  } catch (error) {
    return {
      provider: provider.id,
      capability,
      state: 'unavailable',
      fields: [],
      reasonUnavailable: 'provider_error',
      detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      costUnits: 0,
    };
  }
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Field lookup helper for consumers that want one value without walking the array. */
export function fieldValue(aggregate: EnrichmentAggregate, key: string): string | null {
  return aggregate.fields.find((f) => f.key === key)?.value ?? null;
}

export type { EnrichmentField };
