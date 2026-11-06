/**
 * Orchestration Prompt 5, Agent C: producer -> Orchestration contract compatibility.
 *
 * Each fixture is shaped like what the PRODUCER really emits, and goes through the real
 * producer code into one in-memory store, then through the real Orchestration readers:
 *
 *   SES      SNS `Message` -> ingestSesEvent (real normalizer + real ingestFeedback)
 *            -> outreach_delivery_evidence -> readJourneyEvents / assessJourneyResponse
 *   WhatsApp Meta webhook body -> processWhatsAppWebhookJob (real processor + opt-out)
 *            -> engagement_messages + governance -> readJourneyEvents / assessJourneyResponse
 *            -> feedWhatsAppReplyToLifecycle (the real interpreter; the writer is a fake)
 *   Operator POST /api/outreach/outcomes (the real route + real ingestFeedback)
 *            -> outreach_outcomes -> readJourneyEvents / feedRecentOutcomesToLifecycle
 *
 * `it`         pins what is true on the base (d11f08888) AND must stay true after Agent B's
 *              X-3 change (contract 0.4.0, event version 1): SES, WhatsApp STOP, operator.
 * X-3 block    the WhatsApp PLAIN inbound after Agent B's X-3 change. Written skipped on the
 *              base (where all three failed) and enabled at Prompt 5 integration.
 * GAP-n        pins a CURRENT producer behaviour that is a gap for Outreach to decide
 *              (C-producer-verification.md section 6). Re-pin it if Outreach changes it.
 *
 * Stores are fakes (backend/tests/helpers/fakeWhatsappDb.ts): unique indexes are modelled
 * in the storage doubles below, never proved. Constraint proof is realschema-only.
 * No message text, number or address leaves Orchestration: asserted, not assumed.
 */

export {}; // a module, so its names (Row, ...) do not collide with other script-scope test files

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

type Row = Record<string, unknown>;

// ── one shared in-memory database for producers and readers ────────────────
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../services/whatsappRateLimiter', () => ({ checkAndConsume: jest.fn(), getBroadcastChunkStrategy: jest.fn() }));

// ── canonical governance: the store's identity key, modelled ───────────────
const mockGov = { records: [] as Row[] };
jest.mock('../../services/prospectIdentity/contactGovernanceWriter', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/contactGovernanceWriter');
  return {
    ...actual,
    recordContactGovernance: async (i: Row) => {
      const key = [i.organizationId, i.governanceType, i.channel, i.personId ?? '', i.target ?? ''].join('|');
      const hit = mockGov.records.find((r) => r.key === key);
      if (hit) return { id: key, outcome: 'already_present' };
      mockGov.records.push({ key, ...i });
      return { id: key, outcome: 'created' };
    },
  };
});
jest.mock('../../services/prospectIdentity/contactGovernanceRepository', () => ({
  loadGovernanceRecords: async (l: { organizationId: string; personId: string | null; target: string | null }) => ({
    ok: true,
    records: mockGov.records
      .filter((r) => r.organizationId === l.organizationId)
      .filter((r) => (r.personId != null && r.personId === l.personId) || (r.target != null && r.target === l.target))
      .map((r) => ({ governanceType: r.governanceType, effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveUntil: null })),
  }),
}));
jest.mock('../../services/leadOutreachExecution/unsubscribeService', () => ({ isTerminalGovernanceError: () => false }));

// ── WS-3 storage: the two idempotency keys of each table, modelled ─────────
const OUTREACH_TASK = 'otask-1';
const ORG = 'co-a';
const PERSON = 'person-1';
jest.mock('../../services/leadOutreachExecution/storage', () => {
  const db = () => require('../helpers/fakeWhatsappDb').fakeDb;
  const rows = (t: string): Row[] => (db().tables[t] ??= []);
  let n = 0;
  return {
    getOutreachTaskById: async (companyId: string, taskId: string) => (companyId === 'co-a' && taskId === 'otask-1'
      ? { id: 'otask-1', companyId: 'co-a', personId: 'person-1', channel: 'email', status: 'dispatched', deliveryStatus: 'dispatched' }
      : null),
    advanceOutreachTaskDeliveryStatus: async () => ({ ok: true, changed: true }),
    // uq_outreach_delivery_provider_event + uq_outreach_delivery_logical (20260915000000:81-88)
    appendDeliveryEvidence: async (r: Row) => {
      const dup = rows('outreach_delivery_evidence').some((x) =>
        (r.providerEventId != null && x.company_id === r.companyId && x.provider === r.provider && x.provider_event_id === r.providerEventId)
        || (x.company_id === r.companyId && x.task_id === r.taskId && x.delivery_status === r.deliveryStatus && x.observed_at === r.observedAt));
      if (dup) return { ok: true, duplicate: true };
      n += 1;
      rows('outreach_delivery_evidence').push({
        id: `ev-${n}`, company_id: r.companyId, task_id: r.taskId, delivery_status: r.deliveryStatus, provider: r.provider,
        source: r.source, provider_event_id: r.providerEventId, transport_response: r.transportResponse, observed_at: r.observedAt,
      });
      return { ok: true };
    },
    // outreach_outcomes_idempotent (20260910000000:231) + uq_outreach_outcomes_provider_event (20260915000000:58)
    // + idx_outreach_outcomes_manual_once (20270128000000, N-3: one MANUAL row per company, task, type)
    appendOutcome: async (r: Row) => {
      const dup = rows('outreach_outcomes').some((x) =>
        (x.company_id === r.companyId && x.task_id === r.taskId && x.outcome_type === r.outcomeType && x.occurred_at === r.occurredAt)
        || (r.providerEventId != null && x.company_id === r.companyId && x.provider === r.provider && x.provider_event_id === r.providerEventId)
        || (r.source === 'manual' && x.source === 'manual' && x.company_id === r.companyId && x.task_id === r.taskId && x.outcome_type === r.outcomeType));
      if (dup) return { ok: true, duplicate: true };
      n += 1;
      rows('outreach_outcomes').push({
        id: `oc-${n}`, company_id: r.companyId, task_id: r.taskId, outcome_type: r.outcomeType, derived: r.derived,
        evidence: r.evidence, occurred_at: r.occurredAt, source: r.source, provider: r.provider,
        provider_event_id: r.providerEventId, metadata: r.metadata, created_at: '2030-01-05T00:00:00.000Z',
      });
      return { ok: true };
    },
    listDeliveryEvidence: async () => [],
    listOutcomes: async () => [],
    outcomeTypesFor: async (companyId: string, taskId: string) =>
      rows('outreach_outcomes').filter((x) => x.company_id === companyId && x.task_id === taskId).map((x) => String(x.outcome_type)),
  };
});
jest.mock('../../services/providerEvents/providerMessageResolver', () => ({
  resolveProviderMessage: async () => ({ ok: true, companyId: 'co-a', taskId: 'otask-1', attemptId: 'att-1', matchedRows: 1, failure: null }),
}));
jest.mock('../../services/providerEvents/sesEvidenceReconciliation', () => ({
  recordEvidenceDebt: async () => 'recorded',
  resolveEvidenceDebtIfOpen: async () => undefined,
}));
jest.mock('../../security/TenantGuard', () => ({ requireTenantAccess: async () => ({ userId: 'user-op-1' }) }));
jest.mock('../../services/leadOutreachExecution', () => {
  const f = jest.requireActual('../../services/leadOutreachExecution/feedbackIngestion');
  return { ingestFeedback: f.ingestFeedback, isUnsubscribeScope: f.isUnsubscribeScope, UNSUBSCRIBE_SCOPES: f.UNSUBSCRIBE_SCOPES };
});

// ── the run ────────────────────────────────────────────────────────────────
const RUN = 'run-1';
const EMAIL_TASK = { id: 'etask-email', planStepId: 'step-email', channel: 'email' };
const WA_TASK = { id: 'etask-wa', planStepId: 'step-wa', channel: 'whatsapp' };
const mockRun = { tasks: [] as Row[], handoffs: [] as Row[] };
jest.mock('../../services/executionInstances/executionInstanceStore', () => ({
  EXECUTION_INSTANCES_TABLE: 'execution_instances',
  getExecutionInstance: async (org: string, id: string) => (org === 'co-a' && id === 'run-1'
    ? { id: 'run-1', subjectKind: 'prospect', subjectId: 'prospect-1', lifecycleState: 'active', createdAt: '2029-12-31T00:00:00.000Z', updatedAt: '2029-12-31T00:00:00.000Z' }
    : null),
}));
jest.mock('../../services/executionPlans/executionPlanStore', () => ({ listInstanceTasks: async () => mockRun.tasks }));
jest.mock('../../services/outreachBridge/outreachBridgeStore', () => ({ listInstanceHandoffs: async () => mockRun.handoffs }));
jest.mock('../../services/leadOutreachExecution/personAnchor', () => ({ resolveSubjectPersonId: async () => ({ ok: true, personId: 'person-1' }) }));
jest.mock('../../services/orchestration/journeyDecisionLog', () => ({ listJourneyDecisions: async () => [] }));
jest.mock('../../services/orchestration/whatsappEngineAdapter', () => ({ ENGINE_REQUESTS_TABLE: 'execution_engine_requests' }));

// ── PI: the real interpreter and key builder; the ledger writer is a fake ──
const mockPi = { state: 'engaged' as string | null, rows: [] as Row[] };
jest.mock('../../services/prospectLifecycle', () => {
  const interp = jest.requireActual('../../services/prospectLifecycle/outcomeInterpreter');
  const model = jest.requireActual('../../services/prospectLifecycle/stateModel');
  return {
    interpretOutcome: interp.interpretOutcome,
    sourceEventKey: model.sourceEventKey,
    readCurrentProspectState: async () => (mockPi.state === null ? null : { state: mockPi.state }),
    // uq_prospect_lifecycle_source_event (20261028000000:251) modelled
    recordProspectTransition: async (i: Row) => {
      if (mockPi.rows.some((r) => r.sourceEventKey === i.sourceEventKey)) return { outcome: 'duplicate', wrote: false };
      mockPi.rows.push(i);
      mockPi.state = String(i.to);
      return { outcome: 'moved', wrote: true };
    },
    produceLifecycleFromOutcome: jest.fn(async () => ({ wrote: false, refusal: null })),
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const { fakeDb, resetFakeDb, failNext } = require('../helpers/fakeWhatsappDb');
const { ingestSesEvent } = require('../../services/providerEvents/sesProviderEventIngestion');
const { processWhatsAppWebhookJob } = require('../../queue/jobProcessors/whatsappWebhookProcessor');
const { readJourneyEvents } = require('../../services/orchestration/journeyEvents');
const { assessJourneyResponse } = require('../../services/orchestration/journeyResponses');
const { feedWhatsAppReplyToLifecycle, feedRecentOutcomesToLifecycle, whatsappReplyFingerprint } = require('../../services/orchestration/journeyFeedback');
const { interpretOutcome } = jest.requireActual('../../services/prospectLifecycle/outcomeInterpreter');
const { JOURNEY_EVENT_VERSION } = require('../../services/orchestration/executionContract');
const outcomesRoute = require('../../../pages/api/outreach/outcomes').default;
/* eslint-enable @typescript-eslint/no-var-requires */

interface Ev { eventId: string; eventVersion: number; type: string; code: string | null; engine: string | null; positiveEngagement: boolean; source: { table: string; id: string } }
const events = async (): Promise<Ev[]> => (await readJourneyEvents(ORG, RUN)).events;

// ── SES fixtures: the SNS `Message`, as SES publishes it ───────────────────
const RCPT = 'recipient@example.invalid';
const mail = (id: string) => ({ messageId: id, timestamp: '2030-01-02T00:00:00.000Z', destination: [RCPT] });
const SES = {
  delivery: { eventType: 'Delivery', mail: mail('ses-1'), delivery: { timestamp: '2030-01-02T00:00:05.000Z', recipients: [RCPT] } },
  bounceHard: { notificationType: 'Bounce', mail: mail('ses-2'), bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: RCPT }], timestamp: '2030-01-02T00:00:06.000Z' } },
  bounceSoft: { notificationType: 'Bounce', mail: mail('ses-3'), bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', bouncedRecipients: [{ emailAddress: RCPT }], timestamp: '2030-01-02T00:00:07.000Z' } },
  complaint: { notificationType: 'Complaint', mail: mail('ses-4'), complaint: { complainedRecipients: [{ emailAddress: RCPT }], complaintFeedbackType: 'abuse', timestamp: '2030-01-02T00:00:08.000Z' } },
  reject: { eventType: 'Reject', mail: mail('ses-5'), reject: { reason: 'Bad content' } },
  open: { eventType: 'Open', mail: mail('ses-6'), open: { timestamp: '2030-01-02T00:00:09.000Z' } },
  // An inbound email (SES receipt rule notification): the only shape an email reply could take.
  received: { notificationType: 'Received', mail: mail('ses-7'), receipt: { timestamp: '2030-01-02T00:00:10.000Z', recipients: [RCPT] }, content: 'reply body' },
};

// ── WhatsApp fixtures: the Meta webhook body ───────────────────────────────
const PN = 'pn-1';
const FROM = '15551234567';
const T0 = 1893456000; // 2030-01-01T00:00:00Z, after the run reached out
const waBody = (messages: Row[]) => ({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PN }, messages } }] }] });
const waStop = { from: FROM, id: 'wamid.stop.1', timestamp: String(T0 + 10), type: 'text', text: { body: 'STOP' } };
const PLAIN_TEXT = 'Sounds interesting, call me Tuesday';
const waPlain = { from: FROM, id: 'wamid.plain.1', timestamp: String(T0 + 5), type: 'text', text: { body: PLAIN_TEXT } };
const runJob = (messages: Row[]) => processWhatsAppWebhookJob({ data: { payload: waBody(messages) } });

function seedWhatsAppRun(): void {
  mockRun.tasks = [WA_TASK];
  mockRun.handoffs = [];
  resetFakeDb({
    social_accounts: [{ id: 'sa-1', company_id: ORG, platform: 'whatsapp', phone_number_id: PN, is_active: true }],
    unified_persons: [{ id: PERSON, company_id: ORG, primary_phone: `+${FROM}`, primary_email: null }],
    execution_engine_requests: [{ id: 'req-1', organization_id: ORG, execution_task_id: WA_TASK.id, engine: 'whatsapp', state: 'submitted', external_ref: 'wamid.out.1', created_at: '2029-12-31T12:00:00.000Z' }],
  });
}

function seedEmailRun(): void {
  mockRun.tasks = [EMAIL_TASK];
  mockRun.handoffs = [{ executionTaskId: EMAIL_TASK.id, outreachTaskId: OUTREACH_TASK }];
  resetFakeDb({ unified_persons: [{ id: PERSON, company_id: ORG, primary_phone: null, primary_email: RCPT }] });
}

const logged: string[] = [];
beforeEach(() => {
  mockGov.records.length = 0;
  mockPi.state = 'engaged';
  mockPi.rows.length = 0;
  logged.length = 0;
  for (const m of ['error', 'warn', 'info', 'log'] as const) {
    jest.spyOn(console, m).mockImplementation((...args: unknown[]) => { logged.push(args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a as object)); } catch { return String(a); } }).join(' ')); });
  }
});
afterEach(() => jest.restoreAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
describe('SES producer -> journey events (unchanged by X-3)', () => {
  beforeEach(seedEmailRun);

  it('the four mapped types are ingested; Open is dropped with a 2xx code', async () => {
    for (const [i, p] of [SES.delivery, SES.bounceHard, SES.complaint, SES.reject].entries()) {
      expect((await ingestSesEvent(p, `sns-${i}`)).status).toBe('processed');
    }
    const open = await ingestSesEvent(SES.open, 'sns-open');
    expect(open).toMatchObject({ status: 'dropped', reason: 'unsupported_event_type', eventType: 'Open' });
    expect(fakeDb.tables.outreach_delivery_evidence.map((r: Row) => r.delivery_status)).toEqual(['delivered', 'bounced', 'delivered', 'bounced']);
    expect(fakeDb.tables.outreach_delivery_evidence.every((r: Row) => r.source === 'provider_webhook')).toBe(true);
  });

  it('the event view: confirmed, bounced, complained, bounced; none is positive engagement', async () => {
    for (const [i, p] of [SES.delivery, SES.bounceHard, SES.complaint, SES.reject].entries()) await ingestSesEvent(p, `sns-${i}`);
    const ses = (await events()).filter((e) => e.source.table === 'outreach_delivery_evidence');
    // Ordered by occurredAt: a Reject is stamped with mail.timestamp (the send), so it sorts first.
    expect(ses.map((e) => [e.type, e.code])).toEqual([
      ['delivery.bounced', 'bounced'], ['delivery.confirmed', 'delivered'], ['delivery.bounced', 'bounced'], ['delivery.complained', 'complained'],
    ]);
    expect(ses.every((e) => e.positiveEngagement === false && e.engine === 'ws3' && e.eventVersion === JOURNEY_EVENT_VERSION)).toBe(true);
    expect(JOURNEY_EVENT_VERSION).toBe(1); // EV-1
  });

  it('hard vs soft: only a Permanent bounce writes bounce_hard (address, email); a Transient one is evidence only', async () => {
    await ingestSesEvent(SES.bounceHard, 'sns-h');
    await ingestSesEvent(SES.bounceSoft, 'sns-s');
    expect(mockGov.records.map((r) => [r.governanceType, r.channel, r.personId ?? null])).toEqual([['bounce_hard', 'email', null]]);
    const ev = fakeDb.tables.outreach_delivery_evidence as Row[];
    expect(ev.map((r) => (r.transport_response as Row).bounceType)).toEqual(['Permanent', 'Transient']);
  });

  it('GAP-5: the journey event does not distinguish hard from soft (both `delivery.bounced` / `bounced`)', async () => {
    await ingestSesEvent(SES.bounceHard, 'sns-h');
    await ingestSesEvent(SES.bounceSoft, 'sns-s');
    const b = (await events()).filter((e) => e.source.table === 'outreach_delivery_evidence');
    expect(b.map((e) => [e.type, e.code])).toEqual([['delivery.bounced', 'bounced'], ['delivery.bounced', 'bounced']]);
  });

  it('a complaint writes `complaint` on the address AND the person, every channel, and ends the run', async () => {
    await ingestSesEvent(SES.complaint, 'sns-c');
    expect(mockGov.records.map((r) => [r.governanceType, r.channel, r.personId ?? null])).toEqual([['complaint', '*', null], ['complaint', '*', PERSON]]);
    const v = await assessJourneyResponse(ORG, RUN, PERSON, new Set());
    expect(v).toMatchObject({ consequence: 'exit', outcome: 'complained' });
  });

  it('replay: the same SNS message twice is one evidence row, one restriction, and the same events', async () => {
    const first = await ingestSesEvent(SES.complaint, 'sns-dup');
    const before = await events();
    const second = await ingestSesEvent(SES.complaint, 'sns-dup');
    expect(first).toMatchObject({ status: 'processed', duplicate: false, governance: { created: 2, alreadyPresent: 0 } });
    expect(second).toMatchObject({ status: 'processed', duplicate: true, governance: { created: 0, alreadyPresent: 2 } });
    expect(fakeDb.tables.outreach_delivery_evidence).toHaveLength(1);
    expect(mockGov.records).toHaveLength(2);
    expect(await events()).toEqual(before);
  });

  it('replay under a NEW SNS MessageId (re-published): the logical key collapses it', async () => {
    await ingestSesEvent(SES.bounceHard, 'sns-a');
    const again = await ingestSesEvent(SES.bounceHard, 'sns-b');
    expect(again).toMatchObject({ status: 'processed', duplicate: true });
    expect(fakeDb.tables.outreach_delivery_evidence).toHaveLength(1);
  });

  it('no inbound email is ingested: a `Received` notification is dropped and writes nothing', async () => {
    const r = await ingestSesEvent(SES.received, 'sns-r');
    expect(r).toMatchObject({ status: 'dropped', reason: 'unsupported_event_type', eventType: 'Received' });
    expect(fakeDb.tables.outreach_delivery_evidence ?? []).toHaveLength(0);
    expect(fakeDb.tables.outreach_outcomes ?? []).toHaveLength(0);
    expect((await events()).some((e) => e.type.startsWith('response.'))).toBe(false);
  });

  it('a delivery or bounce does not suspend or end the run', async () => {
    await ingestSesEvent(SES.delivery, 'sns-d');
    await ingestSesEvent(SES.bounceSoft, 'sns-s');
    expect(await assessJourneyResponse(ORG, RUN, PERSON, new Set())).toMatchObject({ consequence: 'continue' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('WhatsApp STOP producer -> journey (unchanged by X-3)', () => {
  beforeEach(seedWhatsAppRun);

  it('the processor writes an unsubscribe restriction on the number and stores the message unlinked', async () => {
    await runJob([waStop]);
    expect(mockGov.records.map((r) => [r.governanceType, r.channel, r.target, r.source])).toEqual([['unsubscribe', 'whatsapp', `+${FROM}`, 'webhook:whatsapp_inbound']]);
    const [msg] = fakeDb.tables.engagement_messages as Row[];
    expect(msg).toMatchObject({ platform: 'whatsapp', platform_message_id: waStop.id, direction: 'inbound', created_at: new Date((T0 + 10) * 1000).toISOString() });
    // No person and no journey link at write time: the link is recomputed from unified_persons.primary_phone.
    for (const k of ['person_id', 'unified_person_id', 'execution_instance_id', 'execution_task_id', 'journey_id', 'prospect_id']) expect(msg).not.toHaveProperty(k);
    expect(fakeDb.tables.engagement_threads[0].platform_thread_id).toBe(`wa:sa-1:${FROM}`);
  });

  it('the event is `response.unsubscribed`, code `unsubscribed`, not positive', async () => {
    await runJob([waStop]);
    const wa = (await events()).filter((e) => e.engine === 'whatsapp' && e.type.startsWith('response.'));
    expect(wa.map((e) => [e.type, e.code, e.positiveEngagement])).toEqual([['response.unsubscribed', 'unsubscribed', false]]);
    expect(wa[0].source.table).toBe('engagement_messages');
  });

  it('the consequence is exit `unsubscribed`, and the STOP identity is carried for PI', async () => {
    await runJob([waStop]);
    const v = await assessJourneyResponse(ORG, RUN, PERSON, new Set());
    expect(v).toMatchObject({ consequence: 'exit', outcome: 'unsubscribed', whatsappReply: { outcome: 'unsubscribed', messageId: waStop.id } });
  });

  it('a STOP outranks an earlier plain message: the run exits, and the STOP event is present', async () => {
    await runJob([waPlain]);
    await runJob([waStop]);
    expect(await assessJourneyResponse(ORG, RUN, PERSON, new Set())).toMatchObject({ consequence: 'exit', outcome: 'unsubscribed' });
    const wa = (await events()).filter((e) => e.engine === 'whatsapp' && e.type.startsWith('response.'));
    expect(wa.map((e) => e.type)).toContain('response.unsubscribed');
    expect(wa.some((e) => e.positiveEngagement)).toBe(false);
  });

  it('re-delivery (the job runs twice): one message row, one restriction, the same event ids', async () => {
    await runJob([waStop]);
    const before = await events();
    await runJob([waStop]);
    expect((fakeDb.tables.engagement_messages as Row[]).filter((m) => m.platform_message_id === waStop.id)).toHaveLength(1);
    expect(mockGov.records).toHaveLength(1);
    expect(await events()).toEqual(before);
  });

  it('PI: a STOP feeds `unsubscribed` once; a re-delivery or a second run of the same person writes no second transition', async () => {
    await runJob([waStop]);
    const feed = () => feedWhatsAppReplyToLifecycle({ organizationId: ORG, prospectId: 'prospect-1', messageId: waStop.id, threadId: 'th', outcome: 'unsubscribed', now: '2030-01-06T00:00:00.000Z' });
    expect((await feed()).wrote).toBe(true);
    expect(await feed()).toEqual({ wrote: false, refusal: 'no-transition' });
    expect(mockPi.rows).toHaveLength(1);
    expect(mockPi.rows[0]).toMatchObject({ to: 'closed_disqualified', origin: 'derived', actorUserId: null });
    // The key's SUFFIX is the message fingerprint. Its PREFIX moves derivation -> evidence under P-2 (Agent B).
    expect(String(mockPi.rows[0].sourceEventKey)).toMatch(new RegExp(`^(derivation|evidence):${whatsappReplyFingerprint(waStop.id)}$`));
  });

  it('PI (P-2 shape): a STOP already recorded under the OLD key, then re-fed, writes nothing (same-state abstain)', async () => {
    mockPi.state = 'closed_disqualified';
    mockPi.rows.push({ sourceEventKey: `derivation:${whatsappReplyFingerprint(waStop.id)}`, to: 'closed_disqualified' });
    const r = await feedWhatsAppReplyToLifecycle({ organizationId: ORG, prospectId: 'prospect-1', messageId: waStop.id, threadId: 'th', outcome: 'unsubscribed', now: '2030-01-06T00:00:00.000Z' });
    expect(r).toEqual({ wrote: false, refusal: 'no-transition' });
    expect(mockPi.rows).toHaveLength(1);
  });

  it('the fingerprint is deterministic and carries no raw id', () => {
    expect(whatsappReplyFingerprint(waStop.id)).toBe(whatsappReplyFingerprint(waStop.id));
    expect(whatsappReplyFingerprint(waStop.id)).toMatch(/^wa-reply-[0-9a-f]{32}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('WhatsApp plain inbound: what holds on the base AND after Agent B', () => {
  beforeEach(seedWhatsAppRun);

  it('a plain message suspends the run (unchanged by X-3)', async () => {
    await runJob([waPlain]);
    const v = await assessJourneyResponse(ORG, RUN, PERSON, new Set());
    expect(v.consequence).toBe('suspend');
    expect(v.replyKey).toMatch(/^[0-9a-f]{32}$/);
    expect(mockGov.records).toHaveLength(0);
  });

  it('the event view never carries the message text, the number or the thread key', async () => {
    await runJob([waPlain]);
    const json = JSON.stringify(await events());
    for (const s of [PLAIN_TEXT, FROM, `wa:sa-1:${FROM}`]) expect(json).not.toContain(s);
  });

  it('the processor logs no message text or number, on success or on a failed write', async () => {
    await runJob([waPlain]);
    failNext('engagement_threads', 'upsert');
    await expect(runJob([{ ...waPlain, id: 'wamid.plain.2' }])).rejects.toThrow();
    const all = logged.join('\n');
    expect(all).not.toContain(PLAIN_TEXT);
    expect(all).not.toContain(FROM);
  });

  it('GAP-7: the text IS persisted by the producer (engagement_messages.content and raw_payload)', async () => {
    await runJob([waPlain]);
    const [msg] = fakeDb.tables.engagement_messages as Row[];
    expect(msg.content).toBe(PLAIN_TEXT);
    expect((msg.raw_payload as Row).text).toEqual({ body: PLAIN_TEXT });
  });
});

// X-3 (Agent B). On the base a plain inbound was labelled `replied`, emitted as
// `response.replied` (positive) and fed to PI as replied -> engaged; these three failed there.
describe('X-3 (after Agent B): a plain WhatsApp inbound is `response.received`, unclassified, never positive, never fed', () => {
  beforeEach(seedWhatsAppRun);

  it('X-3: the event is `response.received`, code `unclassified`, positiveEngagement false', async () => {
    await runJob([waPlain]);
    const wa = (await events()).filter((e) => e.engine === 'whatsapp' && e.type.startsWith('response.'));
    expect(wa.map((e) => [e.type, e.code, e.positiveEngagement])).toEqual([['response.received', 'unclassified', false]]);
  });

  it('X-3: the verdict suspends with the internal label `inbound_unclassified`, never `replied`', async () => {
    await runJob([waPlain]);
    const v = await assessJourneyResponse(ORG, RUN, PERSON, new Set());
    expect(v.consequence).toBe('suspend');
    expect(v.whatsappReply?.outcome).toBe('inbound_unclassified');
    expect(v.outcome).not.toBe('replied');
  });

  it('X-3: a not_interested prospect stays not_interested (nothing is fed)', async () => {
    mockPi.state = 'not_interested';
    await runJob([waPlain]);
    const v = await assessJourneyResponse(ORG, RUN, PERSON, new Set());
    // B narrows feedWhatsAppReplyToLifecycle to `unsubscribed` and the sweeper never calls it for a
    // plain inbound. Even if a caller passed the verdict's label through, nothing may be written.
    // On the base this label is `replied` and the interpreter moves not_interested -> engaged.
    try {
      await feedWhatsAppReplyToLifecycle({ organizationId: ORG, prospectId: 'prospect-1', messageId: waPlain.id, threadId: 'th', outcome: v.whatsappReply?.outcome, now: '2030-01-06T00:00:00.000Z' });
    } catch { /* a narrowed signature may refuse the label outright: also acceptable */ }
    expect(mockPi.rows).toHaveLength(0);
    expect(mockPi.state).toBe('not_interested');
  });
});
// Plain, empty, ambiguous and non-English inbounds: realschema orch_journey_lifecycle "WhatsApp
// responses". STOP and operator replied (Outreach conditions a, b): the blocks above and below.
describe('X-3 contract version (Agent B)', () => {
  it('EXECUTION_CONTRACT_VERSION is 0.4.0 and JOURNEY_EVENT_VERSION stays 1 (EV-1)', () => {
    const c = require('../../services/orchestration/executionContract');
    expect(c.EXECUTION_CONTRACT_VERSION).toBe('0.4.0');
    expect(c.JOURNEY_EVENT_VERSION).toBe(1);
    expect(c.JOURNEY_EVENT_TYPES).toContain('response.received');
    expect(c.POSITIVE_ENGAGEMENT_EVENTS).toEqual(['response.replied']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('operator path: POST /api/outreach/outcomes (unchanged by X-3)', () => {
  beforeEach(seedEmailRun);

  async function post(body: Row): Promise<{ status: number; body: Row }> {
    const out = { status: 0, body: {} as Row };
    const res = {
      status(c: number) { out.status = c; return this; },
      json(b: Row) { out.body = b; return this; },
      setHeader() { return this; },
    };
    await outcomesRoute({ method: 'POST', body, headers: {}, query: {} }, res);
    return out;
  }
  const replied = { companyId: ORG, taskId: OUTREACH_TASK, signal: 'replied', occurredAt: '2030-01-03T10:00:00.000Z' };

  it('provenance: source manual, no provider, no provider event, not derived, the actor from the guard', async () => {
    expect((await post(replied)).status).toBe(200);
    const [row] = fakeDb.tables.outreach_outcomes as Row[];
    expect(row).toMatchObject({ outcome_type: 'replied', source: 'manual', provider: null, provider_event_id: null, derived: false, metadata: { recordedByUserId: 'user-op-1' } });
  });

  it('a client cannot set provenance: a server-owned field is refused', async () => {
    expect(await post({ ...replied, source: 'provider_webhook' })).toMatchObject({ status: 400, body: { error: 'server_owned_field' } });
    expect(fakeDb.tables.outreach_outcomes ?? []).toHaveLength(0);
  });

  it('the event is `response.replied`, code `replied`, positive engagement (Outreach condition b)', async () => {
    await post(replied);
    const r = (await events()).filter((e) => e.source.table === 'outreach_outcomes');
    expect(r.map((e) => [e.type, e.code, e.positiveEngagement, e.engine])).toEqual([['response.replied', 'replied', true, 'ws3']]);
  });

  it('the consequence is suspend (a reply awaits a person), keyed on the outcome row', async () => {
    await post(replied);
    const v = await assessJourneyResponse(ORG, RUN, PERSON, new Set());
    expect(v).toMatchObject({ consequence: 'suspend', outcome: 'replied', whatsappReply: null });
  });

  it('the same report twice (same occurredAt) is one row and one event', async () => {
    await post(replied);
    expect((await post(replied)).body).toMatchObject({ ok: true, duplicate: true });
    expect(fakeDb.tables.outreach_outcomes).toHaveLength(1);
    expect((await events()).filter((e) => e.source.table === 'outreach_outcomes')).toHaveLength(1);
  });

  // GAP-9 closed by Outreach N-3 (96c314795): the database holds one MANUAL row per company, task
  // and type (idx_outreach_outcomes_manual_once), proved on real schema in n4_whatsapp_inbox_retention.
  // Provider, import and internal rows keep their own keys; only source = 'manual' collapses.
  it('N-3: the same reply reported with a different occurredAt is a duplicate, one row and one response.replied', async () => {
    await post(replied);
    expect((await post({ ...replied, occurredAt: '2030-01-03T10:05:00.000Z' })).body).toMatchObject({ ok: true, duplicate: true });
    expect(fakeDb.tables.outreach_outcomes).toHaveLength(1);
    expect((await events()).filter((e) => e.type === 'response.replied')).toHaveLength(1);
  });

  it('PI: the sweep feeds the outcome row by id, and the interpreter keys it `outcome:<id>`', async () => {
    await post(replied);
    const id = String((fakeDb.tables.outreach_outcomes as Row[])[0].id);
    const produce = jest.fn(async () => ({ wrote: false, refusal: null }));
    await feedRecentOutcomesToLifecycle(ORG, '2030-01-05T01:00:00.000Z', { produce });
    await feedRecentOutcomesToLifecycle(ORG, '2030-01-05T02:00:00.000Z', { produce });
    expect(produce.mock.calls.map((c: unknown[]) => (c[0] as Row).outcomeId)).toEqual([id, id]);
    const reading = interpretOutcome({ outcome: { id, type: 'replied' }, currentState: 'nurture' });
    expect(reading).toMatchObject({ kind: 'transition', to: 'engaged', sourceEventKey: `outcome:${id}` });
  });
});
