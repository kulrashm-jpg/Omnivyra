/**
 * WS-2 (FR-07, FR-09) — the enrichment planner.
 *
 * Decides WHAT is worth enriching and WHICH actually-available source could
 * satisfy it. It decides nothing else: it fetches nothing, calls no provider,
 * writes nothing, and invents no capability.
 *
 * ─── PURE, LIKE EVERY OTHER DECISION MODULE IN THIS PROGRAMME ─────────────
 * No I/O and no clock. `now` is injected, exactly as `mayContact` and LI-2's
 * `decideCanonicalUpdates` take it, so the same inputs always produce the same
 * plan. That is what makes an enrichment decision defensible months later, and
 * what lets the whole matrix below be tested without a database or a network.
 *
 * ─── IT OWNS NO VOCABULARY IT DID NOT HAVE TO OWN ─────────────────────────
 * Source availability is `dataSourceCatalogue.resolveDataSourceStatus` — the
 * registry that already knows a declared provider is `not_available` rather
 * than `not_connected`, because "connecting it is possible today" would be a
 * lie. Conflict is LI-2's `sources_disagree`, not a second conflict rule.
 * Field names are the existing canonical attribute surfaces. Nothing here
 * re-derives any of them.
 *
 * ─── "NO AVAILABLE SOURCE" IS A CORRECT ANSWER ────────────────────────────
 * There is no authorized people/firmographic provider in this platform. A
 * planner that responded by inventing one, or by silently ranking an
 * unavailable provider first, would produce a plan nobody can execute. So an
 * unenrichable field is reported as `no_available_source` with the reason, and
 * that is a successful plan — not a failure and not an error.
 *
 * ─── STALE IS NOT MISSING, AND CONFLICTING IS NEITHER ─────────────────────
 * Three different states with three different correct actions: a missing field
 * needs a first observation, a stale field needs a re-observation, and a
 * conflicting field needs a human or a better source — never an overwrite.
 * Collapsing them would make the planner request the wrong work, and would
 * quietly resolve conflicts by whichever provider answered last.
 */

import {
  getDataSourceDefinition,
  resolveDataSourceStatus,
  type DataSourceStatus,
  type TenantIntegrationRow,
} from '../integrations/dataSourceCatalogue';

/** Bumped when planning rules change, so a plan traces to the logic that made it. */
export const ENRICHMENT_PLANNER_VERSION = 'ws2.1';

/** Default staleness horizon. Injected per call; this is only the fallback. */
export const DEFAULT_STALENESS_DAYS = 90;

// ── Field state ─────────────────────────────────────────────────────────────

/**
 * What we currently know about one attribute.
 *
 * `conflicting` is deliberately a first-class state rather than a flavour of
 * `missing`: LI-2 withheld a value because sources disagreed, which means we
 * have MORE evidence than for a missing field, not less — and the correct next
 * step is different.
 */
export const FIELD_STATES = ['known', 'missing', 'stale', 'conflicting'] as const;
export type FieldState = typeof FIELD_STATES[number];

/** What the planner decided to do about one field. */
export const FIELD_ACTIONS = ['skip', 'enrich', 'no_available_source', 'needs_resolution'] as const;
export type FieldAction = typeof FIELD_ACTIONS[number];

/**
 * Cost of using a source.
 *
 * `unknown` is NOT zero, and the type makes it impossible to add them by
 * accident: there is no numeric field to read on an unknown cost. A planner
 * that treated unknown as free would prefer an unpriced paid provider over a
 * free internal one on every call.
 */
export type SourceCost =
  | { readonly kind: 'free' }
  | { readonly kind: 'known'; readonly amount: number; readonly currency: string }
  | { readonly kind: 'unknown' };

export const FREE: SourceCost = { kind: 'free' };
export const UNKNOWN_COST: SourceCost = { kind: 'unknown' };

/** One attribute as the caller currently holds it. */
export interface FieldObservation {
  /** Canonical attribute name, from the existing person/account surfaces. */
  readonly attribute: string;
  readonly subject: 'person' | 'account';
  /** The current canonical value. `null`/`undefined` means never observed. */
  readonly value?: unknown;
  /** When it was observed. Absent on a known value means freshness is unknown. */
  readonly observedAt?: string | null;
  /**
   * True when LI-2 withheld this attribute with `sources_disagree`. The caller
   * passes LI-2's own verdict; the planner does not re-derive it.
   */
  readonly sourcesDisagree?: boolean;
}

/**
 * Which sources could answer which attributes, as the CALLER establishes it.
 *
 * The planner does not guess coverage. Internal intelligence and MarketPulse
 * are named separately because the frozen policy prefers them in that order,
 * and because MarketPulse is reused through its own seam (C-1) rather than
 * copied into a PI store.
 */
export interface SourceCoverage {
  /** Attributes existing canonical/internal intelligence can already answer. */
  readonly internal?: readonly string[];
  /** Attributes MarketPulse can answer, via its existing seam. */
  readonly marketPulse?: readonly string[];
  /** Attributes a configured external source could answer, keyed by source. */
  readonly external?: Readonly<Record<string, readonly string[]>>;
  /**
   * A3Z — external source keys the CALLER has already proven executable.
   *
   * ─── WHY THE CATALOGUE ALONE CANNOT ANSWER THIS ──────────────────────────
   * `resolveDataSourceStatus` derives connection from `company_integrations`,
   * which is the admin integrations hub. A PI enrichment provider is connected
   * by a TENANT PROVIDER CREDENTIAL (A3M, `integration_credentials.provider_key`)
   * and needs a registered adapter besides — neither of which the catalogue
   * knows about. So a provider that is genuinely callable can be entirely
   * absent from the catalogue, as Clearbit was, and the planner would report
   * `unknown_source` for the one source that actually works.
   *
   * A key listed here is treated as `connected` INSTEAD of being re-derived
   * from the catalogue. That is not a weaker check: the caller establishes it
   * from A3's own `evaluateSource`, which tests adapter, tenant credential,
   * entity support, attribute support and funding model — strictly more than
   * the catalogue tests. The planner still performs no I/O and still learns
   * nothing about adapters; it consumes a verdict from the layer that owns it,
   * exactly as it already consumes `external` attribute coverage on trust.
   *
   * Absent ⇒ empty ⇒ the catalogue path is the only path. Fails closed.
   */
  readonly verifiedExternal?: readonly string[];
}

export interface EnrichmentPlanInput {
  readonly organizationId: string;
  readonly prospectId: string;
  readonly fields: readonly FieldObservation[];
  /** Attributes the next action cannot proceed without. */
  readonly requiredForNextAction?: readonly string[];
  /** Tenant's own integration rows — the ONLY basis for availability. */
  readonly integrations?: readonly TenantIntegrationRow[];
  /** Known per-source cost, keyed by source. Absent means unknown, never free. */
  readonly costs?: Readonly<Record<string, { amount: number; currency: string }>>;
  readonly coverage?: SourceCoverage;
  readonly stalenessDays?: number;
  /** Injected. The ONLY source of "now". */
  readonly now: string;
}

export interface PlannedField {
  readonly attribute: string;
  readonly subject: 'person' | 'account';
  readonly state: FieldState;
  readonly requiredForNextAction: boolean;
  readonly action: FieldAction;
  /** The chosen source key, or null when none can serve this field. */
  readonly source: string | null;
  /** `internal` and `market_pulse` are internal seams, not catalogue entries. */
  readonly sourceStatus: DataSourceStatus | 'internal' | 'market_pulse' | null;
  readonly cost: SourceCost;
  readonly reason: string;
}

export interface EnrichmentPlan {
  readonly organizationId: string;
  readonly prospectId: string;
  readonly version: string;
  readonly generatedAt: string;
  readonly fields: readonly PlannedField[];
  /** Fields whose action is `enrich`, required-for-next-action first. */
  readonly toEnrich: readonly PlannedField[];
  readonly counts: Readonly<Record<FieldState, number>>;
  /** True when nothing is worth enriching. A valid, common outcome. */
  readonly empty: boolean;
}

const asMs = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string' || iso.trim() === '') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const hasValue = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

/**
 * Classify one field.
 *
 * Order matters and is not arbitrary. A disagreement is checked FIRST: a field
 * where sources conflict may also hold a value and a recent timestamp, and
 * reporting that as `known` would bury the conflict under the appearance of
 * good data.
 */
export function classifyField(field: FieldObservation, now: string, stalenessDays: number): FieldState {
  if (field.sourcesDisagree === true) return 'conflicting';
  if (!hasValue(field.value)) return 'missing';

  const observed = asMs(field.observedAt);
  const nowMs = asMs(now);
  // A known value with no usable timestamp is STALE, not fresh. We cannot show
  // it is current, and assuming currency is how stale data is acted on.
  if (observed === null || nowMs === null) return 'stale';

  const ageDays = (nowMs - observed) / 86_400_000;
  return ageDays > stalenessDays ? 'stale' : 'known';
}

/**
 * Pick a source for one attribute, in the frozen preference order:
 * internal canonical/intelligence → MarketPulse → a configured external source.
 *
 * Among external candidates the cheapest KNOWN cost wins; an unknown cost never
 * outranks a known one, because "unpriced" is not "cheap".
 */
function selectSource(
  attribute: string,
  input: EnrichmentPlanInput,
): { source: string | null; status: PlannedField['sourceStatus']; cost: SourceCost; reason: string } {
  const coverage = input.coverage ?? {};

  if ((coverage.internal ?? []).includes(attribute)) {
    return { source: 'internal', status: 'internal', cost: FREE,
      reason: 'existing canonical/internal intelligence can answer this without an external call' };
  }
  if ((coverage.marketPulse ?? []).includes(attribute)) {
    return { source: 'market_pulse', status: 'market_pulse', cost: FREE,
      reason: 'MarketPulse can answer this through its existing seam (C-1)' };
  }

  const rows = input.integrations ?? [];
  const candidates: Array<{ key: string; status: DataSourceStatus; cost: SourceCost }> = [];
  const unavailable: string[] = [];

  const verified = new Set(coverage.verifiedExternal ?? []);

  for (const [key, attrs] of Object.entries(coverage.external ?? {})) {
    if (!attrs.includes(attribute)) continue;
    const priced = input.costs?.[key];
    const cost: SourceCost = priced ? { kind: 'known', ...priced } : UNKNOWN_COST;

    // A3Z: a caller-verified source is already known connected by the layer
    // that owns PI provider connection. Re-deriving it from the admin
    // catalogue would ask a different, weaker question of a different table.
    if (verified.has(key)) { candidates.push({ key, status: 'connected', cost }); continue; }

    const definition = getDataSourceDefinition(key);
    if (!definition) { unavailable.push(`${key}:unknown_source`); continue; }

    const { status } = resolveDataSourceStatus(definition, rows);
    if (status !== 'connected') { unavailable.push(`${key}:${status}`); continue; }

    candidates.push({ key, status, cost });
  }

  if (candidates.length === 0) {
    return { source: null, status: null, cost: UNKNOWN_COST,
      reason: unavailable.length
        ? `no connected source can supply this attribute (${unavailable.join(', ')})`
        : 'no source declares coverage for this attribute' };
  }

  // Cheapest KNOWN cost first; unknown-cost sources sort last among candidates.
  candidates.sort((a, b) => {
    const av = a.cost.kind === 'known' ? a.cost.amount : Number.POSITIVE_INFINITY;
    const bv = b.cost.kind === 'known' ? b.cost.amount : Number.POSITIVE_INFINITY;
    return av === bv ? a.key.localeCompare(b.key) : av - bv;
  });

  const chosen = candidates[0];
  return { source: chosen.key, status: chosen.status, cost: chosen.cost,
    reason: chosen.cost.kind === 'known'
      ? 'cheapest connected source with a known cost'
      : 'the only connected source; its cost is UNKNOWN, which is not the same as free' };
}

/**
 * Build the plan.
 *
 * Deterministic and total: every input field appears in the output exactly
 * once, with a state, an action and a reason. Nothing is silently dropped —
 * a field the planner declines to enrich is reported as declined, with why.
 */
export function planEnrichment(input: EnrichmentPlanInput): EnrichmentPlan {
  if (!input.organizationId?.trim()) throw new Error('organizationId is required to plan enrichment');
  if (!input.prospectId?.trim()) throw new Error('prospectId is required to plan enrichment');

  const stalenessDays = typeof input.stalenessDays === 'number' && input.stalenessDays >= 0
    ? input.stalenessDays : DEFAULT_STALENESS_DAYS;
  const required = new Set(input.requiredForNextAction ?? []);

  const fields: PlannedField[] = input.fields.map((field) => {
    const state = classifyField(field, input.now, stalenessDays);
    const requiredForNextAction = required.has(field.attribute);
    const base = { attribute: field.attribute, subject: field.subject, state, requiredForNextAction };

    // A fresh known value is left alone. Re-enriching it would spend money and
    // provider quota to re-learn what the platform already knows.
    if (state === 'known') {
      return { ...base, action: 'skip' as const, source: null, sourceStatus: null, cost: FREE,
        reason: 'already known and fresh — re-enriching would re-buy what we have' };
    }

    // A conflict is not fixed by fetching again from the same kind of source.
    // LI-2 already withheld it; resolution is a human or an authoritative
    // source decision, and the planner refuses to launder it into an overwrite.
    if (state === 'conflicting') {
      return { ...base, action: 'needs_resolution' as const, source: null, sourceStatus: null, cost: FREE,
        reason: 'sources disagree (LI-2 RULE B withheld it) — enrichment would overwrite a conflict, not resolve it' };
    }

    const picked = selectSource(field.attribute, input);
    if (!picked.source) {
      return { ...base, action: 'no_available_source' as const, source: null, sourceStatus: null,
        cost: UNKNOWN_COST, reason: picked.reason };
    }
    return { ...base, action: 'enrich' as const, source: picked.source,
      sourceStatus: picked.status, cost: picked.cost, reason: picked.reason };
  });

  const counts = FIELD_STATES.reduce((acc, s) => {
    acc[s] = fields.filter((f) => f.state === s).length;
    return acc;
  }, {} as Record<FieldState, number>);

  // Required-for-next-action first; then free before priced before unpriced, so
  // the cheapest useful work is offered first without inventing a score.
  const rank = (c: SourceCost): number => (c.kind === 'free' ? 0 : c.kind === 'known' ? 1 : 2);
  const toEnrich = fields
    .filter((f) => f.action === 'enrich')
    .slice()
    .sort((a, b) => {
      if (a.requiredForNextAction !== b.requiredForNextAction) return a.requiredForNextAction ? -1 : 1;
      const r = rank(a.cost) - rank(b.cost);
      if (r !== 0) return r;
      return a.attribute.localeCompare(b.attribute);
    });

  return {
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    version: ENRICHMENT_PLANNER_VERSION,
    generatedAt: input.now,
    fields,
    toEnrich,
    counts,
    empty: toEnrich.length === 0,
  };
}
