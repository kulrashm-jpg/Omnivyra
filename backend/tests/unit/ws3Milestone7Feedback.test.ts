/**
 * WS-3 Milestone-7 — Feedback & Intelligence Integration.
 *
 * Two things can go badly wrong here and the tests are weighted accordingly.
 *
 * The first is DOUBLE COUNTING. Providers deliver at-least-once and retry on
 * every non-2xx, so the same reply arrives three or four times as a matter of
 * routine. An ingestion layer that is merely "usually" idempotent reports one
 * reply as four, and every downstream number inherits the error.
 *
 * The second, and worse, is the RETURN ARROW. WS-3 is a one-way pipeline: WS-2
 * plans, WS-3 executes, feedback records what happened. If feedback ever fed
 * back into a score, a replay checkpoint or the fingerprint, the intelligence
 * layer would stop being a function of the lead's own behaviour and start being
 * a function of our outreach — and because the fingerprint deliberately
 * excludes `now`, the corruption would be invisible until someone noticed
 * yesterday's snapshot had changed. The final section asserts the absence of
 * that arrow structurally rather than trusting review to catch it.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
  filtersSeen: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload: Row | null }>,
};

const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items', 'outreach_approvals'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) => st.filters.every(([c, v]) => r[c] === v);

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.filtersSeen.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };

      if (st.op === 'insert') {
        const row = st.payload as Row;

        // The real unique indexes, reproduced exactly.
        if (table === 'outreach_outcomes') {
          const logical = rows().some(
            (r) => r.company_id === row.company_id && r.task_id === row.task_id &&
              r.outcome_type === row.outcome_type && r.occurred_at === row.occurred_at,
          );
          const providerEvent = row.provider_event_id != null && rows().some(
            (r) => r.company_id === row.company_id && r.provider === row.provider && r.provider_event_id === row.provider_event_id,
          );
          if (logical || providerEvent) return { data: null, error: { code: '23505', message: 'duplicate outcome' } };
        }
        if (table === 'outreach_delivery_evidence') {
          const logical = rows().some(
            (r) => r.company_id === row.company_id && r.task_id === row.task_id &&
              r.delivery_status === row.delivery_status && r.observed_at === row.observed_at,
          );
          const providerEvent = row.provider_event_id != null && rows().some(
            (r) => r.company_id === row.company_id && r.provider === row.provider && r.provider_event_id === row.provider_event_id,
          );
          if (logical || providerEvent) return { data: null, error: { code: '23505', message: 'duplicate delivery evidence' } };
        }
        if (table === 'outreach_tasks') {
          if (rows().some((r) => r.company_id === row.company_id && r.lead_id === row.lead_id && r.plan_task_id === row.plan_task_id)) {
            return { data: null, error: { code: '23505', message: 'duplicate task' } };
          }
        }

        const created = { ...row, id: `${table}-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) {
          return { data: null, error: { code: '2F004', message: `ws3_append_only: ${table} is append-only; UPDATE is not permitted` } };
        }
        const affected = rows().filter(matches);
        for (const r of affected) Object.assign(r, st.payload);
        return { data: affected.map((r) => ({ id: r.id })), error: null };
      }

      if (st.op === 'delete') {
        if (APPEND_ONLY.includes(table)) {
          return { data: null, error: { code: '2F004', message: `ws3_append_only: ${table} is append-only; DELETE is not permitted` } };
        }
        return { data: [], error: null };
      }

      const found = rows().filter(matches);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      gte: () => b,
      is: () => b,
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import { registry } from '../../observability/registry';
import {
  EXECUTION_RUNTIME_VERSION,
  FEEDBACK_SCHEMA_VERSION,
  FEEDBACK_SIGNALS,
  FEEDBACK_SOURCES,
  FEEDBACK_VERSION,
  GOVERNANCE_VERSION,
  OUTREACH_METRICS,
  TRANSLATION_VERSION,
  buildFeedbackEnvelope,
  feedbackAxis,
  ingestFeedback,
  ingestFeedbackBatch,
  insertOutreachTask,
  isFeedbackSignal,
  isFeedbackSource,
  listDeliveryEvidence,
  listOutcomes,
  readTaskFeedback,
  setOutreachTaskState,
  type FeedbackEvent,
  type FeedbackSummaryInput,
  type NewOutreachTask,
  type OutreachTask,
} from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-intro', taskOrder: 1,
  kind: 'outreach', action: 'Send intro email', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Viewed pricing twice',
  requiresApproval: false, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

/** A task already dispatched — the only state feedback can meaningfully arrive for. */
const dispatchedTask = async (over: Partial<NewOutreachTask> = {}): Promise<OutreachTask> => {
  const res = await insertOutreachTask(newTask(over));
  const id = res.data!.id as string;
  await setOutreachTaskState('co-a', id, { status: 'sent', deliveryStatus: 'confirmed' });
  return { ...res.data!, id, status: 'sent', deliveryStatus: 'confirmed' };
};

const event = (over: Partial<FeedbackEvent> & { taskId: string }): FeedbackEvent => ({
  companyId: 'co-a',
  signal: 'replied',
  occurredAt: '2026-08-05T13:00:00.000Z',
  source: 'provider_webhook',
  provider: 'ses',
  ...over,
});

const counterValue = (name: string, labels: Record<string, string>): number => {
  const entry = registry.counterEntries().find(
    (e: { name: string; labels?: Record<string, unknown> }) =>
      e.name === name && Object.entries(labels).every(([k, v]) => String(e.labels?.[k]) === v),
  );
  return entry ? Number((entry as { value: number }).value) : 0;
};

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.filtersSeen = [];
  registry.reset();
});

// ── 1. The feedback vocabulary and its routing ──────────────────────────────

describe('feedback vocabulary', () => {
  it('accepts exactly the nine defined signals and rejects anything else', () => {
    expect([...FEEDBACK_SIGNALS].sort()).toEqual([
      'bounced', 'clicked', 'converted', 'delivered', 'meeting_booked', 'no_response', 'opened', 'replied', 'unsubscribed',
    ]);
    expect(isFeedbackSignal('replied')).toBe(true);
    expect(isFeedbackSignal('exploded')).toBe(false);
    expect(isFeedbackSignal('')).toBe(false);
    expect(isFeedbackSignal(null)).toBe(false);
  });

  it('accepts exactly the six defined sources', () => {
    expect([...FEEDBACK_SOURCES].sort()).toEqual([
      'derived', 'import', 'internal', 'manual', 'provider_poll', 'provider_webhook',
    ]);
    expect(isFeedbackSource('provider_webhook')).toBe(true);
    expect(isFeedbackSource('slack')).toBe(false);
  });

  it('routes delivered/bounced to the delivery axis and everything else to business', () => {
    expect(feedbackAxis('delivered')).toBe('delivery');
    expect(feedbackAxis('bounced')).toBe('delivery');
    for (const s of ['opened', 'clicked', 'replied', 'unsubscribed', 'meeting_booked', 'converted', 'no_response'] as const) {
      expect(feedbackAxis(s)).toBe('business');
    }
  });

  it('keeps unsubscribed distinct from rejected — they are not the same fact', () => {
    // `rejected` is "not interested in this"; `unsubscribed` is "never contact
    // me again". Only the second is a compliance obligation. If they collapsed,
    // the difference would be lost at exactly the moment it matters legally.
    expect(FEEDBACK_SIGNALS).toContain('unsubscribed');
    expect(feedbackAxis('unsubscribed')).toBe('business');
  });
});

// ── 2. Validation ───────────────────────────────────────────────────────────

describe('feedback validation', () => {
  it('rejects an unknown signal without writing anything', async () => {
    const task = await dispatchedTask();
    const res = await ingestFeedback(event({ taskId: String(task.id), signal: 'exploded' as never }));
    expect(res.ok).toBe(false);
    expect(res.rejection).toBe('unknown_signal');
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(0);
    expect(await listDeliveryEvidence('co-a', String(task.id))).toHaveLength(0);
  });

  it('rejects an unknown source', async () => {
    const task = await dispatchedTask();
    const res = await ingestFeedback(event({ taskId: String(task.id), source: 'telepathy' as never }));
    expect(res.rejection).toBe('unknown_source');
  });

  it('rejects an unparseable timestamp', async () => {
    const task = await dispatchedTask();
    const res = await ingestFeedback(event({ taskId: String(task.id), occurredAt: 'yesterday' }));
    expect(res.rejection).toBe('invalid_timestamp');
  });

  it('rejects missing identity', async () => {
    expect((await ingestFeedback(event({ taskId: '' }))).rejection).toBe('missing_identity');
    expect((await ingestFeedback(event({ taskId: 't', companyId: '' }))).rejection).toBe('missing_identity');
  });

  it('normalises the timestamp to ISO-8601 rather than storing what arrived', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), occurredAt: '2026-08-05 13:00:00+00' }));
    const rows = await listOutcomes('co-a', String(task.id));
    expect(rows[0].occurred_at).toBe('2026-08-05T13:00:00.000Z');
  });
});

// ── 3. Tenant isolation ─────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('refuses feedback naming another tenant\'s task', async () => {
    const task = await dispatchedTask();
    const res = await ingestFeedback(event({ taskId: String(task.id), companyId: 'co-b' }));
    // The task resolves under co-a only, so a replayed callback carrying a
    // valid foreign task id writes nothing at all.
    expect(res.ok).toBe(false);
    expect(res.rejection).toBe('task_not_found');
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(0);
  });

  it('scopes every read and write by company_id', async () => {
    const task = await dispatchedTask();
    db.filtersSeen = [];
    await ingestFeedback(event({ taskId: String(task.id) }));

    const reads = db.filtersSeen.filter((f) => f.op === 'select');
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.filters.some(([c]) => c === 'company_id')).toBe(true);

    const inserts = db.filtersSeen.filter((f) => f.op === 'insert');
    // Inserts are scoped by their payload, not by a filter.
    for (const i of inserts) expect(i.payload?.company_id).toBe('co-a');
  });
});

// ── 4. Business-outcome ingestion ───────────────────────────────────────────

describe('business outcome ingestion', () => {
  it('records a reply with full provenance', async () => {
    const task = await dispatchedTask();
    const res = await ingestFeedback(event({
      taskId: String(task.id),
      signal: 'replied',
      providerEventId: 'evt-1',
      evidence: { snippet: 'interested, send times' },
      metadata: { threadId: 'th-9' },
    }));

    expect(res.ok).toBe(true);
    expect(res.axis).toBe('business');
    expect(res.recorded).toEqual({ outcomeType: 'replied' });

    const [row] = await listOutcomes('co-a', String(task.id));
    expect(row.outcome_type).toBe('replied');
    expect(row.source).toBe('provider_webhook');
    expect(row.provider).toBe('ses');
    expect(row.provider_event_id).toBe('evt-1');
    expect(row.evidence).toEqual({ snippet: 'interested, send times' });
    expect(row.metadata).toEqual({ threadId: 'th-9' });
    expect(row.derived).toBe(false);
  });

  it('marks only source=derived records as derived', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'no_response', source: 'derived', provider: null, occurredAt: '2026-08-09T00:00:00.000Z' }));
    await ingestFeedback(event({ taskId: String(task.id), signal: 'replied', source: 'import', provider: null }));

    const rows = await listOutcomes('co-a', String(task.id));
    const byType = Object.fromEntries(rows.map((r) => [r.outcome_type, r]));
    expect(byType.no_response.derived).toBe(true);
    // An imported outcome was observed — just not by us. `derived` and `source`
    // answer different questions and must not be conflated.
    expect(byType.replied.derived).toBe(false);
    expect(byType.replied.source).toBe('import');
  });

  it('never moves the lifecycle from a business outcome', async () => {
    const task = await dispatchedTask();
    const before = (db.tables.outreach_tasks ?? []).find((r) => r.id === task.id);
    const res = await ingestFeedback(event({ taskId: String(task.id), signal: 'replied' }));

    expect(res.ok).toBe(true);
    expect(res.stateAdvanced).toBe(false);
    const after = (db.tables.outreach_tasks ?? []).find((r) => r.id === task.id);
    // A reply does not complete a task and a rejection does not cancel one —
    // those are operator decisions with their own audit trail.
    expect(after?.status).toBe(before?.status);
    expect(after?.delivery_status).toBe(before?.delivery_status);
  });

  it('accepts every business signal', async () => {
    const task = await dispatchedTask();
    const signals = ['opened', 'clicked', 'replied', 'unsubscribed', 'meeting_booked', 'converted', 'no_response'] as const;
    for (const [i, signal] of signals.entries()) {
      const res = await ingestFeedback(event({ taskId: String(task.id), signal, occurredAt: `2026-08-05T1${i}:00:00.000Z`, providerEventId: `e-${i}` }));
      expect([signal, res.ok]).toEqual([signal, true]);
    }
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(signals.length);
  });
});

// ── 5. Delivery-axis ingestion ──────────────────────────────────────────────

describe('delivery axis ingestion', () => {
  it('routes delivered to delivery evidence, not to the outcome table', async () => {
    const task = await dispatchedTask();
    const res = await ingestFeedback(event({ taskId: String(task.id), signal: 'delivered', providerEventId: 'evt-d' }));

    expect(res.axis).toBe('delivery');
    expect(res.recorded).toEqual({ deliveryStatus: 'delivered' });
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(0);

    const [row] = await listDeliveryEvidence('co-a', String(task.id));
    expect(row.delivery_status).toBe('delivered');
    expect(row.source).toBe('provider_webhook');
    expect(row.provider_event_id).toBe('evt-d');
  });

  it('advances the delivery axis and the lifecycle together for a delivered receipt', async () => {
    const task = await dispatchedTask();
    const res = await ingestFeedback(event({ taskId: String(task.id), signal: 'delivered' }));

    expect(res.stateAdvanced).toBe(true);
    const row = (db.tables.outreach_tasks ?? []).find((r) => r.id === task.id);
    expect(row?.delivery_status).toBe('delivered');
    expect(row?.status).toBe('delivered');
  });

  it('maps a bounce to delivery=bounced and lifecycle=failed', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'bounced' }));
    const row = (db.tables.outreach_tasks ?? []).find((r) => r.id === task.id);
    expect(row?.delivery_status).toBe('bounced');
    expect(row?.status).toBe('failed');
  });

  it('KEEPS the evidence when the state transition is refused', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'delivered', occurredAt: '2026-08-05T13:00:00.000Z' }));
    // A late bounce after delivery: delivered → bounced is not a permitted
    // delivery transition.
    const res = await ingestFeedback(event({ taskId: String(task.id), signal: 'bounced', occurredAt: '2026-08-05T14:00:00.000Z' }));

    expect(res.ok).toBe(true);
    expect(res.stateAdvanced).toBe(false);
    expect(res.stateRefusal).toMatch(/delivered → bounced is not permitted/);
    // The observation survives the refusal. Evidence is a fact; the state
    // machine is an interpretation, and losing the first to protect the second
    // is the wrong trade.
    const rows = await listDeliveryEvidence('co-a', String(task.id));
    expect(rows.map((r) => r.delivery_status).sort()).toEqual(['bounced', 'delivered']);
    expect((db.tables.outreach_tasks ?? []).find((r) => r.id === task.id)?.delivery_status).toBe('delivered');
  });

  it('records evidence but refuses state when nothing was ever dispatched', async () => {
    const res0 = await insertOutreachTask(newTask({ planTaskId: 'task-2' }));
    const id = String(res0.data!.id);
    const res = await ingestFeedback(event({ taskId: id, signal: 'delivered' }));

    expect(res.ok).toBe(true);
    expect(res.stateAdvanced).toBe(false);
    expect(res.stateRefusal).toMatch(/no delivery status yet/);
    expect(await listDeliveryEvidence('co-a', id)).toHaveLength(1);
  });
});

// ── 6. Idempotency — the core safety property ───────────────────────────────

describe('idempotency', () => {
  it('collapses an identical webhook replayed verbatim', async () => {
    const task = await dispatchedTask();
    const e = event({ taskId: String(task.id), providerEventId: 'evt-1' });

    const first = await ingestFeedback(e);
    const second = await ingestFeedback(e);
    const third = await ingestFeedback(e);

    expect(first.duplicate).toBe(false);
    expect([second.duplicate, third.duplicate]).toEqual([true, true]);
    // A duplicate is a SUCCESS. An endpoint that 500s on a duplicate teaches
    // the provider to retry harder.
    expect([second.ok, third.ok]).toEqual([true, true]);
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(1);
  });

  it('collapses a provider retry that re-stamps the timestamp', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), providerEventId: 'evt-7', occurredAt: '2026-08-05T13:00:00.000Z' }));
    // Same provider event, different arrival time — the LOGICAL key would miss
    // this; the provider-event key catches it.
    const retry = await ingestFeedback(event({ taskId: String(task.id), providerEventId: 'evt-7', occurredAt: '2026-08-05T13:00:05.000Z' }));

    expect(retry.duplicate).toBe(true);
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(1);
  });

  it('collapses the same observation arriving from two different sources', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), source: 'provider_webhook', providerEventId: 'evt-a' }));
    // Same task, type and instant reported by a poll with no event id — caught
    // by the logical key.
    const poll = await ingestFeedback(event({ taskId: String(task.id), source: 'provider_poll', providerEventId: null }));

    expect(poll.duplicate).toBe(true);
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(1);
  });

  it('does NOT collapse genuinely different observations', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'opened', occurredAt: '2026-08-05T13:00:00.000Z', providerEventId: 'e1' }));
    await ingestFeedback(event({ taskId: String(task.id), signal: 'opened', occurredAt: '2026-08-06T13:00:00.000Z', providerEventId: 'e2' }));
    await ingestFeedback(event({ taskId: String(task.id), signal: 'clicked', occurredAt: '2026-08-06T13:00:00.000Z', providerEventId: 'e3' }));

    // Two opens at different times and one click are three real facts.
    expect(await listOutcomes('co-a', String(task.id))).toHaveLength(3);
  });

  it('deduplicates the delivery axis too', async () => {
    const task = await dispatchedTask();
    const e = event({ taskId: String(task.id), signal: 'delivered' as const, providerEventId: 'evt-d' });
    await ingestFeedback(e);
    const again = await ingestFeedback(e);

    expect(again.duplicate).toBe(true);
    expect(again.stateRefusal).toMatch(/duplicate/);
    expect(await listDeliveryEvidence('co-a', String(task.id))).toHaveLength(1);
  });

  it('isolates provider event ids per tenant', async () => {
    const a = await dispatchedTask();
    const b = await insertOutreachTask(newTask({ companyId: 'co-b', planTaskId: 'task-b' }));
    await setOutreachTaskState('co-b', String(b.data!.id), { status: 'sent', deliveryStatus: 'confirmed' });

    await ingestFeedback(event({ taskId: String(a.id), providerEventId: 'shared-id' }));
    const other = await ingestFeedback(event({ taskId: String(b.data!.id), companyId: 'co-b', providerEventId: 'shared-id' }));

    // The key is (company, provider, event) — one tenant's ids can never
    // suppress another's.
    expect(other.duplicate).toBe(false);
    expect(await listOutcomes('co-b', String(b.data!.id))).toHaveLength(1);
  });
});

// ── 7. Append-only enforcement ──────────────────────────────────────────────

describe('append-only', () => {
  it('offers no update or delete surface for feedback rows', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/feedbackIngestion.ts'), 'utf8');
    expect(src).not.toMatch(/\.update\s*\(/);
    expect(src).not.toMatch(/\.delete\s*\(/);
    expect(src).not.toMatch(/\.upsert\s*\(/);
  });

  it('is refused by the database if one is ever attempted', async () => {
    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => Record<string, (...a: unknown[]) => unknown> };
    const t = ownedDbTable('outreach_outcomes');
    const res = await (t.update({ outcome_type: 'converted' }) as unknown as { eq: (c: string, v: unknown) => PromiseLike<{ error: { message: string } }> }).eq('company_id', 'co-a');
    expect(res.error?.message).toMatch(/append-only/);
  });

  it('leaves earlier records untouched when a later one arrives', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'opened', occurredAt: '2026-08-05T13:00:00.000Z' }));
    const snapshot = JSON.stringify(await listOutcomes('co-a', String(task.id)));
    await ingestFeedback(event({ taskId: String(task.id), signal: 'replied', occurredAt: '2026-08-05T14:00:00.000Z' }));

    const after = await listOutcomes('co-a', String(task.id));
    expect(JSON.stringify(after.slice(0, 1))).toBe(snapshot);
  });
});

// ── 8. Batch ingestion ──────────────────────────────────────────────────────

describe('batch ingestion', () => {
  it('classifies every event and never throws on a mixed batch', async () => {
    const task = await dispatchedTask();
    const id = String(task.id);
    const res = await ingestFeedbackBatch([
      event({ taskId: id, signal: 'delivered', occurredAt: '2026-08-05T13:00:00.000Z', providerEventId: 'd1' }),
      event({ taskId: id, signal: 'opened', occurredAt: '2026-08-05T13:30:00.000Z', providerEventId: 'o1' }),
      event({ taskId: id, signal: 'opened', occurredAt: '2026-08-05T13:30:00.000Z', providerEventId: 'o1' }), // retry
      event({ taskId: id, signal: 'nonsense' as never }),
      event({ taskId: 'ghost', signal: 'replied' }),
    ]);

    expect(res).toMatchObject({ total: 5, accepted: 2, duplicates: 1, rejected: 2 });
  });

  it('processes sequentially so causally ordered events settle in order', async () => {
    const task = await dispatchedTask();
    const id = String(task.id);
    await ingestFeedbackBatch([
      event({ taskId: id, signal: 'delivered', occurredAt: '2026-08-05T13:00:00.000Z' }),
      event({ taskId: id, signal: 'replied', occurredAt: '2026-08-05T14:00:00.000Z' }),
    ]);
    // The second event's state evaluation saw the first event's write.
    expect((db.tables.outreach_tasks ?? []).find((r) => r.id === id)?.status).toBe('delivered');
  });

  it('tolerates an empty or absent batch', async () => {
    expect((await ingestFeedbackBatch([])).total).toBe(0);
    expect((await ingestFeedbackBatch(undefined as never)).total).toBe(0);
  });
});

// ── 9. Failure handling ─────────────────────────────────────────────────────

describe('failure handling', () => {
  it('reports a write failure rather than throwing', async () => {
    const task = await dispatchedTask();
    db.failTable = 'outreach_outcomes';
    const res = await ingestFeedback(event({ taskId: String(task.id) }));
    expect(res.ok).toBe(false);
    expect(res.rejection).toBe('write_failed');
    expect(res.error).toMatch(/connection failure/);
  });

  it('never throws on malformed input', async () => {
    await expect(ingestFeedback(undefined as never)).resolves.toMatchObject({ ok: false });
    await expect(ingestFeedback({} as never)).resolves.toMatchObject({ ok: false });
  });
});

// ── 10. The feedback envelope — purity and determinism ──────────────────────

const summaryInput = (over: Partial<FeedbackSummaryInput> = {}): FeedbackSummaryInput => ({
  companyId: 'co-a',
  leadId: 'L1',
  tasks: [],
  deliveryEvidence: [],
  outcomes: [],
  now: NOW,
  ...over,
});

const deliveryRow = (over: Row = {}): Row => ({
  task_id: 't1', delivery_status: 'delivered', observed_at: '2026-08-05T13:00:00.000Z',
  source: 'provider_webhook', provider: 'ses', ...over,
});

const outcomeRow = (over: Row = {}): Row => ({
  task_id: 't1', outcome_type: 'replied', occurred_at: '2026-08-05T15:00:00.000Z',
  source: 'provider_webhook', provider: 'ses', derived: false, ...over,
});

const task1: OutreachTask = {
  // A3: required field, nullable value. This fixture predates the person anchor,
  // so `null` — never anchored — is the accurate value.
  personId: null,
  id: 't1', companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-intro', taskOrder: 1,
  kind: 'outreach', action: 'Send intro email', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'x', status: 'delivered',
  deliveryStatus: 'delivered', requiresApproval: false, plannerVersion: 'lie-2.1.0',
  translationVersion: TRANSLATION_VERSION, governanceVersion: GOVERNANCE_VERSION,
  executionRuntimeVersion: EXECUTION_RUNTIME_VERSION, materializedAt: NOW,
  createdAt: NOW, updatedAt: NOW,
};

describe('feedback envelope', () => {
  it('is deterministic — identical inputs produce byte-identical output', () => {
    const input = summaryInput({ tasks: [task1], deliveryEvidence: [deliveryRow()], outcomes: [outcomeRow()] });
    expect(JSON.stringify(buildFeedbackEnvelope(input))).toBe(JSON.stringify(buildFeedbackEnvelope(input)));
  });

  it('is order-independent — the same records read back in any order agree', () => {
    const rows = [
      outcomeRow({ outcome_type: 'opened', occurred_at: '2026-08-05T13:30:00.000Z' }),
      outcomeRow({ outcome_type: 'clicked', occurred_at: '2026-08-05T13:30:00.000Z' }),
      outcomeRow({ outcome_type: 'replied' }),
    ];
    const a = buildFeedbackEnvelope(summaryInput({ tasks: [task1], outcomes: rows }));
    const b = buildFeedbackEnvelope(summaryInput({ tasks: [task1], outcomes: [...rows].reverse() }));
    // Two events can share a timestamp to the millisecond; the sort must still
    // be total or the envelope is silently non-deterministic.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('performs no I/O and reads no clock', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/feedbackSummary.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/ownedDbTable|supabase|fetch\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
    expect(src).not.toMatch(/Math\.random/);
    // The single `new Date(0)` is the epoch fallback for an unparseable `now`,
    // not a clock read.
    expect(src).not.toMatch(/new Date\s*\(\s*\)/);
  });

  it('carries its schema and contract versions', () => {
    const env = buildFeedbackEnvelope(summaryInput());
    expect(env.schemaVersion).toBe(FEEDBACK_SCHEMA_VERSION);
    expect(env.feedbackVersion).toBe(FEEDBACK_VERSION);
    expect(env.generatedAt).toBe(NOW);
  });

  it('produces no score, weight, rank or grade anywhere in its output', () => {
    const env = buildFeedbackEnvelope(summaryInput({ tasks: [task1], deliveryEvidence: [deliveryRow()], outcomes: [outcomeRow()] }));
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) { keys.add(k); walk(val); }
      }
    };
    walk(env);
    // The moment a feedback score exists, something downstream consumes it and
    // the one-way pipeline has grown its return arrow through the back door.
    for (const k of keys) expect(k).not.toMatch(/score|weight|rank|grade|priority|confidenceLevel/i);
  });
});

// ── 11. Summary content ─────────────────────────────────────────────────────

describe('summary content', () => {
  it('reports delivery counts over an exposed denominator', () => {
    const env = buildFeedbackEnvelope(summaryInput({
      tasks: [task1],
      deliveryEvidence: [deliveryRow(), deliveryRow({ task_id: 't2', delivery_status: 'bounced', observed_at: '2026-08-05T13:05:00.000Z' })],
    }));
    expect(env.delivery.tasksDispatched).toBe(2);
    expect(env.delivery.delivered).toEqual({ observed: 1, outOf: 2, rate: 0.5 });
    expect(env.delivery.bounced).toEqual({ observed: 1, outOf: 2, rate: 0.5 });
    expect(env.delivery.byStatus.delivered).toBe(1);
    expect(env.delivery.firstDeliveryAt).toBe('2026-08-05T13:00:00.000Z');
  });

  it('reports an UNKNOWN rate, not a zero rate, when the denominator is zero', () => {
    const env = buildFeedbackEnvelope(summaryInput());
    // "0% delivered" and "nothing was ever sent" are different claims.
    expect(env.delivery.delivered).toEqual({ observed: 0, outOf: 0, rate: null });
    expect(env.engagement.engagedTasks.rate).toBeNull();
  });

  it('separates engagement, response and conversion onto their own summaries', () => {
    const env = buildFeedbackEnvelope(summaryInput({
      tasks: [task1],
      deliveryEvidence: [deliveryRow()],
      outcomes: [
        outcomeRow({ outcome_type: 'opened', occurred_at: '2026-08-05T13:10:00.000Z' }),
        outcomeRow({ outcome_type: 'clicked', occurred_at: '2026-08-05T13:20:00.000Z' }),
        outcomeRow({ outcome_type: 'replied', occurred_at: '2026-08-05T15:00:00.000Z' }),
        outcomeRow({ outcome_type: 'unsubscribed', occurred_at: '2026-08-05T16:00:00.000Z' }),
        outcomeRow({ outcome_type: 'meeting_booked', occurred_at: '2026-08-06T09:00:00.000Z' }),
        outcomeRow({ outcome_type: 'converted', occurred_at: '2026-08-10T09:00:00.000Z' }),
      ],
    }));

    expect(env.engagement).toMatchObject({ opened: 1, clicked: 1 });
    expect(env.response).toMatchObject({ replied: 1, unsubscribed: 1, rejected: 0, noResponse: 0 });
    expect(env.conversion).toMatchObject({ meetingsBooked: 1, converted: 1 });
  });

  it('measures hours to first response from the first confirmed delivery', () => {
    const env = buildFeedbackEnvelope(summaryInput({
      tasks: [task1],
      deliveryEvidence: [deliveryRow()],
      outcomes: [outcomeRow({ occurred_at: '2026-08-05T15:30:00.000Z' })],
    }));
    expect(env.response.hoursToFirstResponse).toBe(2.5);
  });

  it('returns null time-to-response when there is no delivery to measure from', () => {
    const env = buildFeedbackEnvelope(summaryInput({ tasks: [task1], outcomes: [outcomeRow()] }));
    expect(env.response.hoursToFirstResponse).toBeNull();
  });

  it('builds a chronological timeline across both axes', () => {
    const env = buildFeedbackEnvelope(summaryInput({
      tasks: [task1],
      deliveryEvidence: [deliveryRow()],
      outcomes: [
        outcomeRow({ outcome_type: 'replied', occurred_at: '2026-08-05T15:00:00.000Z' }),
        outcomeRow({ outcome_type: 'opened', occurred_at: '2026-08-05T13:30:00.000Z' }),
      ],
    }));

    expect(env.timeline.map((e) => [e.at, e.axis, e.type])).toEqual([
      ['2026-08-05T13:00:00.000Z', 'delivery', 'delivered'],
      ['2026-08-05T13:30:00.000Z', 'business', 'opened'],
      ['2026-08-05T15:00:00.000Z', 'business', 'replied'],
    ]);
    // Timeline entries carry the task's identity so an operator can see WHICH
    // message an event belongs to.
    expect(env.timeline[0]).toMatchObject({ taskId: 't1', planTaskId: 'task-1-intro', channel: 'email' });
  });

  it('reports which outcomes this platform cannot observe at all', () => {
    const env = buildFeedbackEnvelope(summaryInput({ tasks: [task1] }));
    expect(env.coverage.unobservable).toEqual(['clicked', 'meeting_booked', 'opened']);
    expect(env.engagement.unobservable.sort()).toEqual(['clicked', 'opened']);
  });

  it('tolerates malformed rows without throwing', () => {
    const env = buildFeedbackEnvelope(summaryInput({
      tasks: [task1],
      deliveryEvidence: [{}, deliveryRow({ observed_at: 'garbage' })],
      outcomes: [{}, outcomeRow({ occurred_at: null })],
    }));
    expect(env.timeline).toEqual([]);
    expect(env.delivery.firstDeliveryAt).toBeNull();
  });
});

// ── 12. Explainability ──────────────────────────────────────────────────────

describe('explainability', () => {
  const full = () => buildFeedbackEnvelope(summaryInput({
    tasks: [task1],
    deliveryEvidence: [deliveryRow()],
    outcomes: [outcomeRow({ outcome_type: 'replied' })],
  }));

  it('explains every summary section', () => {
    expect(full().explainability.map((e) => e.subject).sort()).toEqual([
      'conversion', 'coverage', 'delivery', 'engagement', 'response', 'timeline',
    ]);
  });

  it('answers what, when, why, source and evidence for each', () => {
    for (const e of full().explainability) {
      expect(typeof e.what).toBe('string');
      expect(e.what.length).toBeGreaterThan(0);
      expect(typeof e.why).toBe('string');
      expect(e.why.length).toBeGreaterThan(0);
      expect(Array.isArray(e.source)).toBe(true);
      expect(Object.keys(e.evidence).length).toBeGreaterThan(0);
      expect(e.when === null || !Number.isNaN(Date.parse(e.when))).toBe(true);
    }
  });

  it('names the sources that actually contributed', () => {
    const env = buildFeedbackEnvelope(summaryInput({
      tasks: [task1],
      deliveryEvidence: [deliveryRow({ source: 'provider_webhook' })],
      outcomes: [outcomeRow({ outcome_type: 'replied', source: 'manual' })],
    }));
    expect(env.explainability.find((e) => e.subject === 'delivery')!.source).toEqual(['provider_webhook']);
    expect(env.explainability.find((e) => e.subject === 'response')!.source).toEqual(['manual']);
  });

  it('distinguishes UNOBSERVED from "did not happen"', () => {
    const why = buildFeedbackEnvelope(summaryInput({ tasks: [task1], deliveryEvidence: [deliveryRow()] }))
      .explainability.find((e) => e.subject === 'engagement')!.why;
    // Reporting zero opens without this note misreads missing instrumentation
    // as recipient indifference.
    expect(why).toMatch(/UNOBSERVED/);
    expect(why).toMatch(/instrumentation/);
  });

  it('explains absence of dispatch differently from failure of delivery', () => {
    const e = buildFeedbackEnvelope(summaryInput()).explainability.find((x) => x.subject === 'delivery')!;
    expect(e.what).toMatch(/No task .* has reached a transport/);
    expect(e.why).toMatch(/Absence of dispatch, not failure of delivery/);
  });
});

// ── 13. Telemetry ───────────────────────────────────────────────────────────

describe('telemetry', () => {
  it('counts accepted, duplicate and rejected ingestions separately', async () => {
    const task = await dispatchedTask();
    const e = event({ taskId: String(task.id), providerEventId: 'evt-1' });
    await ingestFeedback(e);
    await ingestFeedback(e);
    await ingestFeedback(event({ taskId: String(task.id), signal: 'nope' as never }));

    expect(counterValue(OUTREACH_METRICS.feedback.result, { result: 'accepted', signal: 'replied' })).toBe(1);
    expect(counterValue(OUTREACH_METRICS.feedback.result, { result: 'duplicate', signal: 'replied' })).toBe(1);
    expect(counterValue(OUTREACH_METRICS.feedback.result, { result: 'rejected', signal: 'unknown' })).toBe(1);
  });

  it('counts the routing decision', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'delivered' }));
    await ingestFeedback(event({ taskId: String(task.id), signal: 'replied' }));
    expect(counterValue(OUTREACH_METRICS.feedback.routed, { axis: 'delivery', signal: 'delivered' })).toBe(1);
    expect(counterValue(OUTREACH_METRICS.feedback.routed, { axis: 'business', signal: 'replied' })).toBe(1);
  });

  it('never labels a metric with an id, address or payload', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/feedbackIngestion.ts'), 'utf8');
    // A reply body is the most sensitive payload in the runtime and a metric
    // label is the last place it may appear.
    expect(src).not.toMatch(/recordFeedback\w+\([^)]*(companyId|taskId|providerEventId|evidence|metadata)/);
  });

  it('cannot break ingestion when the registry throws', async () => {
    const task = await dispatchedTask();
    const spy = jest.spyOn(registry, 'incr').mockImplementation(() => { throw new Error('registry down'); });
    const res = await ingestFeedback(event({ taskId: String(task.id) }));
    spy.mockRestore();
    expect(res.ok).toBe(true);
  });
});

// ── 14. Read-back ───────────────────────────────────────────────────────────

describe('read-back', () => {
  it('returns the durable record for a task, company-scoped', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'delivered', occurredAt: '2026-08-05T13:00:00.000Z' }));
    await ingestFeedback(event({ taskId: String(task.id), signal: 'replied', occurredAt: '2026-08-05T15:00:00.000Z' }));

    const rec = await readTaskFeedback('co-a', String(task.id));
    expect(rec!.deliveryEvidence).toHaveLength(1);
    expect(rec!.outcomes).toHaveLength(1);
    expect(await readTaskFeedback('co-b', String(task.id))).toBeNull();
  });

  it('feeds the envelope straight from stored rows', async () => {
    const task = await dispatchedTask();
    await ingestFeedback(event({ taskId: String(task.id), signal: 'delivered', occurredAt: '2026-08-05T13:00:00.000Z' }));
    await ingestFeedback(event({ taskId: String(task.id), signal: 'replied', occurredAt: '2026-08-05T15:00:00.000Z' }));

    const rec = (await readTaskFeedback('co-a', String(task.id)))!;
    const env = buildFeedbackEnvelope({
      companyId: 'co-a', leadId: 'L1', tasks: [rec.task],
      deliveryEvidence: rec.deliveryEvidence, outcomes: rec.outcomes, now: NOW,
    });
    expect(env.delivery.delivered.observed).toBe(1);
    expect(env.response.replied).toBe(1);
    expect(env.timeline).toHaveLength(2);
  });
});

// ── 15. Backward compatibility ──────────────────────────────────────────────

describe('backward compatibility', () => {
  it('summarises pre-M7 rows that have no source, provider or metadata', () => {
    const env = buildFeedbackEnvelope(summaryInput({
      tasks: [task1],
      deliveryEvidence: [{ task_id: 't1', delivery_status: 'delivered', observed_at: '2026-08-05T13:00:00.000Z' }],
      outcomes: [{ task_id: 't1', outcome_type: 'replied', occurred_at: '2026-08-05T15:00:00.000Z', derived: false }],
    }));
    expect(env.delivery.delivered.observed).toBe(1);
    expect(env.response.replied).toBe(1);
    expect(env.timeline.every((e) => e.source === null)).toBe(true);
    expect(env.explainability.find((e) => e.subject === 'delivery')!.source).toEqual([]);
  });

  it('leaves the M5A/M5B dispatch contract intact', async () => {
    const { appendDeliveryEvidence } = require('../../services/leadOutreachExecution') as {
      appendDeliveryEvidence: (r: Record<string, unknown>) => Promise<{ ok: boolean }>;
    };
    const task = await dispatchedTask();
    // A dispatch-time write that predates M7 supplies neither source nor
    // provider_event_id and must still succeed on `ok` alone.
    const res = await appendDeliveryEvidence({
      companyId: 'co-a', taskId: String(task.id), attemptId: null, deliveryStatus: 'confirmed',
      provider: 'ses', providerMessageId: 'm-1', transportResponse: { accepted: true }, observedAt: NOW,
    });
    expect(res.ok).toBe(true);
  });
});

// ── 16. THE ONE-WAY GUARD ───────────────────────────────────────────────────
//
// The most important section in this milestone. Everything above tests that
// feedback is recorded correctly; this tests that it is recorded and NOTHING
// ELSE — that no arrow returns to WS-2.

describe('one-way pipeline guard', () => {
  const fs = () => require('fs') as typeof import('fs');
  const path = () => require('path') as typeof import('path');

  const WS2_DIRS = [
    'backend/services/leadIntelligenceEngine',
    'backend/services/leadIntelligenceOrchestration',
    'backend/services/qualificationPlanning',
  ];

  const FEEDBACK_FILES = ['feedbackIngestion.ts', 'feedbackSummary.ts'];

  const readAll = (dir: string): Array<{ file: string; src: string }> => {
    const abs = path().join(process.cwd(), dir);
    return fs().readdirSync(abs)
      .filter((f: string) => f.endsWith('.ts'))
      .map((f: string) => ({ file: `${dir}/${f}`, src: fs().readFileSync(path().join(abs, f), 'utf8') }));
  };

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('no WS-2 module imports the outreach execution runtime at all', () => {
    for (const dir of WS2_DIRS) {
      for (const { file, src } of readAll(dir)) {
        // Matches the specifier anywhere in the path, so a deep import cannot
        // slip past a bare-specifier check.
        expect([file, /from\s+['"][^'"]*leadOutreachExecution/.test(stripComments(src))]).toEqual([file, false]);
        expect([file, /require\s*\(\s*['"][^'"]*leadOutreachExecution/.test(stripComments(src))]).toEqual([file, false]);
      }
    }
  });

  it('no WS-2 module references feedback, outcomes or delivery evidence by name', () => {
    for (const dir of WS2_DIRS) {
      for (const { file, src } of readAll(dir)) {
        const code = stripComments(src);
        for (const token of [
          'ingestFeedback', 'buildFeedbackEnvelope', 'FeedbackEnvelope', 'feedbackSummary',
          'outreach_outcomes', 'outreach_delivery_evidence', 'appendOutcome', 'appendDeliveryEvidence',
        ]) {
          expect([file, token, code.includes(token)]).toEqual([file, token, false]);
        }
      }
    }
  });

  it('the replay engine, fingerprint and persistence never see feedback', () => {
    // These four are named individually because they are the exact places a
    // return arrow would do the most damage: replay reconstructs history,
    // fingerprint decides whether the snapshot changed, and persistence is
    // what a well-meaning "just store the outcome too" patch would touch.
    for (const rel of [
      'backend/services/leadIntelligenceEngine/evolutionEngine.ts',
      'backend/services/leadIntelligenceOrchestration/fingerprint.ts',
      'backend/services/leadIntelligenceOrchestration/orchestrator.ts',
      'backend/services/leadIntelligenceOrchestration/persistence.ts',
    ]) {
      const code = stripComments(fs().readFileSync(path().join(process.cwd(), rel), 'utf8'));
      expect([rel, /feedback/i.test(code)]).toEqual([rel, false]);
      expect([rel, /outreach/i.test(code)]).toEqual([rel, false]);
    }
  });

  it('the scoring and recommendation engines never see feedback', () => {
    for (const rel of [
      'backend/services/leadIntelligenceEngine/behaviorAnalysis.ts',
      'backend/services/leadIntelligenceEngine/intentEngine.ts',
      'backend/services/leadIntelligenceEngine/qualificationEngine.ts',
      'backend/services/leadIntelligenceEngine/recommendationEngine.ts',
      'backend/services/qualificationPlanning/outreachPlanner.ts',
      'backend/services/qualificationPlanning/recommendedActions.ts',
    ]) {
      const code = stripComments(fs().readFileSync(path().join(process.cwd(), rel), 'utf8'));
      for (const token of ['ingestFeedback', 'FeedbackEnvelope', 'outreach_outcomes', 'leadOutreachExecution']) {
        expect([rel, token, code.includes(token)]).toEqual([rel, token, false]);
      }
    }
  });

  it('the feedback modules never import a WS-2 scoring, replay or fingerprint module', () => {
    const dir = path().join(process.cwd(), 'backend/services/leadOutreachExecution');
    for (const file of FEEDBACK_FILES) {
      const code = stripComments(fs().readFileSync(path().join(dir, file), 'utf8'));
      for (const banned of [
        'leadIntelligenceEngine', 'leadIntelligenceOrchestration', 'qualificationPlanning',
        'leadIntelligenceActivation', 'leadIntelligenceReadApi',
      ]) {
        expect([file, banned, code.includes(banned)]).toEqual([file, banned, false]);
      }
    }
  });

  it('the feedback modules never write to a WS-2 table', () => {
    const dir = path().join(process.cwd(), 'backend/services/leadOutreachExecution');
    for (const file of FEEDBACK_FILES) {
      const code = stripComments(fs().readFileSync(path().join(dir, file), 'utf8'));
      for (const table of [
        'lead_intelligence_profiles', 'visitor_sessions', 'tracking_events', 'active_leads', 'leads',
      ]) {
        expect([file, table, code.includes(table)]).toEqual([file, table, false]);
      }
    }
  });

  it('the feedback modules trigger no regeneration, replay or planning', () => {
    const dir = path().join(process.cwd(), 'backend/services/leadOutreachExecution');
    for (const file of FEEDBACK_FILES) {
      const code = stripComments(fs().readFileSync(path().join(dir, file), 'utf8'));
      for (const verb of [
        'regenerate', 'recompute', 'rescore', 'replay', 'buildSnapshot', 'assembleSnapshot',
        'computeFingerprint', 'generatePlan', 'planOutreach', 'enqueue',
      ]) {
        expect([file, verb, new RegExp(`\\b${verb}`, 'i').test(code)]).toEqual([file, verb, false]);
      }
    }
  });

  it('the guard is non-vacuous — it fails when a return arrow is introduced', () => {
    // Proof that the assertions above would actually catch a violation rather
    // than passing because the pattern never matches anything.
    const poisoned = "import { buildFeedbackEnvelope } from '../leadOutreachExecution/feedbackSummary';";
    const code = stripComments(poisoned);
    expect(/from\s+['"][^'"]*leadOutreachExecution/.test(code)).toBe(true);
    expect(code.includes('buildFeedbackEnvelope')).toBe(true);

    const poisonedReverse = "import { computeFingerprint } from '../leadIntelligenceOrchestration/fingerprint';";
    expect(stripComments(poisonedReverse).includes('leadIntelligenceOrchestration')).toBe(true);
  });
});
