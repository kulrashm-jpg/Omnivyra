/**
 * B3 — the outcome → PI lifecycle PRODUCER.
 *
 * THE ONE THING THAT WAS MISSING. Everything either side of this file already
 * existed and is ratified:
 *
 *   outreach_outcomes          the authoritative outcome store, with TWO live
 *                              write paths (the SES webhook via ENG-003, and
 *                              the operator route PI-P1-W09D)
 *   interpretOutcome           the ratified outcome -> lifecycle mapping
 *   recordProspectTransition   the sole lifecycle writer, append-only, with
 *                              legal-transition validation and its own
 *                              duplicate suppression
 *   readCurrentProspectState   the state reader
 *
 * The D22 audit's finding was that nothing joined them: `recordProspectTransition`
 * had no caller outside its own module, so an outcome could be recorded for ever
 * without the lifecycle hearing about it. This module is that join and nothing
 * more.
 *
 * ─── IT DECIDES NOTHING ────────────────────────────────────────────────────
 * No mapping lives here. Which outcome means what is `interpretOutcome`'s, and
 * whether a transition is legal is the writer's. This file resolves identity,
 * asks, and reports. If it ever starts containing a `to:` or an `origin:` of its
 * own, that is a second lifecycle authority and the thing to delete.
 *
 * ─── ONE OUTCOME, SUPPLIED BY THE CALLER ───────────────────────────────────
 * The caller names the outcome. It is NOT a sweep that reads a corpus and picks,
 * because `outcomeInterpreter` states the reason plainly: "Folding a whole corpus
 * into one conclusion needs a precedence and recency policy that nobody has
 * decided, and inventing one here would hide it." Choosing "the latest" would be
 * exactly that invention, so the shape of this producer follows the shape of the
 * decision that has actually been taken.
 *
 * ─── WHAT IS PRODUCIBLE, AND WHAT IS NOT ───────────────────────────────────
 * From the ratified map, by origin rather than by preference:
 *
 *   replied      -> engaged               origin derived     PRODUCIBLE
 *   unsubscribed -> closed_disqualified   origin derived     PRODUCIBLE
 *   no_response  -> nurture               origin derived     PRODUCIBLE when the
 *                                                            interpreter's own
 *                                                            condition holds
 *   rejected     -> not_interested        origin HUMAN       only with an actor
 *   converted                             needs-policy       refused, loudly
 *   meeting_booked                        unreachable        refused
 *   opened / clicked / complaint          not-lifecycle-bearing
 *   delivered / bounced                   not business outcomes at all — they
 *                                          live on the DELIVERY axis and are
 *                                          outside `BusinessOutcomeType`
 *
 * A `human` proposal is deliberately unwritable without an actor: the writer
 * refuses it, and `outreach_outcomes` carries no actor column. So `rejected`
 * produces a transition only when a caller that HAS an authenticated operator
 * supplies one. That friction is the design, not a gap to route around.
 *
 * ─── TENANT, AND FAILING CLOSED ────────────────────────────────────────────
 * Every read names the tenant. The one genuinely ambiguous step is person ->
 * prospect: `canonical_leads` carries only a NON-UNIQUE index on
 * `unified_person_id`, so a person may legitimately resolve to several prospect
 * rows. Zero and many are both refusals, never a pick — the same posture
 * `providerMessageResolver` takes for a provider message that resolves to more
 * than one evidence row.
 *
 * ─── IDEMPOTENCY IS NOT REIMPLEMENTED ──────────────────────────────────────
 * The interpreter mints `outcome:<outreach_outcomes.id>` as the `sourceEventKey`,
 * and the writer already answers `duplicate` for a key it has seen. A replayed
 * webhook, a retried operator POST and a re-run of this producer therefore all
 * converge on one transition without anything new being added here.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { readCurrentProspectState } from './lifecycleReader';
import { recordProspectTransition, type RecordTransitionOutcome } from './lifecycleWriter';
import { interpretOutcome } from './outcomeInterpreter';
import { classifyOutcomeProvenance, type OutcomeProvenance } from './outcomeProvenance';
import type { ProspectState } from './stateModel';

/** Bumped when this producer's behaviour changes, so a caller can trace it. */
export const OUTCOME_LIFECYCLE_PRODUCER_VERSION = 'pi.outcome-producer.1';

/**
 * Why no transition was produced. Every value is a REFUSAL, and none of them is
 * an error in the sense of something having gone wrong — an outcome that is not
 * lifecycle-bearing is the common case and must read as such.
 */
export type ProducerRefusal =
  /** No such outcome in this tenant. */
  | 'outcome_not_found'
  /** The outcome names no task, so no person and no prospect can be reached. */
  | 'outcome_has_no_task'
  | 'task_not_found'
  /** The task has no resolved person — unresolved evidence is a supported state. */
  | 'task_has_no_person'
  /** No prospect in this tenant for that person. */
  | 'prospect_unresolved'
  /** SEVERAL prospects for that person. Never guessed. */
  | 'prospect_ambiguous'
  /** The interpreter read it and proposed nothing. Carries its own reason. */
  | 'no_transition'
  /** The mapping is genuinely undecided. Louder than a no-transition. */
  | 'needs_policy'
  /** A `human` proposal with no operator attached. */
  | 'human_origin_requires_actor';

export interface ProduceLifecycleResult {
  readonly version: string;
  /** True only when the writer appended a row. */
  readonly wrote: boolean;
  /** The writer's own verdict, when it was reached. */
  readonly outcome: RecordTransitionOutcome | null;
  readonly state: ProspectState | null;
  readonly previousState: ProspectState | null;
  readonly transitionId: string | null;
  /** Resolved before any interpretation, so a refusal can still name it. */
  readonly prospectId: string | null;
  readonly refusal: ProducerRefusal | null;
  /** The reason, taken from whichever layer produced it. Never invented here. */
  readonly detail: string;
}

export interface OutcomeAnchorRow {
  readonly id: string;
  readonly task_id: string | null;
  readonly outcome_type: string | null;
  readonly source: string | null;
  readonly provider: string | null;
  readonly provider_event_id: string | null;
  readonly derived: boolean | null;
  /**
   * `outreach_outcomes.metadata`. The operator who recorded a human assertion
   * lives at `metadata.recordedByUserId` — `outcomeProvenance` names that as the
   * canonical location, because the table has no actor column and the route
   * writes it from its authenticated principal.
   */
  readonly metadata: Record<string, unknown> | null;
}

/** Injected, so the producer is testable without a database. */
export interface OutcomeLifecycleProducerPorts {
  loadOutcome(organizationId: string, outcomeId: string): Promise<OutcomeAnchorRow | null>;
  loadTaskPersonId(organizationId: string, taskId: string): Promise<{ personId: string | null } | null>;
  /** EVERY prospect for this person in this tenant. The caller refuses on ≠ 1. */
  loadProspectIds(organizationId: string, personId: string): Promise<readonly string[]>;
  readState: typeof readCurrentProspectState;
  record: typeof recordProspectTransition;
}

/**
 * The real reads. Each filters its own tenant column — defence in depth, the
 * same position `prospectOutcomes/corpus.ts` takes and for the same reason:
 * relying on a previous query having been correct is how a join becomes the only
 * thing between two tenants.
 */
export const defaultOutcomeLifecycleProducerPorts: OutcomeLifecycleProducerPorts = {
  async loadOutcome(organizationId: string, outcomeId: string): Promise<OutcomeAnchorRow | null> {
    const { data, error } = await ownedDbTable('outreach_outcomes')
      .select('id, task_id, outcome_type, source, provider, provider_event_id, derived, metadata')
      .eq('company_id', organizationId)          // tenant — never optional
      .eq('id', outcomeId);
    if (error) throw new Error(`outreach_outcomes read failed: ${error.message}`);
    const rows = (data ?? []) as OutcomeAnchorRow[];
    return rows[0] ?? null;
  },

  async loadTaskPersonId(organizationId: string, taskId: string) {
    const { data, error } = await ownedDbTable('outreach_tasks')
      .select('id, person_id')
      .eq('company_id', organizationId)          // tenant — never optional
      .eq('id', taskId);
    if (error) throw new Error(`outreach_tasks read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; person_id: string | null }>;
    if (!rows.length) return null;
    return { personId: rows[0].person_id ?? null };
  },

  async loadProspectIds(organizationId: string, personId: string): Promise<readonly string[]> {
    // NOT `.single()`, and no LIMIT: `canonical_leads` has only a non-unique
    // index on `unified_person_id`, so several rows are possible and the caller
    // must see all of them to refuse rather than silently take the first.
    const { data, error } = await ownedDbTable('canonical_leads')
      .select('id')
      .eq('company_id', organizationId)          // tenant — never optional
      .eq('unified_person_id', personId);
    if (error) throw new Error(`canonical_leads read failed: ${error.message}`);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  },

  readState: readCurrentProspectState,
  record: recordProspectTransition,
};

export interface ProduceLifecycleInput {
  /** TENANT. Explicit, never ambient. */
  readonly organizationId: string;
  /** `outreach_outcomes.id`. The caller names the ONE outcome to read. */
  readonly outcomeId: string;
  /**
   * The operator accountable for a `human`-origin transition, when there is one.
   *
   * Supplied by a caller that authenticated a person — the operator outcomes
   * route has one; a provider webhook does not. Absent, a `human` proposal is
   * refused rather than downgraded to `derived`, because rewriting the origin
   * would launder an operator judgement into a machine inference.
   */
  readonly actorUserId?: string | null;
  /** ISO. Never ambient — a lifecycle anchored to `new Date()` is untestable. */
  readonly now: string;
}

/**
 * A usable user id, or null. Total over anything a jsonb column can hold: a
 * number, an object or a blank string is "no operator", never a coerced one.
 */
const recordedBy = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const refuse = (
  refusal: ProducerRefusal, detail: string, prospectId: string | null = null,
): ProduceLifecycleResult => ({
  version: OUTCOME_LIFECYCLE_PRODUCER_VERSION,
  wrote: false, outcome: null, state: null, previousState: null,
  transitionId: null, prospectId, refusal, detail,
});

/**
 * Read ONE outcome and, if the ratified mapping proposes a transition, write it
 * through the existing lifecycle writer.
 *
 * Refuses, in order: a missing tenant or outcome id, an outcome this tenant does
 * not own, an outcome with no task, a task with no person, a person that resolves
 * to no prospect or to several, an interpretation that proposes nothing, an
 * undecided mapping, and a `human` proposal with no operator. None of those
 * writes anything.
 */
export async function produceLifecycleFromOutcome(
  input: ProduceLifecycleInput,
  ports: OutcomeLifecycleProducerPorts = defaultOutcomeLifecycleProducerPorts,
): Promise<ProduceLifecycleResult> {
  const organizationId = String(input.organizationId ?? '').trim();
  if (!organizationId) {
    throw new Error('produceLifecycleFromOutcome: organizationId is required — an outcome is never tenant-less');
  }
  const outcomeId = String(input.outcomeId ?? '').trim();
  if (!outcomeId) {
    throw new Error('produceLifecycleFromOutcome: outcomeId is required');
  }
  if (!String(input.now ?? '').trim()) {
    throw new Error('produceLifecycleFromOutcome: now is required — lifecycle time is never ambient');
  }

  // ── 1. the outcome, in this tenant ───────────────────────────────────────
  const outcome = await ports.loadOutcome(organizationId, outcomeId);
  if (!outcome) {
    return refuse('outcome_not_found', `no outcome ${outcomeId} in this tenant`);
  }
  if (!outcome.task_id) {
    return refuse('outcome_has_no_task',
      'the outcome names no task, so no person and no prospect can be reached from it');
  }

  // ── 2. task -> person. The task's own composite tenant key already couples
  //        person to tenant; the predicate here is defence in depth.
  const task = await ports.loadTaskPersonId(organizationId, outcome.task_id);
  if (!task) {
    return refuse('task_not_found', `no task ${outcome.task_id} in this tenant`);
  }
  if (!task.personId) {
    return refuse('task_has_no_person',
      'the task has no resolved person; unresolved outreach evidence is a supported state');
  }

  // ── 3. person -> prospect. Zero and many are both refusals. ──────────────
  const prospectIds = await ports.loadProspectIds(organizationId, task.personId);
  if (prospectIds.length === 0) {
    return refuse('prospect_unresolved',
      `person ${task.personId} has no prospect in this tenant`);
  }
  if (prospectIds.length > 1) {
    return refuse('prospect_ambiguous',
      `person ${task.personId} resolves to ${prospectIds.length} prospects; refusing to choose one`);
  }
  const prospectId = prospectIds[0];

  // ── 4. the prospect's state NOW ──────────────────────────────────────────
  const current = await ports.readState(organizationId, prospectId);
  const currentState: ProspectState | null = current?.state ?? null;

  // ── 5. the operator, if there is one ─────────────────────────────────────
  // An explicit one wins: a caller holding a live authenticated principal knows
  // better than a stored row. Otherwise the documented location is read. The
  // origin is NEVER rewritten either way — an absent actor refuses the write
  // rather than turning a human judgement into a machine inference.
  const actorUserId = recordedBy(input.actorUserId) ?? recordedBy(outcome.metadata?.recordedByUserId);

  // Provenance is carried for audit; the interpreter does not consult it
  // (PI-LIFECYCLE-003B, PI-ADR-006). The actor is bound to the OUTCOME's tenant,
  // which is the comparison `classifyOutcomeProvenance` exists to make.
  const provenance: OutcomeProvenance = {
    organizationId,
    source: outcome.source,
    provider: outcome.provider,
    providerEventId: outcome.provider_event_id,
    derived: outcome.derived ?? false,
    actor: actorUserId ? { userId: actorUserId, organizationId } : null,
  };

  const reading = interpretOutcome({
    outcome: { id: outcome.id, type: outcome.outcome_type, provenance },
    currentState,
  });

  if (reading.kind === 'needs-policy') {
    return refuse('needs_policy',
      `${reading.decision}: ${reading.detail}`, prospectId);
  }
  if (reading.kind === 'no-transition') {
    return refuse('no_transition', `${reading.reason}: ${reading.detail}`, prospectId);
  }

  // ── 6. a proposal. A `human` origin is unwritable without an operator. ───
  if (reading.origin === 'human' && !actorUserId) {
    return refuse('human_origin_requires_actor',
      `${reading.outcomeType} proposes ${reading.from} -> ${reading.to} as a human judgement, `
      + 'and no operator was supplied; the origin is never downgraded to derived',
      prospectId);
  }

  // ── 7. write, through the ONE writer, with the proposal's own fields ─────
  // Nothing is substituted: `to`, `origin`, `evidence`, `sourceEventKey`,
  // `reasoning` and `modelVersion` are all the interpreter's. Idempotency is the
  // writer's, keyed on `outcome:<id>`.
  const written = await ports.record({
    organizationId,
    prospectId,
    to: reading.to,
    origin: reading.origin,
    actorUserId: reading.origin === 'human' ? actorUserId : null,
    evidence: { kind: reading.evidence.kind, outcomeId: reading.evidence.outcomeId },
    sourceEventKey: reading.sourceEventKey,
    reasoning: reading.reasoning,
    modelVersion: reading.modelVersion,
    now: input.now,
  });

  return {
    version: OUTCOME_LIFECYCLE_PRODUCER_VERSION,
    wrote: written.wrote,
    outcome: written.outcome,
    state: written.state,
    previousState: written.previousState,
    transitionId: written.id,
    prospectId,
    refusal: null,
    detail: `${reading.outcomeType}: ${reading.reasoning}`,
  };
}

/**
 * Whether an outcome's provenance would authorise a human-witnessed claim.
 *
 * Re-exported as a convenience for a caller deciding whether to attach an
 * operator, so nobody re-derives the authority question. It is NOT consulted by
 * the producer: authorisation and lifecycle authority are different questions,
 * and PI-ADR-006 settled that an authorised assertion does not by itself advance
 * the lifecycle.
 */
export function outcomeProvenanceAuthority(provenance: OutcomeProvenance | null | undefined): string {
  return classifyOutcomeProvenance(provenance).authority;
}
