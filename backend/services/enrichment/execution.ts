/**
 * A4B — the plan → recorded execution seam.
 *
 * The A4 audit found two complete halves that never touched. `planner.ts` +
 * `service.ts` decide WHAT is worth enriching and have two real production
 * callers. `execute.ts` + `recordedExecution.ts` know HOW to enrich and record
 * it, and had ZERO callers. Nothing in the repository turned a planned field
 * into an attempt, so the executor's safety properties protected a path nobody
 * could reach.
 *
 * This module is that path, and deliberately nothing more.
 *
 * ─── IT DECIDES NOTHING THE OTHER LAYERS ALREADY DECIDE ───────────────────
 * It classifies no field (planner), selects no source by its own rules
 * (`selectAcquisitionSource`), resolves no credential (`resolveCredential`),
 * authorises no spend (`authorizeCost`), suppresses no duplicate
 * (`findRecentObservation`), persists nothing (LI-2 through
 * `persistObservation`) and records no attempt itself (A4A). It translates one
 * `PlannedField` into one `EnrichmentRequest`, hands it to the existing
 * recorded executor, and translates the answer back. Every refusal below
 * happens BEFORE that hand-off and therefore costs nothing.
 *
 * ─── WHY IT DOES NOT CALL `applyEnrichmentResult` ─────────────────────────
 * `service.ts` exposes `applyEnrichmentResult`, which persists through LI-2 as
 * well. It belongs to the WS-2 lineage, which predates the A3 executor and
 * assumed the caller had already obtained a provider payload itself. Calling
 * both would write the same observation twice under two different provenance
 * shapes. `executeEnrichment` already persists, so this seam persists nothing
 * and `applyEnrichmentResult` stays where it is — a second write path is
 * exactly what PI's one-persistence-path rule forbids.
 *
 * ─── EVERY REFUSAL KEEPS ITS OWN NAME ─────────────────────────────────────
 * A plan item can fail to execute for reasons that are not provider outcomes at
 * all: the planner chose an internal seam, the Prospect has no employer row,
 * the canonical entity is merged. Collapsing those into `provider_unavailable`
 * would report a provider failure that never happened. So refusals carry
 * `PlanRefusal` and provider answers carry `EnrichmentOutcome`, and the two
 * vocabularies never merge.
 *
 * ─── NO SCHEDULER ─────────────────────────────────────────────────────────
 * One call executes exactly one planned field. There is no loop over
 * `plan.toEnrich`, no timer, no queue and no trigger. When to run this, how
 * often, and whether to retry are A4C's decisions and are deliberately absent —
 * a default cadence invented here would become the policy by accident.
 */

import { randomUUID } from 'crypto';
import type { EnrichmentPlan, PlannedField } from './planner';
import type { ProspectSnapshot } from './service';
import {
  executeEnrichmentRecorded,
  type AttemptRecorder,
} from './recordedExecution';
import type { ExecuteEnrichmentPorts } from './providers/execute';
import type {
  EnrichmentOutcome, EnrichmentProviderAdapter, EnrichmentRequest, EnrichmentSubject,
} from './providers/contract';
import {
  selectAcquisitionSource,
  type IneligibilityReason, type SelectionMode, type SelectionOutcome,
} from './providers/selection';
import type { SourceStatus } from './providers/sources';

/** Bumped when the seam's translation rules change. */
export const PLAN_EXECUTION_VERSION = 'a4b.1';

/**
 * Why a planned field never reached the executor.
 *
 * Distinct from `EnrichmentOutcome`, which describes what a PROVIDER answered.
 * Everything here happens before any provider is contacted, so none of it is
 * ever billable and none of it is evidence about the prospect.
 */
export const PLAN_REFUSALS = [
  'not_executable',    // the planner did not mark this field for enrichment
  'internal_source',   // planner chose an internal seam; no provider call exists
  'entity_missing',    // the Prospect has no canonical row for this subject
  'entity_not_active', // the canonical row is merged/suppressed/archived
  'source_ineligible', // A3 selection refused this source
  'selector_missing',  // no canonical identity a provider could search on
] as const;
export type PlanRefusal = typeof PLAN_REFUSALS[number];

/**
 * The canonical statuses an entity may be enriched from.
 *
 * This is the EXISTING `unified_persons`/`prospect_accounts` status vocabulary
 * (`active | merged | suppressed | archived`), consumed rather than extended.
 * Enriching a merged row would attach evidence to an identity that has been
 * superseded; enriching an archived or suppressed one would spend the tenant's
 * provider quota on a record they have taken out of use.
 *
 * NOTE ON SCOPE: this is canonical-entity VALIDITY, not contact suppression.
 * `contactGovernance` (DNC) governs whether a person may be CONTACTED and is
 * still not connected to enrichment anywhere in the repository — A4B does not
 * connect it, because inventing "DNC also blocks enrichment" would be a new
 * product policy, not a wiring fix. That gap is reported, not closed here.
 */
export const ENRICHABLE_ENTITY_STATUSES: readonly string[] = ['active'];

export interface PlanFieldExecution {
  /** True only when the request reached the executor. */
  readonly executed: boolean;
  readonly attribute: string;
  readonly subject: EnrichmentSubject;
  readonly organizationId: string;
  readonly prospectId: string;
  readonly entityId: string | null;
  readonly providerId: string | null;
  /** The provider's answer. Null whenever `refusal` is set. */
  readonly outcome: EnrichmentOutcome | null;
  /** Why we never asked. Null whenever `outcome` is set. */
  readonly refusal: PlanRefusal | null;
  /** A3's own selection vocabulary, preserved verbatim. */
  readonly ineligibility: IneligibilityReason | null;
  readonly providerCalled: boolean;
  readonly attemptId: string | null;
  readonly attemptNumber: number | null;
  readonly sourceRecordId: string | null;
  readonly canonicalWithheld: readonly { attribute: string; reason: string }[];
  readonly reason: string;
  readonly correlationId: string;
  readonly version: string;
}

export interface ExecutePlannedFieldInput {
  /** The plan the field came from — the ONLY source of tenant and prospect. */
  readonly plan: EnrichmentPlan;
  readonly field: PlannedField;
  /** The snapshot the plan was built from, so identity is not re-derived. */
  readonly snapshot: ProspectSnapshot;
  /**
   * Live source states, from `listSourceStatus`. Required: the tenant's
   * credential presence is a question this module has no way to answer, and
   * defaulting it would re-create the A3V defect where a source reported
   * `connected` on the strength of Omnivyra's environment.
   */
  readonly statuses: readonly SourceStatus[];
  /**
   * Override the source. Omitted means the PLANNER's own choice is used, which
   * is the normal case and is always explicit — never `auto` by default, so a
   * plan can never be executed against a source it did not name.
   */
  readonly mode?: SelectionMode;
  readonly purpose?: string;
  /**
   * Correlates plan → attempt → observation. An identifier, not a fact:
   * generating one is not fabricating evidence. Supply it to join a run.
   */
  readonly correlationId?: string;
  readonly freshnessDays?: number;
  /** Test seam, passed straight through to the executor. */
  readonly adapter?: EnrichmentProviderAdapter;
  readonly recorder?: AttemptRecorder;
  /**
   * A4J (B1) — refuse provider transport unless the attempt was recorded.
   *
   * Passed straight through to the recorder. Defaults to false, preserving the
   * existing user-initiated behaviour; an automated caller sets it so that a
   * lost attempt row can never become an unrecorded paid call.
   */
  readonly requireAttemptRecord?: boolean;
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/**
 * The identity a provider could search on, taken from canonical columns only.
 *
 * Every key is a verbatim canonical column, never a derivation: an account's
 * `domain` is `domain_normalized` as LI-2 wrote it, and a person's `email` is
 * `primary_email`. Nothing is composed, inferred or borrowed from a related
 * row — handing a provider the EMPLOYER's domain as though it identified the
 * PERSON is precisely the kind of quiet substitution that produces evidence
 * attributed to the wrong entity.
 *
 * An empty bag is a real answer: we hold nothing a provider could look up.
 */
export function canonicalSelectors(
  subject: EnrichmentSubject,
  row: Readonly<Record<string, unknown>> | null,
): Record<string, string> {
  if (!row) return {};
  const out: Record<string, string> = {};
  const put = (key: string, value: unknown): void => {
    const v = text(value);
    if (v) out[key] = v;
  };
  if (subject === 'account') {
    put('domain', row.domain_normalized);
    put('name', row.name);
    put('website', row.website_url);
  } else {
    put('email', row.primary_email);
    put('name', row.full_name);
  }
  return out;
}

const refusal = (
  input: ExecutePlannedFieldInput, entityId: string | null, providerId: string | null,
  kind: PlanRefusal, reason: string, correlationId: string,
  ineligibility: IneligibilityReason | null = null,
): PlanFieldExecution => ({
  executed: false,
  attribute: input.field.attribute,
  subject: input.field.subject,
  organizationId: input.plan.organizationId,
  prospectId: input.plan.prospectId,
  entityId,
  providerId,
  outcome: null,
  refusal: kind,
  ineligibility,
  providerCalled: false,
  attemptId: null,
  attemptNumber: null,
  sourceRecordId: null,
  canonicalWithheld: [],
  reason,
  correlationId,
  version: PLAN_EXECUTION_VERSION,
});

/**
 * Execute exactly one planned field.
 *
 * The order of the checks is the safety property, and it mirrors the
 * executor's own: everything that can refuse for free refuses first, and the
 * hand-off to `executeEnrichmentRecorded` is the last thing that happens.
 */
export async function executePlannedField(
  input: ExecutePlannedFieldInput,
  ports: ExecuteEnrichmentPorts,
): Promise<PlanFieldExecution> {
  const { plan, field, snapshot } = input;
  const correlationId = text(input.correlationId) ?? randomUUID();
  const no = (
    kind: PlanRefusal, reason: string, entityId: string | null = null,
    providerId: string | null = null, ineligibility: IneligibilityReason | null = null,
  ) => refusal(input, entityId, providerId, kind, reason, correlationId, ineligibility);

  // ── is this field even work? ─────────────────────────────────────────────
  // The planner's own verdict, quoted rather than re-derived. `skip`,
  // `needs_resolution` and `no_available_source` are correct plan outcomes,
  // not errors — and `needs_resolution` in particular must never be executed:
  // LI-2 withheld the value because sources disagreed, and fetching again
  // would launder the conflict into an overwrite.
  if (field.action !== 'enrich') {
    return no('not_executable',
      `the planner did not mark this field for enrichment (${field.action}): ${field.reason}`);
  }
  const planSource = text(field.source);
  if (!planSource) {
    return no('not_executable', 'the planned field names no source');
  }

  // ── internal seams are not providers ─────────────────────────────────────
  // `internal` and `market_pulse` mean "we can answer this without an external
  // call". There is no adapter to reach and nothing to record an attempt
  // against; routing them here would fabricate a provider interaction.
  if (field.sourceStatus === 'internal' || field.sourceStatus === 'market_pulse') {
    return no('internal_source',
      `'${planSource}' is an internal seam, not an external provider — it is not executed through the provider path`);
  }

  // ── canonical entity ─────────────────────────────────────────────────────
  const entityId = field.subject === 'person' ? snapshot.personId : snapshot.accountId;
  const row = field.subject === 'person' ? snapshot.person : snapshot.account;
  if (!text(entityId)) {
    return no('entity_missing', `this prospect has no canonical ${field.subject} to enrich`);
  }
  // A row we cannot read the status of is not proven enrichable. Absence is
  // not intelligence, so an unreadable status refuses rather than assumes.
  const status = text(row?.status);
  if (!status || !ENRICHABLE_ENTITY_STATUSES.includes(status)) {
    return no('entity_not_active',
      `canonical ${field.subject} ${entityId} has status '${status ?? 'unreadable'}' — `
      + `only ${ENRICHABLE_ENTITY_STATUSES.join(', ')} may be enriched`,
      entityId);
  }

  // ── source selection, through the existing A3 machinery ──────────────────
  // The planner's choice is passed as an EXPLICIT mode, so A3C's rule holds:
  // an explicit source is never substituted. When it is ineligible the answer
  // is why, under A3's own vocabulary, and no other source is tried.
  const selection: SelectionOutcome = selectAcquisitionSource(
    { subject: field.subject, attributes: [field.attribute], mode: input.mode ?? planSource },
    input.statuses,
  );
  // `'ineligibility' in selection`, not `!selection.selected`: the root
  // tsconfig sets `strict: false`, which disables union narrowing on a negated
  // discriminant. Same reason `execute.ts` writes `'reason' in decision`.
  if ('ineligibility' in selection) {
    return no('source_ineligible', selection.reason, entityId, planSource, selection.ineligibility);
  }
  const providerId = selection.sourceId;

  // ── something to search on ───────────────────────────────────────────────
  const selectors = canonicalSelectors(field.subject, row);
  if (Object.keys(selectors).length === 0) {
    return no('selector_missing',
      `no canonical identity is held for ${field.subject} ${entityId} that a provider could search on`,
      entityId, providerId);
  }

  // ── hand off; everything downstream is already-frozen machinery ───────────
  const request: EnrichmentRequest = {
    organizationId: plan.organizationId,
    subject: field.subject,
    entityId: entityId as string,
    attributes: [field.attribute],
    selectors,
    purpose: text(input.purpose)
      ?? `enrichment plan ${plan.version}: ${field.state} ${field.subject}.${field.attribute}`,
    correlationId,
  };

  const recorded = await executeEnrichmentRecorded(request, providerId, ports, {
    freshnessDays: input.freshnessDays,
    adapter: input.adapter,
    recorder: input.recorder,
    requireAttemptRecord: input.requireAttemptRecord,
  });
  const { result } = recorded;

  return {
    executed: true,
    attribute: field.attribute,
    subject: field.subject,
    organizationId: plan.organizationId,
    prospectId: plan.prospectId,
    entityId: entityId as string,
    providerId: result.providerId ?? providerId,
    // The provider's own answer, preserved. Never rewritten into a refusal.
    outcome: result.outcome,
    refusal: null,
    ineligibility: null,
    providerCalled: result.providerCalled,
    attemptId: recorded.attemptId,
    attemptNumber: recorded.attemptNumber,
    sourceRecordId: result.sourceRecordId,
    canonicalWithheld: result.canonicalWithheld,
    reason: result.reason,
    correlationId: result.correlationId,
    version: PLAN_EXECUTION_VERSION,
  };
}
