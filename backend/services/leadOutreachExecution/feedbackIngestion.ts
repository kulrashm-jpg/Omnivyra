/**
 * WS-3 Milestone-7 — feedback ingestion.
 *
 * THE ONE-WAY RULE. This module is the terminus of the pipeline, not a return
 * path. Feedback records what happened after a task was dispatched; it does not
 * — and structurally cannot — flow back into WS-2. Nothing here imports a
 * behaviour, intent, qualification, recommendation, replay or fingerprint
 * module, and nothing in WS-2 imports this one. That is asserted by guard tests
 * rather than left to reviewer discipline, because the failure mode is silent:
 * a single import would make yesterday's scores depend on today's webhooks, and
 * the fingerprint — which deliberately excludes `now` so identical inputs
 * produce identical output — would start moving on its own.
 *
 * ROUTING. Feedback arrives as one vocabulary but lands on two axes:
 *
 *   delivered, bounced ................ DELIVERY axis (message's fate)
 *   opened … converted, no_response ... BUSINESS axis (recipient's behaviour)
 *
 * They are not merged. A message can be `delivered` and never answered, which
 * is the single most common and most operationally meaningful combination in
 * outreach; collapsing the axes would make it unrepresentable.
 *
 * IDEMPOTENCY. Providers deliver at-least-once and retry on any non-2xx, so the
 * same event arrives repeatedly and a naive ingest would report one reply as
 * four. Two independent database keys defend against that, and both are
 * enforced by unique indexes rather than by a read-then-write check that a
 * concurrent retry would race through:
 *
 *   • the LOGICAL key — (company, task, type, instant) — collapses the same
 *     observation reported through different channels;
 *   • the PROVIDER-EVENT key — (company, provider, provider_event_id) —
 *     collapses one provider event redelivered with a re-stamped timestamp,
 *     which the logical key would not catch.
 *
 * A duplicate is a SUCCESS with `duplicate: true`. It is the expected steady
 * state of an at-least-once transport, not an error, and must never be
 * reported as one — an ingestion endpoint that 500s on a duplicate teaches the
 * provider to retry harder.
 */

import {
  appendDeliveryEvidence,
  appendOutcome,
  getOutreachTaskById,
  listDeliveryEvidence,
  listOutcomes,
} from './storage';
import { isDeliveryTransitionAllowed, isTransitionAllowed } from './lifecycle';
import { setOutreachTaskState } from './storage';
import { recordFeedbackIngestion, recordFeedbackRouting } from './telemetry';
import type {
  BusinessOutcomeType,
  DeliveryStatus,
  FeedbackSource,
  OutreachTask,
} from './types';

/** WS-3 M7 — version of the feedback contract. Bumped when its shape changes. */
// W1-B — the canonical governance writer. An unsubscribe is a standing
// instruction, not merely an observation, so it must reach the source of truth.
import { recordContactGovernance } from '../prospectIdentity/contactGovernanceWriter';
import { ALL_CHANNELS } from '../prospectIdentity/contactGovernance';

export const FEEDBACK_VERSION = 'fb-1.0.0';

/**
 * The signal vocabulary an external caller may submit. A superset of neither
 * axis: it is the union of the delivery facts and the business outcomes that
 * can legitimately arrive as feedback.
 *
 * `rejected` — a valid business outcome since M1 — is deliberately NOT
 * ingestible. No transport reports it: it is an operator's reading of a reply,
 * recorded through the human decision path with an approver attached, and
 * accepting it here would let an anonymous webhook assert a human judgement.
 */
export const FEEDBACK_SIGNALS = [
  'delivered',
  'bounced',
  'opened',
  'clicked',
  'replied',
  'unsubscribed',
  'meeting_booked',
  'converted',
  'no_response',
] as const;

export type FeedbackSignal = (typeof FEEDBACK_SIGNALS)[number];

/** Which axis a signal lands on. Fixed, exhaustive, not configurable. */
const DELIVERY_SIGNALS: Readonly<Record<string, DeliveryStatus>> = {
  delivered: 'delivered',
  bounced: 'bounced',
};

const BUSINESS_SIGNALS: readonly FeedbackSignal[] = [
  'opened',
  'clicked',
  'replied',
  'unsubscribed',
  'meeting_booked',
  'converted',
  'no_response',
] as const;

export const FEEDBACK_SOURCES: readonly FeedbackSource[] = [
  'provider_webhook',
  'provider_poll',
  'manual',
  'import',
  'derived',
  'internal',
] as const;

export const isFeedbackSignal = (v: unknown): v is FeedbackSignal =>
  typeof v === 'string' && (FEEDBACK_SIGNALS as readonly string[]).includes(v);

export const isFeedbackSource = (v: unknown): v is FeedbackSource =>
  typeof v === 'string' && (FEEDBACK_SOURCES as readonly string[]).includes(v);

/** Which axis a given signal belongs to. Exported so callers can reason about routing. */
export const feedbackAxis = (signal: FeedbackSignal): 'delivery' | 'business' =>
  signal in DELIVERY_SIGNALS ? 'delivery' : 'business';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface FeedbackEvent {
  companyId: string;
  /** The `outreach_tasks.id` this feedback is about. */
  taskId: string;
  signal: FeedbackSignal;
  /** When the recipient's action happened — NOT when we heard about it. */
  occurredAt: string;
  source: FeedbackSource;
  /** Provider that reported it. Null for manual, import and internal sources. */
  provider?: string | null;
  /** The provider's own event id. The strongest deduplication key available. */
  providerEventId?: string | null;
  /** Dispatch attempt this feedback concerns, when the provider tells us. */
  attemptId?: string | null;
  /**
   * What was actually observed — the raw material of the explanation. Kept
   * verbatim so an auditor can see the evidence and not just our reading of it.
   */
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /**
   * W1-C — the SCOPE an `unsubscribed` signal expresses, when the caller knows
   * it. OPTIONAL and backward-compatible: omitted means the task's own channel,
   * exactly as W1-B behaved, so no existing caller silently broadens.
   *
   *   'channel' — stop contacting them on THIS channel.
   *   'all'     — an explicit cross-channel objection.
   *
   * Only meaningful for `unsubscribed`; ignored for every other signal.
   */
  unsubscribeScope?: UnsubscribeScope;
}

/** W1-C. Deliberately two values: anything else is malformed, never 'all'. */
export const UNSUBSCRIBE_SCOPES = ['channel', 'all'] as const;
export type UnsubscribeScope = (typeof UNSUBSCRIBE_SCOPES)[number];
export const isUnsubscribeScope = (v: unknown): v is UnsubscribeScope =>
  typeof v === 'string' && (UNSUBSCRIBE_SCOPES as readonly string[]).includes(v);

export type FeedbackRejection =
  | 'unknown_signal'
  | 'unknown_source'
  | 'invalid_timestamp'
  | 'missing_identity'
  | 'task_not_found'
  | 'write_failed'
  /** W1-B — the outcome was recorded but the standing restriction was not. */
  | 'governance_write_failed'
  /** W1-B — nothing on the task says WHO or WHICH CHANNEL to restrict. */
  | 'governance_unanchorable';

export interface FeedbackResult {
  ok: boolean;
  /** True when the record already existed. A success, not a failure. */
  duplicate: boolean;
  axis: 'delivery' | 'business' | null;
  /** What was recorded, once normalised onto its axis. */
  recorded: { deliveryStatus?: DeliveryStatus; outcomeType?: BusinessOutcomeType } | null;
  /**
   * Whether the task's own delivery/lifecycle state advanced as a result.
   * Recording evidence and advancing state are separate acts: evidence is a
   * fact and is always kept, while the state machine may legitimately refuse
   * the transition (late webhook, already terminal). Refusal is reported, not
   * suppressed, and never discards the evidence.
   */
  stateAdvanced: boolean;
  stateRefusal: string | null;
  rejection: FeedbackRejection | null;
  error: string | null;
}

const fail = (rejection: FeedbackRejection, error: string): FeedbackResult => ({
  ok: false,
  duplicate: false,
  axis: null,
  recorded: null,
  stateAdvanced: false,
  stateRefusal: null,
  rejection,
  error,
});

const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * When a delivery fact should also move the task forward.
 *
 * Only these two lifecycle statuses may be entered from feedback. Feedback is
 * an OBSERVATION; it must not be able to drive a task into `queued`,
 * `dispatching` or any state that implies the runtime is about to act.
 */
const LIFECYCLE_FOR_DELIVERY: Readonly<Partial<Record<DeliveryStatus, 'delivered' | 'failed'>>> = {
  delivered: 'delivered',
  bounced: 'failed',
};

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/**
 * Record one feedback event. Never throws.
 *
 * The order is deliberate: validate → resolve the task → APPEND THE EVIDENCE →
 * only then attempt the state transition. Evidence first means a refused or
 * failed transition can never cost us the observation, which is the asymmetry
 * that matters — a task in a slightly stale state is recoverable, a lost
 * delivery receipt is not.
 */
export async function ingestFeedback(event: FeedbackEvent): Promise<FeedbackResult> {
  const companyId = nonEmpty(event?.companyId);
  const taskId = nonEmpty(event?.taskId);
  if (!companyId || !taskId) return fail('missing_identity', 'companyId and taskId are required');

  if (!isFeedbackSignal(event.signal)) {
    recordFeedbackIngestion('rejected', 'unknown', event?.source);
    return fail('unknown_signal', `unsupported feedback signal: ${String(event?.signal)}`);
  }
  if (!isFeedbackSource(event.source)) {
    recordFeedbackIngestion('rejected', event.signal, undefined);
    return fail('unknown_source', `unsupported feedback source: ${String(event?.source)}`);
  }

  const occurredAt = isoOrNull(event.occurredAt);
  if (!occurredAt) {
    recordFeedbackIngestion('rejected', event.signal, event.source);
    return fail('invalid_timestamp', 'occurredAt must be a parseable ISO-8601 timestamp');
  }

  // Company-scoped read: a webhook naming another tenant's task resolves to
  // nothing, so cross-tenant feedback cannot be written even if a provider (or
  // an attacker replaying a callback) supplies a valid foreign task id.
  const task = await getOutreachTaskById(companyId, taskId);
  if (!task) {
    recordFeedbackIngestion('rejected', event.signal, event.source);
    return fail('task_not_found', 'no task with that id exists for this company');
  }

  const axis = feedbackAxis(event.signal);
  recordFeedbackRouting(axis, event.signal);

  const result =
    axis === 'delivery'
      ? await ingestDeliverySignal(task, event, occurredAt)
      : await ingestBusinessSignal(task, event, occurredAt);

  recordFeedbackIngestion(result.ok ? (result.duplicate ? 'duplicate' : 'accepted') : 'rejected', event.signal, event.source);
  return result;
}

async function ingestDeliverySignal(task: OutreachTask, event: FeedbackEvent, occurredAt: string): Promise<FeedbackResult> {
  const deliveryStatus = DELIVERY_SIGNALS[event.signal];

  const write = await appendDeliveryEvidence({
    companyId: task.companyId,
    taskId: String(task.id),
    attemptId: nonEmpty(event.attemptId),
    deliveryStatus,
    provider: nonEmpty(event.provider),
    providerMessageId: null,
    source: event.source,
    providerEventId: nonEmpty(event.providerEventId),
    transportResponse: event.evidence ?? {},
    observedAt: occurredAt,
  });

  if (!write.ok) {
    return { ...fail('write_failed', write.error ?? 'delivery evidence write failed'), axis: 'delivery' };
  }

  const duplicate = write.duplicate === true;
  const base: FeedbackResult = {
    ok: true,
    duplicate,
    axis: 'delivery',
    recorded: { deliveryStatus },
    stateAdvanced: false,
    stateRefusal: null,
    rejection: null,
    error: null,
  };

  // A duplicate has already had its chance to move the state; re-attempting
  // would be a second write for an event we have decided already happened.
  if (duplicate) return { ...base, stateRefusal: 'duplicate event; state already settled' };

  return { ...base, ...(await advanceTaskState(task, deliveryStatus)) };
}

async function ingestBusinessSignal(task: OutreachTask, event: FeedbackEvent, occurredAt: string): Promise<FeedbackResult> {
  const outcomeType = event.signal as BusinessOutcomeType;

  const write = await appendOutcome({
    companyId: task.companyId,
    taskId: String(task.id),
    outcomeType,
    // `derived` says whether it was OBSERVED or asserted by a rule; `source`
    // says who observed it. They answer different questions and are recorded
    // independently — an imported outcome is observed but not by us.
    derived: event.source === 'derived',
    evidence: event.evidence ?? {},
    occurredAt,
    source: event.source,
    provider: nonEmpty(event.provider),
    providerEventId: nonEmpty(event.providerEventId),
    metadata: event.metadata ?? {},
  });

  if (!write.ok) {
    return { ...fail('write_failed', write.error ?? 'outcome write failed'), axis: 'business' };
  }

  // ── W1-B. AN UNSUBSCRIBE IS A STANDING INSTRUCTION ──────────────────────
  // Every other business signal is observational. This one is compliance-
  // bearing: until now it was recorded as an outcome and nothing else, which is
  // why the manual route refused it outright rather than "record an obligation
  // the platform will not act on". It now reaches the canonical governance
  // writer, so the dispatch-time gate observes it.
  //
  // SCOPE — the task's own channel, never `*`. A person who unsubscribed from
  // an email has not asked us to stop calling them, and inferring that would be
  // broader than the evidence supports. A genuinely cross-channel objection
  // cannot be expressed through this path today; see the contract note in the
  // W1 report.
  //
  // FAIL CLOSED — a failed restriction is NOT reported as successful
  // processing. The outcome row survives (it is append-only and true: the
  // person did unsubscribe), but the caller is told the obligation was not
  // persisted, so a retry is both safe and necessary. Idempotency is the
  // writer's own: `uq_contact_governance_identity` makes a replay a no-op.
  if (outcomeType === 'unsubscribed') {
    const personId = nonEmpty(task.personId);
    const taskChannel = nonEmpty(task.channel);
    // W1-C — SCOPE. `all` records the objection against ALL_CHANNELS ('*').
    // That is the same canonical `unsubscribe` type with a broader channel, not
    // a different instruction: `dnc_permanent` would assert a permanence the
    // recipient did not express, and its CHECK forces '*' for that reason.
    // Only `dnc_permanent` and `dnc_channel` constrain the channel column, so
    // `unsubscribe` + '*' is schema-valid and `channelApplies` honours it for
    // every channel, including channels that do not exist yet.
    const channel = event.unsubscribeScope === 'all' ? ALL_CHANNELS : taskChannel;
    if (!personId || !channel) {
      return {
        ...fail('governance_unanchorable',
          'the task names no canonical person, or no channel for a channel-scoped objection, '
          + 'so no restriction could be anchored'),
        axis: 'business',
        recorded: { outcomeType },
      };
    }
    try {
      await recordContactGovernance({
        organizationId: task.companyId,       // TENANT from the task, never the event
        governanceType: 'unsubscribe',
        channel,
        personId,
        source: event.provider ? `webhook:${event.provider}` : event.source,
        evidence: {
          feedbackSignal: outcomeType,
          unsubscribeScope: event.unsubscribeScope ?? 'channel(default)',
          taskId: String(task.id),
          providerEventId: nonEmpty(event.providerEventId),
          occurredAt,
        },
        effectiveFrom: occurredAt,
      });
    } catch (e) {
      return {
        ...fail('governance_write_failed', e instanceof Error ? e.message : String(e)),
        axis: 'business',
        recorded: { outcomeType },
      };
    }
  }

  return {
    ok: true,
    duplicate: write.duplicate === true,
    axis: 'business',
    recorded: { outcomeType },
    // Business outcomes NEVER move the lifecycle. A reply does not complete a
    // task and a rejection does not cancel one — those are operator decisions
    // with their own audit trail. Feedback observes; it does not decide.
    stateAdvanced: false,
    stateRefusal: 'business outcomes are observational and do not drive lifecycle state',
    rejection: null,
    error: null,
  };
}

/**
 * Advance the delivery axis (and, where it follows, the lifecycle) for a fresh
 * delivery fact.
 *
 * Both transitions are validated against the frozen state machines. An
 * out-of-order webhook — `delivered` arriving after a `bounced` we already
 * recorded — is REFUSED with a reason rather than applied, because the state
 * machine's ordering is the thing that makes the field trustworthy. The
 * evidence row is already durable either way.
 */
async function advanceTaskState(
  task: OutreachTask,
  deliveryStatus: DeliveryStatus,
): Promise<{ stateAdvanced: boolean; stateRefusal: string | null }> {
  const from = task.deliveryStatus;
  if (!from) {
    return { stateAdvanced: false, stateRefusal: 'task has no delivery status yet; nothing was dispatched' };
  }
  if (from === deliveryStatus) {
    return { stateAdvanced: false, stateRefusal: 'delivery status already at this value' };
  }
  if (!isDeliveryTransitionAllowed(from, deliveryStatus)) {
    return { stateAdvanced: false, stateRefusal: `delivery transition ${from} → ${deliveryStatus} is not permitted` };
  }

  const nextLifecycle = LIFECYCLE_FOR_DELIVERY[deliveryStatus];
  const lifecycleOk = nextLifecycle !== undefined && isTransitionAllowed(task.status, nextLifecycle);

  const res = await setOutreachTaskState(task.companyId, String(task.id), {
    deliveryStatus,
    ...(lifecycleOk ? { status: nextLifecycle } : {}),
  });

  if (!res.ok) return { stateAdvanced: false, stateRefusal: res.error ?? 'state write failed' };
  return {
    stateAdvanced: true,
    stateRefusal: lifecycleOk ? null : `lifecycle ${task.status} → ${String(nextLifecycle)} is not permitted; delivery axis advanced alone`,
  };
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

export interface FeedbackBatchResult {
  total: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  results: FeedbackResult[];
}

/**
 * Ingest a batch sequentially.
 *
 * Sequential on purpose. Events for one task are frequently causally ordered
 * (`delivered` then `opened` then `replied`), and running them concurrently
 * would let a later event's state transition be evaluated against a state the
 * earlier event had not yet written. Throughput here is bounded by webhook
 * volume, not by us.
 */
export async function ingestFeedbackBatch(events: readonly FeedbackEvent[]): Promise<FeedbackBatchResult> {
  const results: FeedbackResult[] = [];
  for (const event of events ?? []) {
    results.push(await ingestFeedback(event));
  }
  return {
    total: results.length,
    accepted: results.filter((r) => r.ok && !r.duplicate).length,
    duplicates: results.filter((r) => r.ok && r.duplicate).length,
    rejected: results.filter((r) => !r.ok).length,
    results,
  };
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

/** The durable feedback record for one task, as stored. Company-scoped. */
export interface TaskFeedbackRecord {
  task: OutreachTask;
  deliveryEvidence: Record<string, unknown>[];
  outcomes: Record<string, unknown>[];
}

export async function readTaskFeedback(companyId: string, taskId: string): Promise<TaskFeedbackRecord | null> {
  const task = await getOutreachTaskById(companyId, taskId);
  if (!task) return null;
  const [deliveryEvidence, outcomes] = await Promise.all([
    listDeliveryEvidence(companyId, taskId),
    listOutcomes(companyId, taskId),
  ]);
  return { task, deliveryEvidence, outcomes };
}
