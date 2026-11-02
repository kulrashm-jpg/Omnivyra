/**
 * The journey's events, read from the durable records that already hold them.
 *
 * A VIEW, NOT A STORE. Every event below is already written by its owner: the journey
 * decision record, WS-3's append-only approvals, attempts, evidence and outcomes, the
 * engine request ledger, WhatsApp's inbound messages and PI's lifecycle ledger. A second
 * log would be a second truth that could disagree with them, so nothing here writes.
 *
 * That gives the contract's guarantees directly:
 *   tenant scope   every read is tenant first, and the run is resolved in that tenant
 *   deduplication  the event id derives from the source row, so one fact is one event
 *   replay         reading again gives the same events in the same order
 *   cursor         `after` is the last event seen; order is (occurredAt, eventId)
 *
 * Codes only. Never an address, a fact value or message content, including from
 * `evidence` and `transport_response`, which this module does not read.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { EXECUTION_INSTANCES_TABLE, getExecutionInstance } from '../executionInstances/executionInstanceStore';
import { listInstanceTasks } from '../executionPlans/executionPlanStore';
import { listInstanceHandoffs } from '../outreachBridge/outreachBridgeStore';
import { resolveSubjectPersonId } from '../leadOutreachExecution/personAnchor';
import { listJourneyDecisions, type RecordedJourneyDecision } from './journeyDecisionLog';
import { durableJourneyResponsePort, type JourneyResponsePort } from './journeyResponses';
import {
  executionCorrelationId, executionIdempotencyKey, JOURNEY_EVENT_VERSION, normalizeEngineResult,
  POSITIVE_ENGAGEMENT_EVENTS, type JourneyEvent, type JourneyEventType,
} from './executionContract';
import type { EngineName } from './engineAdapters';

type Row = Record<string, unknown>;

const eventIdFor = (table: string, id: string, type: JourneyEventType): string =>
  createHash('sha256').update(`${table}|${id}|${type}`).digest('hex').slice(0, 32);

async function readRows(query: PromiseLike<{ data: unknown; error: unknown }>, what: string): Promise<Row[]> {
  const res = await query;
  if (res.error) throw Object.assign(new Error(`${what} unreadable`), { code: 'journey_events_unreadable' });
  return Array.isArray(res.data) ? (res.data as Row[]) : [];
}

function decisionEventType(d: RecordedJourneyDecision): JourneyEventType {
  if (d.decision === 'exited') return 'journey.terminated';
  if (d.decision === 'executed') return d.outcome === 'human_completed' ? 'decision.recorded' : 'execution.accepted';
  if (d.decision === 'waiting' && d.engine !== null && d.outcome !== null) {
    const normalized = normalizeEngineResult({ engine: d.engine as EngineName, outcome: d.outcome, disposition: 'wait', reason: null, externalRef: null });
    if (normalized.state === 'EXECUTING') return 'execution.started';
    if (normalized.state === 'REQUESTED' || normalized.state === 'QUEUED') return 'execution.requested';
  }
  return 'decision.recorded';
}

const DELIVERY_EVENTS: Readonly<Record<string, JourneyEventType>> = {
  delivered: 'delivery.confirmed', confirmed: 'delivery.confirmed', bounced: 'delivery.bounced',
  failed: 'delivery.failed', expired: 'delivery.failed',
};

const OUTCOME_EVENTS: Readonly<Record<string, JourneyEventType>> = {
  replied: 'response.replied', unsubscribed: 'response.unsubscribed', rejected: 'response.rejected',
  complained: 'delivery.complained', complaint: 'delivery.complained',
  meeting_booked: 'outcome.recorded', converted: 'outcome.recorded',
};

export interface JourneyEventsPage {
  readonly contractEventVersion: number;
  readonly events: readonly JourneyEvent[];
  /** Pass as `after` to continue. Null when nothing was returned. */
  readonly cursor: string | null;
  /** True when more events exist past this page. */
  readonly hasMore: boolean;
}

export const encodeEventCursor = (e: Pick<JourneyEvent, 'occurredAt' | 'eventId'>): string => `${e.occurredAt}|${e.eventId}`;

/** One run's events in a stable order. Null when the run is not in this tenant. */
export async function readJourneyEvents(
  organizationId: string,
  executionInstanceId: string,
  options: { after?: string; limit?: number; responses?: JourneyResponsePort } = {},
): Promise<JourneyEventsPage | null> {
  const run = await getExecutionInstance(organizationId, executionInstanceId);
  if (run === null) return null;
  const subject = { kind: run.subjectKind, id: run.subjectId };

  const events: JourneyEvent[] = [];
  const push = (
    type: JourneyEventType,
    source: { table: string; id: string },
    occurredAt: unknown,
    extra: { engine?: string | null; channel?: string | null; code?: string | null; planStepId?: string | null; taskId?: string | null } = {},
  ): void => {
    if (typeof occurredAt !== 'string' && !(occurredAt instanceof Date)) return;
    events.push({
      eventId: eventIdFor(source.table, source.id, type),
      eventVersion: JOURNEY_EVENT_VERSION,
      type,
      organizationId,
      executionInstanceId,
      subject,
      engine: extra.engine ?? null,
      channel: extra.channel ?? null,
      idempotencyKey: extra.taskId == null ? null : executionIdempotencyKey(extra.taskId),
      correlationId: executionCorrelationId(executionInstanceId, extra.planStepId ?? null),
      occurredAt: new Date(occurredAt).toISOString(),
      source,
      code: extra.code ?? null,
      positiveEngagement: POSITIVE_ENGAGEMENT_EVENTS.includes(type),
    });
  };

  push('journey.enrolled', { table: EXECUTION_INSTANCES_TABLE, id: run.id }, run.createdAt);
  if (run.lifecycleState === 'completed') push('journey.completed', { table: EXECUTION_INSTANCES_TABLE, id: run.id }, run.updatedAt);

  const tasks = await listInstanceTasks(organizationId, executionInstanceId);
  const taskByStep = new Map(tasks.map((t) => [t.planStepId, t]));

  for (const d of await listJourneyDecisions(organizationId, executionInstanceId)) {
    push(decisionEventType(d), { table: 'execution_journey_decisions', id: d.id }, d.decidedAt, {
      engine: d.engine, channel: d.channel, code: d.outcome, planStepId: d.planStepId,
      taskId: d.planStepId === null ? null : taskByStep.get(d.planStepId)?.id ?? null,
    });
  }

  // WS-3: the bridge links this run to its outreach tasks.
  const handoffs = await listInstanceHandoffs(organizationId, executionInstanceId);
  for (const h of handoffs) {
    const executionTaskId = String(h.executionTaskId);
    const planStepId = tasks.find((t) => t.id === executionTaskId)?.planStepId ?? null;
    const channel = tasks.find((t) => t.id === executionTaskId)?.channel ?? null;
    const taskId = String(h.outreachTaskId);
    const ctx = { engine: 'ws3', channel: channel === null ? null : String(channel), planStepId, taskId: executionTaskId };
    const scoped = (table: string, columns: string) => ownedDbTable(table).select(columns).eq('company_id', organizationId).eq('task_id', taskId);

    for (const r of await readRows(scoped('outreach_approvals', 'id, decision, decided_at'), 'approvals')) {
      push(r.decision === 'approved' ? 'approval.granted' : 'approval.rejected', { table: 'outreach_approvals', id: String(r.id) }, r.decided_at, { ...ctx, code: String(r.decision) });
    }
    for (const r of await readRows(scoped('outreach_attempts', 'id, outcome, started_at'), 'attempts')) {
      push('execution.started', { table: 'outreach_attempts', id: String(r.id) }, r.started_at, { ...ctx, code: r.outcome == null ? null : String(r.outcome) });
    }
    for (const r of await readRows(scoped('outreach_delivery_evidence', 'id, delivery_status, observed_at'), 'delivery evidence')) {
      const type = DELIVERY_EVENTS[String(r.delivery_status)];
      if (type !== undefined) push(type, { table: 'outreach_delivery_evidence', id: String(r.id) }, r.observed_at, { ...ctx, code: String(r.delivery_status) });
    }
    for (const r of await readRows(scoped('outreach_outcomes', 'id, outcome_type, occurred_at'), 'outcomes')) {
      push(OUTCOME_EVENTS[String(r.outcome_type)] ?? 'response.other', { table: 'outreach_outcomes', id: String(r.id) }, r.occurred_at, { ...ctx, code: String(r.outcome_type) });
    }
  }

  // The engine request ledger: one row per task for engines without their own record.
  if (tasks.length > 0) {
    const ledger = await readRows(
      ownedDbTable('execution_engine_requests').select('id, execution_task_id, engine, state, created_at').eq('organization_id', organizationId).in('execution_task_id', tasks.map((t) => t.id)),
      'engine requests',
    );
    for (const r of ledger) {
      const t = tasks.find((x) => x.id === String(r.execution_task_id));
      push('execution.requested', { table: 'execution_engine_requests', id: String(r.id) }, r.created_at, {
        engine: String(r.engine), channel: t === undefined ? null : String(t.channel), code: String(r.state),
        planStepId: t?.planStepId ?? null, taskId: String(r.execution_task_id),
      });
    }
  }

  // WhatsApp's inbound record, through the same reading that ends a journey.
  const resolved = await resolveSubjectPersonId(organizationId, subject as Parameters<typeof resolveSubjectPersonId>[1]);
  const reply = await (options.responses ?? durableJourneyResponsePort).whatsappReply(organizationId, executionInstanceId, resolved.ok ? resolved.personId : null);
  if (reply !== null) {
    const msg = await readRows(ownedDbTable('engagement_messages').select('id, created_at').eq('thread_id', reply.threadId).eq('platform_message_id', reply.messageId).limit(1), 'messages');
    push(reply.outcome === 'unsubscribed' ? 'response.unsubscribed' : 'response.replied', { table: 'engagement_messages', id: String(msg[0]?.id ?? reply.messageId) }, msg[0]?.created_at, { engine: 'whatsapp', channel: 'whatsapp', code: reply.outcome });
  }

  // PI's verdict, from enrolment on. PI owns these rows; this only reads them.
  if (run.subjectKind === 'prospect') {
    const transitions = await readRows(
      ownedDbTable('prospect_lifecycle_transitions').select('id, state, transitioned_at').eq('organization_id', organizationId).eq('prospect_id', run.subjectId).gte('transitioned_at', run.createdAt),
      'lifecycle transitions',
    );
    for (const r of transitions) {
      push('prospect.lifecycle_changed', { table: 'prospect_lifecycle_transitions', id: String(r.id) }, r.transitioned_at, { code: String(r.state) });
    }
  }

  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  const after = options.after;
  const remaining = after === undefined ? events : events.filter((e) => encodeEventCursor(e) > after);
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const page = remaining.slice(0, limit);
  return {
    contractEventVersion: JOURNEY_EVENT_VERSION,
    events: page,
    cursor: page.length === 0 ? null : encodeEventCursor(page[page.length - 1]!),
    hasMore: remaining.length > page.length,
  };
}
