/**
 * WS-2 follow-up — the enrichment orchestration seam.
 *
 * `planner.ts` is pure and needs a context nobody was building: field
 * observations, source coverage and a staleness policy. That is why WS-4
 * declined to call it — a blind call would have invented an orchestration
 * shape. This module is that context, expressed once, so WS-4 can consume a
 * defined contract instead of inventing semantics.
 *
 * ─── PORTS, NOT A SECOND DATA-ACCESS LAYER ────────────────────────────────
 * Reads arrive through an injected port, the convention
 * `IntelligencePersistencePort` already established. The default port is the
 * only place a table is named, so the seam is testable without a database and
 * adds no competing repository. Nothing here writes: persistence is LI-2's
 * `ingestSourceRecord`, reached through `applyEnrichmentResult` below.
 *
 * ─── THE TENANT IS AN ARGUMENT, NEVER AN AMBIENT ──────────────────────────
 * Every port takes `organizationId` explicitly and the seam refuses to run
 * without one. There is no active-org inference, for the reason
 * BILLING-ACTIVE-ORG-AUTHZ-SEC-001 established: a context pointer is not a
 * credential.
 *
 * ─── IT ADDS NO POLICY OF ITS OWN ─────────────────────────────────────────
 * Freshness comes from `attributes_updated_at`, which LI-2 already stamps.
 * Conflict is LI-2's `sources_disagree`, supplied by the port rather than
 * re-derived. Availability is `dataSourceCatalogue`. Cost is WS-2's
 * `SourceCost`. Classification is `planner.ts`. This module sequences them.
 */

import {
  ACCOUNT_ATTRIBUTE_COLUMNS,
  PERSON_ATTRIBUTE_COLUMNS,
} from '../prospectIdentity/attributes';
import type { TenantIntegrationRow } from '../integrations/dataSourceCatalogue';
import {
  planEnrichment,
  DEFAULT_STALENESS_DAYS,
  type EnrichmentPlan,
  type FieldObservation,
  type SourceCoverage,
} from './planner';
import {
  normalizeEnrichmentResult,
  markConflicting,
  type EnrichmentAttemptInput,
  type EnrichmentResult,
} from './result';

export const ENRICHMENT_SEAM_VERSION = 'ws2.2';

/** Attributes that carry provenance rather than a fact, and are never planned. */
const NON_ENRICHABLE = new Set(['attributes_source', 'attributes_updated_at']);

const enrichable = (columns: readonly string[]): string[] =>
  columns.filter((c) => !NON_ENRICHABLE.has(c));

/** The canonical rows as the port hands them back — column names, verbatim. */
export interface ProspectSnapshot {
  readonly personId: string | null;
  readonly accountId: string | null;
  /** `unified_persons` row, or null when the Prospect has no person yet. */
  readonly person: Readonly<Record<string, unknown>> | null;
  /** `prospect_accounts` row, or null when no employer resolved. */
  readonly account: Readonly<Record<string, unknown>> | null;
}

/** One attribute LI-2 withheld because sources disagreed. */
export interface ConflictedAttribute {
  readonly attribute: string;
  readonly subject: 'person' | 'account';
}

/**
 * Everything the seam reads. One port, so there is exactly one place that
 * knows a table name and exactly one thing to stub in a test.
 */
export interface EnrichmentPorts {
  loadSnapshot(organizationId: string, prospectId: string): Promise<ProspectSnapshot | null>;
  loadIntegrations(organizationId: string): Promise<readonly TenantIntegrationRow[]>;
  /** LI-2's verdict. Supplied, never re-derived here. */
  loadConflicts(organizationId: string, snapshot: ProspectSnapshot): Promise<readonly ConflictedAttribute[]>;
  /** Hands an enrichment payload to LI-2. The ONLY write in this seam. */
  persist(input: {
    organizationId: string;
    provider: string;
    entityType: 'person' | 'account';
    sourceRecordId: string;
    personId: string | null;
    accountId: string | null;
    attributes: Record<string, unknown>;
    observedAt: string | null;
  }): Promise<{ canonicalWithheld: readonly { attribute: string; reason: string }[] }>;
}

export interface PlanProspectInput {
  readonly organizationId: string;
  readonly prospectId: string;
  /** Attributes the next action cannot proceed without. */
  readonly requiredForNextAction?: readonly string[];
  /** Which sources can answer what. Supplied by the caller — never guessed. */
  readonly coverage?: SourceCoverage;
  readonly costs?: Readonly<Record<string, { amount: number; currency: string }>>;
  /** Caller-supplied policy. Falls back to the planner's documented default. */
  readonly stalenessDays?: number;
  /** Injected. The only source of "now". */
  readonly now: string;
}

/**
 * Turn a canonical row into observations the planner can classify.
 *
 * `attributes_updated_at` is the freshness signal LI-2 already stamps. When a
 * row has none, every attribute on it is reported with no `observedAt`, which
 * the planner treats as STALE — not fresh — because currency cannot be shown.
 * That is the planner's existing rule, consumed rather than duplicated.
 */
function observationsFor(
  row: Readonly<Record<string, unknown>> | null,
  subject: 'person' | 'account',
  columns: readonly string[],
  conflicts: readonly ConflictedAttribute[],
): FieldObservation[] {
  const observedAt = row ? (row.attributes_updated_at as string | null) ?? null : null;
  const disagreed = new Set(
    conflicts.filter((c) => c.subject === subject).map((c) => c.attribute),
  );
  return enrichable(columns).map((attribute) => ({
    attribute,
    subject,
    // A missing row is not an error: a Prospect legitimately has no employer
    // yet, and every account attribute is then simply MISSING.
    value: row ? row[attribute] : null,
    observedAt,
    sourcesDisagree: disagreed.has(attribute),
  }));
}

/**
 * Build the planner context and plan.
 *
 * Returns the plan plus the snapshot it was built from, so a caller can act on
 * the plan without a second read and without re-deriving which person or
 * account it concerns.
 */
export async function planProspectEnrichment(
  input: PlanProspectInput,
  ports: EnrichmentPorts,
): Promise<{ plan: EnrichmentPlan; snapshot: ProspectSnapshot }> {
  if (!input.organizationId?.trim()) throw new Error('organizationId is required to plan enrichment');
  if (!input.prospectId?.trim()) throw new Error('prospectId is required to plan enrichment');

  const snapshot = await ports.loadSnapshot(input.organizationId, input.prospectId);
  if (!snapshot) {
    // NOT "no enrichment available". A Prospect that cannot be read in this
    // tenant is an identity/authorisation fact, and collapsing it into an empty
    // plan would hide a cross-tenant attempt behind a normal-looking answer.
    throw new Error(`prospect ${input.prospectId} not found in tenant ${input.organizationId}`);
  }

  const [integrations, conflicts] = await Promise.all([
    ports.loadIntegrations(input.organizationId),
    ports.loadConflicts(input.organizationId, snapshot),
  ]);

  const fields: FieldObservation[] = [
    ...observationsFor(snapshot.person, 'person', PERSON_ATTRIBUTE_COLUMNS, conflicts),
    ...observationsFor(snapshot.account, 'account', ACCOUNT_ATTRIBUTE_COLUMNS, conflicts),
  ];

  const plan = planEnrichment({
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    fields,
    requiredForNextAction: input.requiredForNextAction,
    integrations,
    costs: input.costs,
    coverage: input.coverage,
    stalenessDays: input.stalenessDays ?? DEFAULT_STALENESS_DAYS,
    now: input.now,
  });

  return { plan, snapshot };
}

/**
 * Record what a source returned, and let LI-2 decide what becomes canonical.
 *
 * The sequence is deliberate and is the whole reason this function exists:
 *
 *   normalize  → only usable returned values survive
 *   persist    → LI-2 applies RULE A/B/C; nothing else may write
 *   re-stamp   → if LI-2 withheld on `sources_disagree`, the result becomes
 *                `conflicting` and its payload is cleared
 *
 * A failed, unavailable or sourceless attempt never reaches `persist` at all,
 * because `normalizeEnrichmentResult` has already emptied `apply`. That is what
 * makes "enrichment failed" incapable of erasing a value we already held.
 */
export async function applyEnrichmentResult(
  attempt: EnrichmentAttemptInput,
  snapshot: ProspectSnapshot,
  ports: EnrichmentPorts,
): Promise<EnrichmentResult> {
  if (!attempt.organizationId?.trim()) throw new Error('organizationId is required to apply an enrichment result');

  const result = normalizeEnrichmentResult(attempt);

  const passes: Array<{ entityType: 'person' | 'account'; attributes: Record<string, unknown> }> = [];
  if (Object.keys(result.apply.person).length > 0 && snapshot.personId) {
    passes.push({ entityType: 'person', attributes: { ...result.apply.person } });
  }
  if (Object.keys(result.apply.account).length > 0 && snapshot.accountId) {
    passes.push({ entityType: 'account', attributes: { ...result.apply.account } });
  }
  if (passes.length === 0) return result;   // nothing to write; nothing to lose

  const withheld: Array<{ attribute: string; reason: string }> = [];
  for (const pass of passes) {
    const persisted = await ports.persist({
      organizationId: attempt.organizationId,
      provider: result.source ?? 'unknown',
      entityType: pass.entityType,
      // Provenance stays the source's own record id, so the evidence remains
      // attributable to the observation that produced it.
      sourceRecordId: attempt.prospectId,
      personId: snapshot.personId,
      accountId: snapshot.accountId,
      attributes: pass.attributes,
      observedAt: result.provenance[0]?.observedAt ?? null,
    });
    withheld.push(...persisted.canonicalWithheld);
  }

  return markConflicting(result, withheld);
}
