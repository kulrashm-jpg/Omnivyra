/**
 * Shared message-outcome contract, Deliverable D (Orchestration Prompt 4, Agent C).
 * docs/orchestration/completion/SHARED-MESSAGE-OUTCOME-CONTRACT.md
 *
 * Pins contract 0.3.0 (and the 0.4.0 `response.received`, X-3) across the layers:
 *   raw provider event (a) -> normalized channel outcome (b) -> journey event -> consequence (e).
 * It runs against Agent A's 0.3.0 `journeyEvents.ts` / `executionContract.ts`. On the
 * frozen base (7f2ca186f) alone it fails by design: `isComplaintInferredEvidence`,
 * `journey.suspended` and `record.unmapped` do not exist there.
 *
 * Its focus is the CROSS-LAYER chain that no single owner's suite covers. For example, the
 * evidence the SES adapter actually produces is fed to the journey reader as its
 * `transport_response`. The per-function detail of the reader (marker spelling variants,
 * column selection) is pinned in Agent A's journeyEventsOutcomeMapping.test.ts.
 *
 *   `it`       holds under 0.3.0 as integrated;
 *   `it.todo`  a pending follow-up. Each names its owner; none asserts unagreed behaviour.
 *
 * The SC-7 codes (`sc7-draft-1`) are UNRATIFIED (owner decision SC7-R). They are named as
 * the classification dimension only; nothing here wires them, and no test lets a
 * classifier output drive a journey.
 *
 * Codes only: no address, message content or fact value leaves any fixture.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

type Row = Record<string, unknown>;

const db = { tables: {} as Record<string, Row[]> };

// A table double: chained filters return the builder; awaiting it yields the rows seeded
// in that table. Filters are not evaluated, because each test seeds one run's rows only.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'is']) builder[m] = () => builder;
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve, reject);
    return builder;
  },
}));

const RUN = {
  id: 'run-1', organizationId: 'org-1', subjectKind: 'contact', subjectId: 'contact-1',
  lifecycleState: 'running', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
};
const TASK = { id: 'etask-1', planStepId: 'step-1', channel: 'email' };

jest.mock('../../services/executionInstances/executionInstanceStore', () => ({
  EXECUTION_INSTANCES_TABLE: 'execution_instances',
  getExecutionInstance: async () => RUN,
}));
jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  listInstanceTasks: async () => [TASK],
}));
jest.mock('../../services/outreachBridge/outreachBridgeStore', () => ({
  listInstanceHandoffs: async () => [{ executionTaskId: 'etask-1', outreachTaskId: 'otask-1' }],
}));
jest.mock('../../services/leadOutreachExecution/personAnchor', () => ({
  resolveSubjectPersonId: async () => ({ ok: true, personId: 'person-1' }),
}));
jest.mock('../../services/orchestration/journeyDecisionLog', () => ({
  listJourneyDecisions: async () => decisions,
}));
// The durable port is replaced per call through `options.responses`.
jest.mock('../../services/orchestration/journeyResponses', () => ({
  durableJourneyResponsePort: { ws3Outcomes: async () => [], whatsappReply: async () => null },
}));

let decisions: Row[] = [];

import {
  JOURNEY_EVENT_TYPES, POSITIVE_ENGAGEMENT_EVENTS, type JourneyEvent, type JourneyEventType,
} from '../../services/orchestration/executionContract';
import { isComplaintInferredEvidence, readJourneyEvents } from '../../services/orchestration/journeyEvents';
import { BUSINESS_OUTCOME_TYPES, DELIVERY_STATUSES } from '../../services/leadOutreachExecution/lifecycle';
import { FEEDBACK_SIGNALS } from '../../services/leadOutreachExecution/feedbackIngestion';
import { BUSINESS_OUTCOME_TYPES as CORPUS_BUSINESS_OUTCOME_TYPES } from '../../services/prospectOutcomes/corpus';
import { normalizeSesEvent } from '../../services/providerEvents/sesEventNormalizer';
import {
  CANONICAL_CLASSIFICATION_CODES, CLASSIFICATION_VOCABULARY_VERSION, GOVERNANCE_CLASSIFICATION_CODES,
  GOVERNANCE_PRECEDENCE, detectGovernanceClasses,
} from '../../services/engagementClassification';

const { JOURNEY_EXIT_OUTCOMES } = jest.requireActual('../../services/orchestration/journeyResponses') as {
  JOURNEY_EXIT_OUTCOMES: readonly string[];
};

const noResponses = { ws3Outcomes: async () => [], whatsappReply: async () => null };

/** Events read from one table, for a run seeded with `rows` in that table only. */
async function eventsFrom(table: string, rows: Row[], responses = noResponses): Promise<JourneyEvent[]> {
  db.tables = { [table]: rows };
  const page = await readJourneyEvents('org-1', 'run-1', { responses, limit: 500 });
  if (page === null) throw new Error('run not found');
  return page.events.filter((e) => e.source.table === table);
}

const evidenceRow = (status: string, i = 0, transport_response: unknown = {}): Row =>
  ({ id: `ev-${status}-${i}`, delivery_status: status, observed_at: `2026-11-02T00:00:0${i}.000Z`, transport_response });
const outcomeRow = (type: string, i = 0): Row => ({ id: `oc-${type}-${i}`, outcome_type: type, occurred_at: `2026-11-03T00:00:0${i}.000Z` });
const decisionRow = (decision: string, outcome: string | null, i = 0, planStepId: string | null = 'step-1'): Row => ({
  id: `d-${i}`, executionInstanceId: 'run-1', planStepId, stepKey: planStepId, channel: 'email', engine: null,
  decision, outcome, reasons: [], decidedAt: `2026-11-04T00:00:0${i}.000Z`,
});

const sesPayload = (eventType: string, extra: Row = {}): Row => ({
  eventType,
  mail: { messageId: 'ses-msg-1', destination: ['r@example.test'], timestamp: '2026-11-02T00:00:00.000Z' },
  ...extra,
});
const complaintPayload = () => sesPayload('Complaint', {
  complaint: { timestamp: '2026-11-02T01:00:00.000Z', complainedRecipients: [{ emailAddress: 'r@example.test' }], complaintFeedbackType: 'abuse' },
});
const bouncePayload = (bounceType: string) => sesPayload('Bounce', {
  bounce: { timestamp: '2026-11-02T01:00:00.000Z', bounceType, bouncedRecipients: [{ emailAddress: 'r@example.test' }] },
});

/** What the SES chain would store: the normalizer's signal as delivery_status, its evidence as transport_response. */
function storedFromSes(payload: Row, sns: string): Row {
  const r = normalizeSesEvent(payload, sns);
  if (!r.ok || r.event === null) throw new Error(`fixture did not normalize: ${String(r.failure)}`);
  return evidenceRow(r.event.signal, 1, r.event.evidence);
}

beforeEach(() => { db.tables = {}; decisions = []; });

// ── Layer (b): the normalized vocabularies ─────────────────────────────────

describe('normalized channel outcomes (layer b)', () => {
  it('the delivery axis is the nine statuses of outreach_delivery_status_valid, with no complaint value', () => {
    expect([...DELIVERY_STATUSES]).toEqual([
      'queued', 'dispatched', 'confirmed', 'sent_unverified', 'delivered', 'bounced', 'failed', 'suppressed', 'expired',
    ]);
    expect(DELIVERY_STATUSES as readonly string[]).not.toContain('complained');
  });

  it('the business axis has not gained complained yet: held behind 20270125000001 plus GD-4', () => {
    expect([...BUSINESS_OUTCOME_TYPES]).toEqual([
      'opened', 'clicked', 'replied', 'meeting_booked', 'rejected', 'no_response', 'unsubscribed', 'converted',
    ]);
    expect(BUSINESS_OUTCOME_TYPES as readonly string[]).not.toContain('complained');
  });

  it('PI corpus restates the business vocabulary; the two lists are the same list', () => {
    expect([...CORPUS_BUSINESS_OUTCOME_TYPES]).toEqual([...BUSINESS_OUTCOME_TYPES]);
  });

  it('an anonymous feedback caller can never assert a complaint or a rejection', () => {
    for (const forbidden of ['complained', 'complaint', 'rejected']) {
      expect(FEEDBACK_SIGNALS as readonly string[]).not.toContain(forbidden);
    }
  });

  it.todo('S-1 (Outreach, after 20270125000001 + GD-4): BUSINESS_OUTCOME_TYPES (both copies) gains complained and FEEDBACK_SIGNALS still does not');
});

// ── Layer (a) -> (b): the SES adapter keeps complaint, bounce and failure apart ───

describe('SES raw event -> normalized fact (layer a -> b)', () => {
  it('Complaint: the delivered evidence is marked as an inference, and the restriction is complaint on every channel', () => {
    const r = normalizeSesEvent(complaintPayload(), 'sns-1');
    expect(r.ok).toBe(true);
    expect(r.event?.signal).toBe('delivered');
    expect(r.event?.evidence).toMatchObject({ sesEventType: 'Complaint', deliveryInferredFrom: 'Complaint', complaintFeedbackType: 'abuse' });
    expect(r.event?.governance).toEqual({ type: 'complaint', channel: '*', anchors: 'target_and_person' });
  });

  it('a complaint is never a bounce: no bounced signal, no bounce_hard and no unsubscribe restriction', () => {
    const r = normalizeSesEvent(complaintPayload(), 'sns-2');
    expect(r.event?.signal).not.toBe('bounced');
    expect(r.event?.governance?.type).not.toBe('bounce_hard');
    expect(r.event?.governance?.type).not.toBe('unsubscribe');
  });

  it('a permanent bounce restricts the address on email only; a transient one restricts nothing', () => {
    const perm = normalizeSesEvent(bouncePayload('Permanent'), 'sns-3');
    expect(perm.event?.signal).toBe('bounced');
    expect(perm.event?.governance).toEqual({ type: 'bounce_hard', channel: 'email', anchors: 'target' });
    const transient = normalizeSesEvent(bouncePayload('Transient'), 'sns-4');
    expect(transient.event?.signal).toBe('bounced');
    expect(transient.event?.governance).toBeNull();
  });

  it('PENDING DF-5: an SES Reject is still stored as bounced, with no restriction', () => {
    const r = normalizeSesEvent(sesPayload('Reject', {}), 'sns-5');
    expect(r.event?.signal).toBe('bounced');
    expect(r.event?.governance).toBeNull();
    expect(r.event?.evidence).toMatchObject({ sesEventType: 'Reject' });
  });

  it.todo('DF-5 (Outreach): an SES Reject is stored as failed with code rejected, with no restriction, and reads as delivery.failed');
});

// ── (a) -> (b) -> event: the whole SES chain through the 0.3.0 reader ───────────

describe('SES chain into the journey event view (0.3.0)', () => {
  it('the evidence the SES adapter writes for a Complaint is recognised as complaint-inferred', () => {
    const stored = storedFromSes(complaintPayload(), 'sns-6');
    expect(isComplaintInferredEvidence({ delivery_status: stored.delivery_status, transport_response: stored.transport_response })).toBe(true);
  });

  it('a Complaint yields exactly one delivery.complained and never delivery.confirmed', async () => {
    const events = await eventsFrom('outreach_delivery_evidence', [storedFromSes(complaintPayload(), 'sns-7')]);
    expect(events.map((e) => [e.type, e.code])).toEqual([['delivery.complained', 'complained']]);
    expect(events[0]!.positiveEngagement).toBe(false);
  });

  it('a Delivery and a Bounce from the same adapter are not complaint-inferred', async () => {
    const delivered = storedFromSes(sesPayload('Delivery', { delivery: { timestamp: '2026-11-02T01:00:00.000Z' } }), 'sns-8');
    const bounced = storedFromSes(bouncePayload('Permanent'), 'sns-9');
    for (const row of [delivered, bounced]) {
      expect(isComplaintInferredEvidence({ delivery_status: row.delivery_status, transport_response: row.transport_response })).toBe(false);
    }
    expect((await eventsFrom('outreach_delivery_evidence', [delivered])).map((e) => e.type)).toEqual(['delivery.confirmed']);
    expect((await eventsFrom('outreach_delivery_evidence', [bounced])).map((e) => e.type)).toEqual(['delivery.bounced']);
  });

  it('nothing from the provider evidence reaches the event but the code', async () => {
    const [e] = await eventsFrom('outreach_delivery_evidence', [storedFromSes(complaintPayload(), 'sns-10')]);
    const text = JSON.stringify(e);
    for (const leaked of ['abuse', 'sns-10', 'ses-msg-1', 'r@example.test', 'deliveryInferredFrom']) expect(text).not.toContain(leaked);
  });
});

// ── Layer (b) -> event: every stored value is mapped deliberately ───────────

describe('journey events from delivery evidence (0.3.0)', () => {
  it('every delivery status maps to a declared event type, one event per row, nothing dropped', async () => {
    const produced: Record<string, [JourneyEventType, string | null]> = {};
    for (const status of DELIVERY_STATUSES) {
      const events = await eventsFrom('outreach_delivery_evidence', [evidenceRow(status)]);
      expect(events).toHaveLength(1);
      expect(JOURNEY_EVENT_TYPES).toContain(events[0]!.type);
      produced[status] = [events[0]!.type, events[0]!.code];
    }
    expect(produced).toEqual({
      queued: ['record.unmapped', 'queued'], dispatched: ['record.unmapped', 'dispatched'],
      confirmed: ['execution.accepted', 'confirmed'], sent_unverified: ['execution.accepted', 'sent_unverified'],
      delivered: ['delivery.confirmed', 'delivered'], bounced: ['delivery.bounced', 'bounced'],
      failed: ['delivery.failed', 'failed'], suppressed: ['execution.cancelled', 'suppressed'],
      expired: ['execution.cancelled', 'expired'],
    });
  });

  it('only an observed delivery is delivery.confirmed', async () => {
    for (const status of DELIVERY_STATUSES) {
      const [e] = await eventsFrom('outreach_delivery_evidence', [evidenceRow(status)]);
      if (e!.type === 'delivery.confirmed') expect(status).toBe('delivered');
    }
  });

  it('no delivery status is positive engagement, and none reads as an unsubscribe', async () => {
    for (const status of DELIVERY_STATUSES) {
      const [e] = await eventsFrom('outreach_delivery_evidence', [evidenceRow(status)]);
      expect(e!.positiveEngagement).toBe(false);
      expect(e!.type).not.toBe('response.unsubscribed');
      expect(e!.type).not.toBe('delivery.complained');
    }
  });

  it('a value outside the CHECK is kept as record.unmapped with its own code', async () => {
    const [e] = await eventsFrom('outreach_delivery_evidence', [evidenceRow('provider_new_state')]);
    expect(e).toMatchObject({ type: 'record.unmapped', code: 'provider_new_state', positiveEngagement: false });
  });
});

describe('journey events from business outcomes (0.3.0)', () => {
  it('every outcome_type, including the held complained, maps to a declared event type', async () => {
    const produced: Record<string, JourneyEventType> = {};
    for (const t of [...BUSINESS_OUTCOME_TYPES, 'complained']) {
      const events = await eventsFrom('outreach_outcomes', [outcomeRow(t)]);
      expect(events).toHaveLength(1);
      expect(JOURNEY_EVENT_TYPES).toContain(events[0]!.type);
      expect(events[0]!.code).toBe(t);
      produced[t] = events[0]!.type;
    }
    expect(produced).toEqual({
      opened: 'response.other', clicked: 'response.other', no_response: 'response.other',
      replied: 'response.replied', unsubscribed: 'response.unsubscribed', rejected: 'response.rejected',
      meeting_booked: 'outcome.recorded', converted: 'outcome.recorded',
      complained: 'delivery.complained',
    });
  });

  it('complained is never positive, never a bounce or failure, and never an unsubscribe', async () => {
    const [e] = await eventsFrom('outreach_outcomes', [outcomeRow('complained')]);
    expect(e!.type).toBe('delivery.complained');
    expect(e!.positiveEngagement).toBe(false);
    for (const other of ['delivery.bounced', 'delivery.failed', 'response.unsubscribed']) expect(e!.type).not.toBe(other);
    expect(POSITIVE_ENGAGEMENT_EVENTS).not.toContain('delivery.complained');
  });

  it('only response.replied is positive engagement; suspension and unmapped records never are', () => {
    expect([...POSITIVE_ENGAGEMENT_EVENTS]).toEqual(['response.replied']);
    for (const t of ['journey.suspended', 'record.unmapped', 'approval.revoked'] as const) {
      expect(JOURNEY_EVENT_TYPES).toContain(t);
      expect(POSITIVE_ENGAGEMENT_EVENTS).not.toContain(t);
    }
  });

  it('an unknown stored outcome is record.unmapped, never coerced to a known one', async () => {
    const [e] = await eventsFrom('outreach_outcomes', [outcomeRow('not_a_type')]);
    expect(e).toMatchObject({ type: 'record.unmapped', code: 'not_a_type', positiveEngagement: false });
  });

  it.todo('S-1 (contract owner, with Outreach): once the complained outcome row is written, one SES complaint yields delivery.complained once per provider event id, not once from the evidence row and again from the outcome row');
});

describe('journey events from the WhatsApp inbound reading', () => {
  const port = (outcome: 'inbound_unclassified' | 'unsubscribed') => ({
    ws3Outcomes: async () => [], whatsappReply: async () => ({ outcome, messageId: 'wamid-1', threadId: 'thread-1' }),
  });

  it('a whole-message opt-out keyword is response.unsubscribed, not positive', async () => {
    const [e] = await eventsFrom('engagement_messages', [{ id: 'msg-1', created_at: '2026-11-04T00:00:00.000Z' }], port('unsubscribed'));
    expect(e).toMatchObject({ type: 'response.unsubscribed', positiveEngagement: false, channel: 'whatsapp', code: 'unsubscribed' });
  });

  // Contract 0.4.0 (X-3). Was PENDING DF-6: `response.replied`, positiveEngagement true.
  it('every other inbound WhatsApp message is response.received, code unclassified, never positive', async () => {
    const [e] = await eventsFrom('engagement_messages', [{ id: 'msg-2', created_at: '2026-11-04T00:00:00.000Z' }], port('inbound_unclassified'));
    expect(e).toMatchObject({ type: 'response.received', code: 'unclassified', positiveEngagement: false, channel: 'whatsapp' });
    expect(e!.type).not.toBe('response.replied');
  });

  it.todo('After SC7-R (owner): a WhatsApp message the deterministic detector classes complaint is never response.replied or positive engagement');
  it.todo('DF-7 / P-6 (Outreach raw status, Orchestration reader): a WhatsApp failure observed after the step settled yields delivery.failed, and an unmapped Meta status is kept as record.unmapped with no consequence');
});

// ── Contract 0.4.0: one stated meaning per channel (Outreach condition (c)) ──────

describe('the 4-way reply mapping (contract 0.4.0)', () => {
  const wa = (outcome: 'inbound_unclassified' | 'unsubscribed') => ({
    ws3Outcomes: async () => [], whatsappReply: async () => ({ outcome, messageId: `wamid-${outcome}`, threadId: 'thread-1' }),
  });
  const MSG = [{ id: 'msg-4', created_at: '2026-11-04T00:00:00.000Z' }];

  it('email, WhatsApp STOP, WhatsApp plain inbound and an operator-recorded reply each map to one event', async () => {
    // Email: no automated inbound exists; SES delivers delivery facts only.
    const [email] = await eventsFrom('outreach_delivery_evidence', [storedFromSes(sesPayload('Delivery', { delivery: { timestamp: '2026-11-02T01:00:00.000Z' } }), 'sns-4way')]);
    const [stop] = await eventsFrom('engagement_messages', MSG, wa('unsubscribed'));
    const [plain] = await eventsFrom('engagement_messages', MSG, wa('inbound_unclassified'));
    // Operator-recorded: POST /api/outreach/outcomes writes a WS-3 `replied` outcome row.
    const [operator] = await eventsFrom('outreach_outcomes', [outcomeRow('replied')]);

    expect([email, stop, plain, operator].map((e) => [e!.type, e!.code, e!.positiveEngagement])).toEqual([
      ['delivery.confirmed', 'delivered', false],
      ['response.unsubscribed', 'unsubscribed', false],
      ['response.received', 'unclassified', false],
      ['response.replied', 'replied', true],
    ]);
    // An opt-out keyword is never classed as received; only the human-recorded reply is positive.
    expect(stop!.type).not.toBe('response.received');
    expect([email, stop, plain].some((e) => e!.positiveEngagement)).toBe(false);
  });

  it('response.received is declared, and only response.replied is positive engagement', () => {
    expect(JOURNEY_EVENT_TYPES).toContain('response.received');
    expect([...POSITIVE_ENGAGEMENT_EVENTS]).toEqual(['response.replied']);
  });
});

// ── Layer (d) -> (e): consequences ─────────────────────────────────────────

describe('journey consequence (layers d and e)', () => {
  it('a run-level exited decision is journey.terminated, whatever ended it', async () => {
    decisions = [decisionRow('exited', 'complained', 0, null)];
    const events = await eventsFrom('execution_journey_decisions', []);
    expect(events.map((e) => [e.type, e.code])).toEqual([['journey.terminated', 'complained']]);
  });

  it('an unclassified reply or a revocation suspends the run; the suspension is never an end', async () => {
    decisions = [
      decisionRow('needs_human', 'reply_awaiting_evaluation:whatsapp', 0),
      decisionRow('needs_human', 'approval_revoked:otask-1', 1),
      decisionRow('needs_human', 'running_step_unattended', 2),
    ];
    const events = await eventsFrom('execution_journey_decisions', []);
    expect(events.map((e) => e.type)).toEqual(['journey.suspended', 'journey.suspended', 'decision.recorded']);
    for (const e of events) expect(['journey.terminated', 'journey.completed']).not.toContain(e.type);
  });

  it('every exit outcome is a real business outcome (or the held complained); the hard exits stay', () => {
    for (const o of JOURNEY_EXIT_OUTCOMES) expect([...BUSINESS_OUTCOME_TYPES, 'complained']).toContain(o);
    for (const o of ['unsubscribed', 'rejected']) expect(JOURNEY_EXIT_OUTCOMES).toContain(o);
  });

  // Implemented in Prompt 4 and proven elsewhere:
  //   Q-C1 termination and the new-journey refusal: realschema/p4_governance_precedence.test.ts
  //     and p4_governance_whatsapp.test.ts; unit/p4GovernancePrecedence.test.ts.
  //   Unclassified reply suspends: realschema/p4_reply_suspension.test.ts.
  //   RV-1 suspends for review: realschema/p4_governance_precedence.test.ts and
  //     orch_c4_approval_revoked.test.ts; unit/p4GovernancePrecedence.test.ts.
  it.todo('PI: a complained outcome reaches the lifecycle feed with the disposition PI chooses (journeyFeedback.ts:35 omits it today)');
});

// ── Layer (c): the classification dimension (SC-7, UNRATIFIED) ───────────────

describe('message classification dimension, sc7-draft-1 (UNRATIFIED, SC7-R open)', () => {
  it('is the draft vocabulary: 16 codes, three of them governance', () => {
    expect(CLASSIFICATION_VOCABULARY_VERSION).toBe('sc7-draft-1');
    expect(CANONICAL_CLASSIFICATION_CODES).toHaveLength(16);
    expect([...GOVERNANCE_CLASSIFICATION_CODES].sort()).toEqual(['complaint', 'stop', 'unsubscribe']);
  });

  it('governance precedence is complaint > stop > unsubscribe', () => {
    expect([...GOVERNANCE_PRECEDENCE]).toEqual(['complaint', 'stop', 'unsubscribe']);
  });

  it('when all three are present they are all returned, most restrictive first', () => {
    const d = detectGovernanceClasses({ text: 'please unsubscribe me. stop emailing me. this is spam', channel: 'email' });
    expect([...d.codes]).toEqual(['complaint', 'stop', 'unsubscribe']);
  });

  it('a provider complaint signal outranks a List-Unsubscribe signal on the same message', () => {
    const d = detectGovernanceClasses({ text: '', channel: 'email', signals: { listUnsubscribe: true, providerComplaint: true } });
    expect([...d.codes]).toEqual(['complaint', 'unsubscribe']);
    expect(d.matches.map((m) => m.basis)).toEqual(['channel_signal', 'channel_signal']);
  });

  it('stop outranks unsubscribe, and the classes stay distinct', () => {
    const d = detectGovernanceClasses({ text: 'unsubscribe me and stop texting me', channel: 'sms' });
    expect([...d.codes]).toEqual(['stop', 'unsubscribe']);
  });

  it('evidence names the rule, never the message text', () => {
    const d = detectGovernanceClasses({ text: 'this is spam', channel: 'whatsapp' });
    for (const m of d.matches) expect(m.rule).not.toContain('this is spam');
  });
});
