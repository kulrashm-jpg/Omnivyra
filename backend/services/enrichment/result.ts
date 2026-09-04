/**
 * WS-2 (FR-10) — enrichment result handling.
 *
 * Turns whatever a source returned into (a) an auditable result envelope and
 * (b) the attribute payload LI-2's boundary already knows how to persist.
 *
 * ─── IT PERSISTS NOTHING AND ARBITRATES NOTHING ───────────────────────────
 * `prospectIdentity/ingestionBoundary.ingestSourceRecord` remains the sole
 * writer of canonical attributes, and LI-2's RULE A/B/C remains the sole
 * conflict policy: one uncontested value applies, disagreeing sources withhold,
 * an existing canonical value is never overwritten. This module produces LI-2's
 * INPUT. It does not decide what wins, and it creates no enrichment table —
 * `source_records` / `source_assertions` already are the evidence store.
 *
 * ─── FAILURE MUST NOT DESTROY WHAT WE ALREADY KNEW ────────────────────────
 * This is the property the whole module exists to guarantee, and it is enforced
 * structurally rather than by discipline: `apply` contains ONLY attributes the
 * source actually returned with a usable value. A field that was requested and
 * not returned produces no entry at all, so there is nothing for a downstream
 * writer to null. Therefore:
 *
 *   provider unavailable  ⇒ apply = {}      (never "field := null")
 *   provider timeout      ⇒ apply = {}      (prior observation untouched)
 *   partial response      ⇒ apply = returned subset only
 *   failed response       ⇒ apply = {}
 *
 * A caller cannot opt out of that by passing a null: nulls and blanks are
 * dropped on the way in, and recorded as `notReturned`.
 *
 * ─── UNKNOWN COST STAYS UNKNOWN ───────────────────────────────────────────
 * The cost carried here is the planner's `SourceCost`, unchanged. An unpriced
 * call is never recorded as costing zero, because a zero would later be summed.
 */

import type { SourceCost } from './planner';
import { UNKNOWN_COST } from './planner';

export const ENRICHMENT_RESULT_VERSION = 'ws2.1';

/**
 * Outcome of one enrichment attempt.
 *
 * `no_available_source` and `unavailable` are deliberately distinct: the first
 * means nothing could ever have served this request (the planner never found a
 * source), the second means a source existed but could not be reached now. One
 * is a coverage gap, the other is an outage, and conflating them would hide a
 * broken integration behind an apparent product limitation.
 */
export const ENRICHMENT_STATUSES = [
  'success',
  'partial',
  'no_available_source',
  'unavailable',
  'failed',
  'conflicting',
] as const;
export type EnrichmentStatus = typeof ENRICHMENT_STATUSES[number];

/** One attribute a source returned. */
export interface ReturnedField {
  readonly attribute: string;
  readonly subject: 'person' | 'account';
  readonly value: unknown;
  /** When the SOURCE observed it — not when we called. */
  readonly observedAt?: string | null;
  /** 0..1 where the source states one. Absent means the source did not say. */
  readonly confidence?: number | null;
}

export interface EnrichmentAttemptInput {
  readonly organizationId: string;
  readonly prospectId: string;
  /** Attributes asked for. Preserved verbatim so a gap is auditable. */
  readonly requested: readonly string[];
  /** Source key, or null when the planner found none. */
  readonly source: string | null;
  readonly returned?: readonly ReturnedField[];
  readonly cost?: SourceCost;
  /** Set when the call failed. Its presence is what makes this a failure. */
  readonly error?: { readonly kind: 'unavailable' | 'timeout' | 'rejected' | 'error'; readonly message: string } | null;
  /** True when the caller re-fetched something it already held. */
  readonly refresh?: boolean;
  /** Injected. The instant the attempt was recorded. */
  readonly now: string;
}

export interface EnrichmentResult {
  readonly organizationId: string;
  readonly prospectId: string;
  readonly version: string;
  readonly recordedAt: string;
  readonly source: string | null;
  readonly status: EnrichmentStatus;
  readonly requested: readonly string[];
  readonly returnedAttributes: readonly string[];
  /** Requested but not returned. The audit trail of the gap. */
  readonly notReturned: readonly string[];
  readonly cost: SourceCost;
  readonly refresh: boolean;
  readonly error: { readonly kind: string; readonly message: string } | null;
  /**
   * Attribute payload for LI-2. Split by subject because
   * `ingestSourceRecord` is single-entity by design: one entityType, one
   * target table, one allowed column set.
   */
  readonly apply: {
    readonly person: Readonly<Record<string, unknown>>;
    readonly account: Readonly<Record<string, unknown>>;
  };
  /** Per-attribute source time and confidence, preserved as provenance. */
  readonly provenance: readonly {
    readonly attribute: string;
    readonly subject: 'person' | 'account';
    readonly observedAt: string | null;
    readonly confidence: number | null;
  }[];
  readonly reason: string;
}

const usable = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

const confidenceOf = (c: unknown): number | null =>
  typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1 ? c : null;

/**
 * Normalise one attempt.
 *
 * Total and deterministic: every requested attribute ends up in exactly one of
 * `returnedAttributes` or `notReturned`, and the status follows from the inputs
 * rather than from a caller's assertion — a caller cannot declare `success`
 * while returning nothing.
 */
export function normalizeEnrichmentResult(input: EnrichmentAttemptInput): EnrichmentResult {
  if (!input.organizationId?.trim()) throw new Error('organizationId is required to record an enrichment result');
  if (!input.prospectId?.trim()) throw new Error('prospectId is required to record an enrichment result');

  const requested = [...new Set(input.requested.filter((a) => typeof a === 'string' && a.trim() !== ''))];
  const cost = input.cost ?? UNKNOWN_COST;
  const refresh = input.refresh === true;

  // Only usable values survive. This single filter is what makes a failure
  // structurally incapable of nulling a previously valid field.
  const returned = (input.returned ?? []).filter((f) => usable(f.value));

  const person: Record<string, unknown> = {};
  const account: Record<string, unknown> = {};
  const provenance: EnrichmentResult['provenance'] = returned.map((f) => {
    (f.subject === 'person' ? person : account)[f.attribute] = f.value;
    return {
      attribute: f.attribute,
      subject: f.subject,
      observedAt: typeof f.observedAt === 'string' && f.observedAt.trim() !== '' ? f.observedAt : null,
      confidence: confidenceOf(f.confidence),
    };
  });

  const returnedAttributes = returned.map((f) => f.attribute);
  const notReturned = requested.filter((a) => !returnedAttributes.includes(a));

  const base = {
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    version: ENRICHMENT_RESULT_VERSION,
    recordedAt: input.now,
    source: input.source ?? null,
    requested,
    returnedAttributes,
    notReturned,
    cost,
    refresh,
    provenance,
  };

  const empty = { person: {} as Record<string, unknown>, account: {} as Record<string, unknown> };

  // A failure NEVER carries an apply payload, even if the caller also passed
  // fields. A partial success that also errored is still an error for the
  // fields it did not deliver, and letting a half-failed call write would make
  // the error state advisory rather than binding.
  if (input.error) {
    const status: EnrichmentStatus = input.error.kind === 'unavailable' ? 'unavailable' : 'failed';
    return { ...base, status, error: { ...input.error }, apply: empty,
      reason: `${status}: ${input.error.message} — no attribute was applied, so prior values are untouched` };
  }

  if (!input.source) {
    return { ...base, status: 'no_available_source', error: null, apply: empty,
      reason: 'the planner found no source able to supply these attributes; nothing was attempted and nothing changed' };
  }

  if (returned.length === 0) {
    return { ...base, status: 'partial', error: null, apply: empty,
      reason: 'the source returned no usable value for any requested attribute; prior values are untouched' };
  }

  const status: EnrichmentStatus = notReturned.length === 0 ? 'success' : 'partial';
  return { ...base, status, error: null, apply: { person, account },
    reason: status === 'success'
      ? 'every requested attribute was returned; LI-2 arbitrates what becomes canonical'
      : `${returnedAttributes.length} of ${requested.length} attributes returned; the remainder stay as they were` };
}

/**
 * Mark a result as CONFLICTING, after LI-2 has spoken.
 *
 * Conflict is not something this module can detect: it is LI-2's verdict, and
 * LI-2 only reaches it once the evidence is beside the existing canonical
 * value. So the flow is: normalise → hand `apply` to `ingestSourceRecord` →
 * if LI-2 withheld anything with `sources_disagree`, re-stamp the result here.
 *
 * The apply payload is CLEARED when re-stamping. LI-2 already declined to write
 * those values; carrying them forward would invite a caller to apply them
 * anyway, which is precisely the silent overwrite RULE B exists to prevent.
 */
export function markConflicting(
  result: EnrichmentResult,
  withheld: readonly { attribute: string; reason: string }[],
): EnrichmentResult {
  const disagreed = withheld.filter((w) => w.reason === 'sources_disagree').map((w) => w.attribute);
  if (disagreed.length === 0) return result;

  return {
    ...result,
    status: 'conflicting',
    apply: { person: {}, account: {} },
    reason: `LI-2 withheld ${disagreed.length} attribute(s) because sources disagree (${disagreed.join(', ')}); `
      + 'the evidence is retained and no canonical value was overwritten',
  };
}
