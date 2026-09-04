/**
 * WS-9 — the outreach OUTCOME CORPUS, readable from the canonical Prospect.
 *
 * ─── SCOPE NOTE, READ THIS FIRST ──────────────────────────────────────────
 * The manifest assigns WS-9 exactly one row — FR-28 Import (`csvAdapter`) —
 * and marks it EXISTS / BR-06 FULLY SATISFIED. Outreach feedback is FR-26 and
 * belongs to WS-8; learning is FR-30 and belongs to WS-6. This module
 * therefore implements NEITHER: not the feedback ingestion that already
 * exists, and not the learning algorithm that is explicitly out of scope.
 *
 * What it implements is the one thing between them that no workstream owns and
 * that FR-30 is blocked on — the READ PATH. `outreach_outcomes` has held
 * outcomes since WS-3 M1 and nothing in the repository joins it to
 * `canonical_leads` or `unified_persons`, so the corpus exists and Prospect
 * Intelligence cannot see it. The frozen PI lineage ends
 * "… → OUTCOME (`outreach_outcomes`) → LEARNING (proposal only)", and that
 * arrow had no implementation.
 *
 * ─── IT READS. IT INGESTS NOTHING AND LEARNS NOTHING. ─────────────────────
 * `feedbackIngestion.ingestFeedback` remains the sole write path and keeps its
 * two idempotency keys — `(company_id, task_id, outcome_type, occurred_at)`
 * and the partial unique `(company_id, provider, provider_event_id)`. No
 * second ledger, no second ingestion path, no second idempotency mechanism.
 * Nothing here mutates an ICP, a score, an NBA, a readiness verdict or a
 * governance record: an outcome becomes EVIDENCE, and what a future learner
 * proposes from it is a decision nobody has made yet.
 *
 * ─── ATTRIBUTION IS PERSON-ANCHORED, NEVER lead_id ────────────────────────
 * Outcomes are attributed through `outreach_tasks.person_id` — the A3 anchor,
 * a composite FK to `unified_persons (id, company_id)`. `outreach_tasks.lead_id`
 * is deliberately NOT used: the A3 migration states plainly that the
 * identifier flowing into that runtime "is NOT proven to be `leads.id`", so
 * joining on it would attribute outcomes on an identifier whose meaning the
 * contract does not establish. A test asserts this module never reads it.
 *
 * One Account has many Prospects, so attribution stops at the PERSON. An
 * outcome for one contact is never spread across their colleagues.
 *
 * ─── A ZERO IS NOT A NEGATIVE ─────────────────────────────────────────────
 * `opened`, `clicked` and `meeting_booked` are unobservable on every transport
 * this platform has: no tracking instrumentation, no booking integration. A
 * count of zero for them means "we cannot see this", not "it did not happen",
 * and each count carries `observable` so a reader cannot mistake one for the
 * other. `feedbackSummary` already refuses that conflation; this reuses its
 * constant rather than restating the judgement.
 *
 * `derived` is likewise preserved: `no_response` is asserted by an elapsed
 * window, never observed, and a learner must be able to tell an asserted
 * silence from a witnessed one.
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  UNOBSERVABLE_BUSINESS_OUTCOMES,
  DERIVED_BUSINESS_OUTCOMES,
  type BusinessOutcomeType,
} from '../leadOutreachExecution/types';

/** Bumped when the corpus contract changes, so a reader traces its answer. */
export const OUTCOME_CORPUS_VERSION = 'ws9.1';

/**
 * The repository's established business-outcome vocabulary, in the order the
 * database CHECK declares it. Derived from the type rather than restated, so
 * it cannot drift from `outreach_outcomes_type_valid`.
 */
export const BUSINESS_OUTCOME_TYPES: readonly BusinessOutcomeType[] = [
  'opened', 'clicked', 'replied', 'meeting_booked',
  'rejected', 'no_response', 'unsubscribed', 'converted',
];

/**
 * The frozen PI outcome vocabulary mapped onto what this repository actually
 * stores — DOCUMENTED, not silently replaced.
 *
 * `null` means the repository has no counterpart, and inventing one would
 * fabricate a category the platform never observed. Two axes exist and are
 * kept apart: DELIVERY lives on `outreach_tasks.delivery_status`
 * (`delivered`, `bounced`), BUSINESS lives on `outreach_outcomes.outcome_type`.
 * Only the business axis is a corpus row, which is why `attempted`,
 * `delivered` and `bounced` map to the delivery axis rather than here.
 */
export const PI_OUTCOME_VOCABULARY: Readonly<Record<string, {
  readonly axis: 'business' | 'delivery' | 'none';
  readonly repositoryType: BusinessOutcomeType | null;
  readonly note: string;
}>> = {
  attempted: { axis: 'delivery', repositoryType: null, note: 'an attempt is `outreach_attempts`, not an outcome row' },
  delivered: { axis: 'delivery', repositoryType: null, note: 'delivery axis: outreach_tasks.delivery_status' },
  bounced: { axis: 'delivery', repositoryType: null, note: 'delivery axis: outreach_tasks.delivery_status' },
  reply: { axis: 'business', repositoryType: 'replied', note: 'named `replied` here' },
  positive: { axis: 'none', repositoryType: null, note: 'no sentiment axis exists; `replied` states nothing about tone' },
  negative: { axis: 'none', repositoryType: null, note: 'nearest is `rejected`, which is narrower — not a sentiment' },
  unsubscribe: { axis: 'business', repositoryType: 'unsubscribed', note: 'distinct from `rejected` by design (WS-3 M7)' },
  meeting: { axis: 'business', repositoryType: 'meeting_booked', note: 'unobservable today — no booking integration' },
  proposal: { axis: 'none', repositoryType: null, note: 'no proposal stage exists in the outcome model' },
  conversion: { axis: 'business', repositoryType: 'converted', note: 'named `converted` here' },
  failure: { axis: 'none', repositoryType: null, note: 'ambiguous across both axes; not modelled as one category' },
};

// ─────────────────────────────────────────────────────────────────────────────

export interface ProspectRow {
  readonly id: string;
  readonly unified_person_id: string | null;
}

export interface TaskRow {
  readonly id: string;
  readonly channel: string | null;
  readonly delivery_status: string | null;
}

export interface OutcomeRow {
  readonly id: string;
  readonly task_id: string | null;
  readonly outcome_type: string | null;
  readonly derived: boolean | null;
  /** When the outcome OCCURRED, per its source. Never our ingest time. */
  readonly occurred_at: string | null;
  readonly created_at: string | null;
  readonly source: string | null;
  readonly provider: string | null;
  readonly provider_event_id: string | null;
}

/** One outcome, with everything a learner would need to trust it. */
export interface ProspectOutcome {
  readonly id: string;
  readonly taskId: string | null;
  readonly type: BusinessOutcomeType | null;
  /** True when asserted by a rule rather than witnessed. `no_response` always. */
  readonly derived: boolean;
  /** The SOURCE's time. Null when it recorded none — never substituted. */
  readonly occurredAt: string | null;
  /** When WE stored it. Kept apart from `occurredAt` on purpose. */
  readonly recordedAt: string | null;
  readonly source: string | null;
  readonly provider: string | null;
  /** The provider's own event id — the second idempotency key's anchor. */
  readonly providerEventId: string | null;
  readonly channel: string | null;
}

/** A per-type tally that says whether a zero could ever have been anything else. */
export interface OutcomeCount {
  readonly type: BusinessOutcomeType;
  readonly count: number;
  /** False ⇒ a zero means "we cannot see this", not "it did not happen". */
  readonly observable: boolean;
  /** True ⇒ this type is asserted by a rule, never witnessed. */
  readonly derivedByRule: boolean;
}

export interface ProspectOutcomeCorpus {
  readonly version: string;
  readonly organizationId: string;
  readonly prospectId: string;
  /** Null when the Prospect has no resolved person — then nothing is attributable. */
  readonly personId: string | null;
  readonly reason: string;

  /** Chronological by source time. Undated outcomes are kept, and placed last. */
  readonly outcomes: readonly ProspectOutcome[];
  readonly counts: readonly OutcomeCount[];

  readonly completeness: {
    readonly hasPerson: boolean;
    readonly tasks: number;
    readonly outcomes: number;
  };
  readonly provenance: {
    readonly sources: readonly string[];
    readonly providers: readonly string[];
    readonly taskIds: readonly string[];
  };
  readonly freshness: {
    readonly firstOutcomeAt: string | null;
    readonly lastOutcomeAt: string | null;
    readonly ageDays: number | null;
    /** Null means NO POLICY WAS SUPPLIED — not "fresh". */
    readonly stale: boolean | null;
  };
  readonly consistency: {
    /** Witnessed by a source. The only outcomes FR-30 could learn from. */
    readonly observed: number;
    /** Asserted by an elapsed-window rule. Real, but not a witnessed event. */
    readonly derived: number;
    readonly outcomesWithoutObservationTime: number;
    /** Types the platform cannot observe at all, so their zeros mean nothing. */
    readonly unobservableTypes: readonly BusinessOutcomeType[];
    /** Stored values outside the established vocabulary. Reported, not coerced. */
    readonly unrecognisedTypes: readonly string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Everything WS-9 reads. One port; exactly one place names a table. */
export interface ProspectOutcomePorts {
  loadProspect(organizationId: string, prospectId: string): Promise<ProspectRow | null>;
  /** Tasks anchored to this PERSON. Never looked up by `lead_id`. */
  loadTasks(organizationId: string, personId: string): Promise<readonly TaskRow[]>;
  loadOutcomes(organizationId: string, taskIds: readonly string[]): Promise<readonly OutcomeRow[]>;
}

export interface ProspectOutcomeInput {
  /** TENANT. Explicit, never ambient — a context pointer is not a credential. */
  readonly organizationId: string;
  readonly prospectId: string;
  /** Caller policy for freshness. Absent means the age is reported only. */
  readonly stalenessDays?: number;
  /** Injected. Used ONLY to age evidence — never as an occurrence time. */
  readonly now: string;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const msOf = (t: string | null): number | null => {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
};

const daysBetween = (from: string | null, to: string): number | null => {
  const a = msOf(from);
  const b = msOf(to);
  if (a === null || b === null) return null;
  return Math.floor((b - a) / 86_400_000);
};

const isBusinessOutcome = (v: string | null): v is BusinessOutcomeType =>
  v !== null && (BUSINESS_OUTCOME_TYPES as readonly string[]).includes(v);

/**
 * The default ports. The ONLY place in WS-9 that names a table.
 *
 * Every read filters its own tenant column, including the outcome read. That
 * is defence in depth rather than necessity — the task ids already came from a
 * tenant-scoped query — but relying on a previous query being correct is how a
 * join becomes the only thing standing between two tenants.
 */
export const defaultProspectOutcomePorts: ProspectOutcomePorts = {
  async loadProspect(organizationId: string, prospectId: string): Promise<ProspectRow | null> {
    const { data, error } = await ownedDbTable('canonical_leads')
      .select('id, unified_person_id')
      .eq('id', prospectId)
      .eq('company_id', organizationId)            // tenant boundary — never optional
      .maybeSingle();
    if (error) throw new Error(`canonical_leads read failed: ${error.message}`);
    return (data as ProspectRow | null) ?? null;
  },

  async loadTasks(organizationId: string, personId: string): Promise<readonly TaskRow[]> {
    const { data, error } = await ownedDbTable('outreach_tasks')
      // `person_id` is A3's composite-FK anchor. `lead_id` is NOT read: the A3
      // migration records that it is not proven to be `leads.id`.
      .select('id, channel, delivery_status')
      .eq('company_id', organizationId)            // tenant boundary — never optional
      .eq('person_id', personId);
    if (error) throw new Error(`outreach_tasks read failed: ${error.message}`);
    return (data ?? []) as TaskRow[];
  },

  async loadOutcomes(organizationId: string, taskIds: readonly string[]): Promise<readonly OutcomeRow[]> {
    if (taskIds.length === 0) return [];
    const { data, error } = await ownedDbTable('outreach_outcomes')
      .select('id, task_id, outcome_type, derived, occurred_at, created_at, source, provider, provider_event_id')
      .eq('company_id', organizationId)            // tenant boundary — never optional
      .in('task_id', [...taskIds]);
    if (error) throw new Error(`outreach_outcomes read failed: ${error.message}`);
    return (data ?? []) as OutcomeRow[];
  },
};

/**
 * Read every outreach outcome attributable to one Prospect, for one tenant.
 *
 * Pure with respect to the database: it writes nothing, so repeated reads are
 * identical and create nothing. Outcome idempotency stays where it already
 * lives — the two unique constraints `ingestFeedback` writes against — and no
 * second mechanism is introduced.
 *
 * Returns null when the Prospect is not readable in this tenant, which is an
 * identity fact rather than an empty corpus.
 */
export async function readProspectOutcomeCorpus(
  input: ProspectOutcomeInput,
  ports: ProspectOutcomePorts = defaultProspectOutcomePorts,
): Promise<ProspectOutcomeCorpus | null> {
  if (!input.organizationId?.trim()) {
    throw new Error('organizationId is required to read the outcome corpus');
  }
  if (!input.prospectId?.trim()) {
    throw new Error('prospectId is required to read the outcome corpus');
  }
  if (!input.now?.trim()) {
    throw new Error('now is required — outcome freshness is never derived from ambient time');
  }

  const prospect = await ports.loadProspect(input.organizationId, input.prospectId);
  if (!prospect) return null;

  const personId = text(prospect.unified_person_id);
  const hasPolicy = typeof input.stalenessDays === 'number' && input.stalenessDays >= 0;
  const unobservableTypes = [...UNOBSERVABLE_BUSINESS_OUTCOMES];

  const emptyCounts = (): OutcomeCount[] => BUSINESS_OUTCOME_TYPES.map((type) => ({
    type,
    count: 0,
    observable: !UNOBSERVABLE_BUSINESS_OUTCOMES.includes(type),
    derivedByRule: DERIVED_BUSINESS_OUTCOMES.includes(type),
  }));

  const base = {
    version: OUTCOME_CORPUS_VERSION,
    organizationId: input.organizationId,
    prospectId: prospect.id,
    personId,
  };

  // Attribution is person-anchored. With no person there is no anchor, and an
  // account-level fallback would spread one contact's outcome across every
  // colleague — which is the one attribution error this model must not make.
  if (!personId) {
    return {
      ...base,
      reason: 'this prospect has no resolved person, so no outreach outcome can be attributed to it',
      outcomes: [],
      counts: emptyCounts(),
      completeness: { hasPerson: false, tasks: 0, outcomes: 0 },
      provenance: { sources: [], providers: [], taskIds: [] },
      freshness: { firstOutcomeAt: null, lastOutcomeAt: null, ageDays: null, stale: hasPolicy ? true : null },
      consistency: {
        observed: 0, derived: 0, outcomesWithoutObservationTime: 0,
        unobservableTypes, unrecognisedTypes: [],
      },
    };
  }

  const tasks = await ports.loadTasks(input.organizationId, personId);
  const channelByTask = new Map(tasks.map((t) => [t.id, text(t.channel)]));
  const rows = await ports.loadOutcomes(input.organizationId, tasks.map((t) => t.id));

  const unrecognised = new Set<string>();
  const outcomes: ProspectOutcome[] = rows.map((r) => {
    const type = text(r.outcome_type);
    if (type !== null && !isBusinessOutcome(type)) unrecognised.add(type);
    const taskId = text(r.task_id);
    return {
      id: r.id,
      taskId,
      // A value outside the established vocabulary is reported as null and
      // listed, never coerced into the nearest recognised category.
      type: isBusinessOutcome(type) ? type : null,
      derived: r.derived === true,
      occurredAt: text(r.occurred_at),
      recordedAt: text(r.created_at),
      source: text(r.source),
      provider: text(r.provider),
      providerEventId: text(r.provider_event_id),
      channel: taskId ? channelByTask.get(taskId) ?? null : null,
    };
  });

  // Dated outcomes sort chronologically. An undated one is kept and placed
  // last rather than given a position it did not earn — `occurred_at` is NOT
  // NULL in the schema, but a port is an interface and this does not assume.
  const dated = outcomes.filter((o) => o.occurredAt !== null);
  const undated = outcomes.filter((o) => o.occurredAt === null);
  dated.sort((a, b) => {
    const d = (msOf(a.occurredAt) ?? 0) - (msOf(b.occurredAt) ?? 0);
    return d !== 0 ? d : a.id.localeCompare(b.id);      // stable, so repeats match
  });
  const ordered = [...dated, ...undated];

  const counts = emptyCounts().map((c) => ({
    ...c,
    count: outcomes.filter((o) => o.type === c.type).length,
  }));

  const firstOutcomeAt = dated[0]?.occurredAt ?? null;
  const lastOutcomeAt = dated[dated.length - 1]?.occurredAt ?? null;
  const ageDays = daysBetween(lastOutcomeAt, input.now);

  return {
    ...base,
    reason: `${tasks.length} outreach task(s), ${outcomes.length} outcome(s) attributed through the person anchor`,
    outcomes: ordered,
    counts,
    completeness: { hasPerson: true, tasks: tasks.length, outcomes: outcomes.length },
    provenance: {
      sources: [...new Set(outcomes.map((o) => o.source).filter((s): s is string => s !== null))].sort(),
      providers: [...new Set(outcomes.map((o) => o.provider).filter((p): p is string => p !== null))].sort(),
      taskIds: [...new Set(outcomes.map((o) => o.taskId).filter((t): t is string => t !== null))].sort(),
    },
    freshness: {
      firstOutcomeAt,
      lastOutcomeAt,
      ageDays,
      // No dated outcome means currency cannot be shown, so under a real policy
      // it is stale — the rule WS-2, WS-5 and WS-7 already apply. It is NOT
      // evidence that outreach failed; `completeness` says whether any exists.
      stale: hasPolicy ? (ageDays === null || ageDays > (input.stalenessDays as number)) : null,
    },
    consistency: {
      observed: outcomes.filter((o) => !o.derived).length,
      derived: outcomes.filter((o) => o.derived).length,
      outcomesWithoutObservationTime: undated.length,
      unobservableTypes,
      unrecognisedTypes: [...unrecognised].sort(),
    },
  };
}
