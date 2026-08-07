/**
 * WS-3 Milestone-1 — Lead Outreach Execution: canonical domain model.
 *
 * The durable execution model defined by the frozen WS-3 architecture
 * (docs/WS3-ARCHITECTURE.md). Types only — nothing here executes, dispatches,
 * translates or contacts anything.
 *
 * RELATIONSHIP TO WS-2. `AutomationTask` (owned by WS-2, immutable) is the
 * PLAN unit; `OutreachTask` below is the EXECUTION unit. A plan is disposable
 * and regenerated on every generation; a task is materialised once and durable.
 * The task therefore MIRRORS the plan's shape rather than referencing it — it
 * has to stand alone after the plan that produced it is regenerated away.
 *
 * Materialisation itself (AutomationTask → OutreachTask) is Milestone-2 and
 * lives at a single translation boundary. It does not exist yet.
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * The 17 execution states. Storage + validation only in M1: no transition is
 * performed by this milestone.
 *
 * `retried`, `resumed` and `reassigned` are TRANSITIONS recorded for audit, not
 * resting states — they resolve immediately and deterministically to `queued`
 * (or `pending` for reassignment), and no task may be observed resting in them.
 */
export type OutreachTaskStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'queued'
  | 'dispatching'
  | 'sent'
  | 'delivered'
  | 'completed'
  | 'failed'
  | 'retried'
  | 'paused'
  | 'resumed'
  | 'escalated'
  | 'reassigned'
  | 'cancelled'
  | 'expired';

// ---------------------------------------------------------------------------
// Outcomes — two orthogonal axes
// ---------------------------------------------------------------------------

/**
 * DELIVERY axis: mechanical, transport-derived, monotonic.
 *
 * `confirmed` ≡ the community runtime's `executed` (a platform-confirmed write:
 * API success, or extension ack with `confirmed=true`). `sent_unverified`
 * carries the same meaning in both runtimes. Defined as a mapping so the two
 * stay interpretable side by side rather than growing two vocabularies.
 */
export type DeliveryStatus =
  | 'queued'
  | 'dispatched'
  | 'confirmed'
  | 'sent_unverified'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'suppressed'
  | 'expired';

/**
 * BUSINESS axis: recipient behaviour. Late-arriving, sparse, and frequently
 * absent — absence is normal, not an error.
 *
 * Orthogonal to delivery by design: a task can be `confirmed` on delivery and
 * `no_response` here at the same time, which is the most operationally
 * meaningful combination in outreach. They must never collapse into one field.
 */
export type BusinessOutcomeType =
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'meeting_booked'
  | 'rejected'
  | 'no_response'
  // WS-3 M7. `unsubscribed` is deliberately distinct from `rejected`: a
  // rejection is 'not interested in this', an unsubscribe is 'never contact me
  // again', and only the second is a compliance obligation.
  | 'unsubscribed'
  | 'converted';

/**
 * Business outcomes that NO transport in this platform can observe today:
 * `opened`/`clicked` need tracking instrumentation, `meeting_booked` needs a
 * booking integration. They are modelled so nothing has to change when
 * instrumentation arrives — but they must be reported as unobservable rather
 * than silently never-populated.
 */
export const UNOBSERVABLE_BUSINESS_OUTCOMES: readonly BusinessOutcomeType[] = [
  'opened',
  'clicked',
  'meeting_booked',
] as const;

/** `no_response` is asserted by an elapsed-window rule, never observed. */
export const DERIVED_BUSINESS_OUTCOMES: readonly BusinessOutcomeType[] = ['no_response'] as const;

// ---------------------------------------------------------------------------
// Governance decision log
// ---------------------------------------------------------------------------

/** Gates in the frozen dispatch order. No gate executes in M1. */
export type GovernanceGate = 'kill_switch' | 'suppression' | 'region' | 'approval' | 'rate_limit' | 'transport';

/** Which layer of the durable two-layer limiter answered. */
export type LimiterLayer = 'redis' | 'db';

// ---------------------------------------------------------------------------
// Immutable provenance
// ---------------------------------------------------------------------------

/**
 * Captured ONCE at materialisation, never mutated (enforced by a database
 * trigger, not by convention).
 *
 * DESCRIPTIVE, NOT DISPATCH-CONTROLLING. Governance is evaluated at dispatch
 * against the rules then in force; each attempt separately records the
 * governance version in force at that attempt. Without the distinction,
 * tightening a rule would appear retroactively to have governed earlier sends.
 */
export interface OutreachTaskProvenance {
  /** The `ENGINE_VERSION` of the envelope the plan came from. WS-2-owned. */
  plannerVersion: string;
  /** Version of the single translation module that materialised this task. */
  translationVersion: string;
  /** Governance rule set in force AT MATERIALISATION. */
  governanceVersion: string;
  /** Version of the Lead Outreach Execution Runtime. */
  executionRuntimeVersion: string;
  materializedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// The canonical execution unit
// ---------------------------------------------------------------------------

export interface OutreachTask extends OutreachTaskProvenance {
  id: string | null;
  companyId: string;
  leadId: string;
  /**
   * The planner's deterministic `task-<order>-<slug>`. Together with
   * (companyId, leadId) this is the idempotency anchor: because plans
   * regenerate deterministically, the same logical task yields the same key
   * across regenerations, which is what stops a regenerated plan re-sending
   * work that already completed.
   */
  planTaskId: string;

  // Mirrored plan shape — see the module header on why this is a copy.
  taskOrder: number | null;
  kind: string | null;
  action: string | null;
  channel: string | null;
  dependsOnPlanTaskId: string | null;
  estimatedDelayHours: number | null;
  confidence: number | null;
  explanation: string | null;

  status: OutreachTaskStatus;
  /** Delivery axis. Null until a dispatch attempt exists. */
  deliveryStatus: DeliveryStatus | null;
  requiresApproval: boolean;

  createdAt: string | null;
  updatedAt: string | null;
}

/** Fields a caller supplies at materialisation. Status is not one of them. */
export type NewOutreachTask = Omit<OutreachTask, 'id' | 'status' | 'deliveryStatus' | 'createdAt' | 'updatedAt'> & {
  status?: OutreachTaskStatus;
  deliveryStatus?: DeliveryStatus | null;
};

// ---------------------------------------------------------------------------
// Append-only audit records
// ---------------------------------------------------------------------------

export interface OutreachApproval {
  id: string | null;
  companyId: string;
  taskId: string;
  decision: 'approved' | 'rejected';
  approverUserId: string | null;
  /** Structured cause — answers "under which rule". */
  reason: string | null;
  /** WS-3 M3: free-text note the approver actually wrote. Optional. */
  notes: string | null;
  /** Snapshot of HumanReviewAssessment.missingInformation at decision time. */
  missingInformation: string[];
  decidedAt: string;
}

export interface OutreachAttempt {
  id: string | null;
  companyId: string;
  taskId: string;
  attemptNumber: number;
  channel: string | null;
  transport: string | null;
  /** Governance version in force AT THIS ATTEMPT — see OutreachTaskProvenance. */
  governanceVersion: string | null;
  /** WS-3 M5A: the execution runtime that performed this attempt. */
  executionRuntimeVersion?: string | null;
  /** WS-3 M5A: which durable limiter layer answered for this attempt. */
  limiterLayer?: LimiterLayer | null;
  /**
   * WS-3 M5B: the deterministic provider idempotency key for this attempt.
   * Unique per tenant, so a repeated request cannot reach a provider under a
   * key it has already seen.
   */
  idempotencyKey?: string | null;
  outcome: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface OutreachDeliveryEvidence {
  id: string | null;
  companyId: string;
  taskId: string;
  attemptId: string | null;
  deliveryStatus: DeliveryStatus;
  /** WS-3 M5B: which provider produced this evidence. Null for internal. */
  provider?: string | null;
  /**
   * WS-3 M5B: the identifier the provider issued. Without it there is no way
   * to correlate our record with the provider's during a deliverability
   * investigation.
   */
  providerMessageId?: string | null;
  transportResponse: Record<string, unknown>;
  observedAt: string;
  /** WS-3 M7 — who observed this delivery fact. Null for pre-M7 rows. */
  source?: FeedbackSource | null;
  /** WS-3 M7 — the provider's event id, used to collapse retried webhooks. */
  providerEventId?: string | null;
}

export interface OutreachOutcome {
  id: string | null;
  companyId: string;
  taskId: string;
  outcomeType: BusinessOutcomeType;
  /** True when asserted by a rule rather than observed. Always true for `no_response`. */
  derived: boolean;
  evidence: Record<string, unknown>;
  occurredAt: string;
  /** WS-3 M7 — WHO observed it. `derived` says whether it was observed at all. */
  source?: FeedbackSource | null;
  provider?: string | null;
  /** Provider's own event id, used to collapse retried webhook deliveries. */
  providerEventId?: string | null;
  metadata?: Record<string, unknown>;
}

/** WS-3 M7 — where a feedback record came from. Closed set. */
export type FeedbackSource = 'provider_webhook' | 'provider_poll' | 'manual' | 'import' | 'derived' | 'internal';

export interface OutreachDecision {
  id: string | null;
  companyId: string;
  taskId: string | null;
  gate: GovernanceGate;
  decision: 'allowed' | 'denied';
  reason: string | null;
  scope: string | null;
  limiterLayer: LimiterLayer | null;
  governanceVersion: string | null;
  decidedAt: string;
}
