/**
 * Contract 0.3.0: the delivery and outcome mapping of the journey event view, the
 * complaint marker (P-1, option E), "nothing dropped" (Q-C4) and `journey.suspended`.
 *
 * Pure: every store the view reads is an in-memory table that honours the columns
 * selected and the tenant filters. The stored-row proof of the complaint marker is
 * realschema/orch_c4_approval_revoked.test.ts ("the complaint marker").
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockDecisions: Row[] = [];

jest.mock('../../db/writeOwner', () => {
  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let columns = '*';
    const q = {
      select(c: string) { columns = c; return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
      gte(c: string, v: string) { filters.push((r) => String(r[c]) >= v); return q; },
      limit() { return q; },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        const cols = columns.split(',').map((c) => c.trim());
        const data = (mockTables[table] ?? []).filter((r) => filters.every((f) => f(r)))
          .map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { __esModule: true, ownedDbTable: (t: string) => builder(t) };
});

const ORG = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-0000000000a1';
const EXEC_TASK = '00000000-0000-4000-8000-0000000000e1';
const OUTREACH_TASK = '00000000-0000-4000-8000-0000000000f1';

jest.mock('../../services/executionInstances/executionInstanceStore', () => ({
  EXECUTION_INSTANCES_TABLE: 'execution_instances',
  getExecutionInstance: jest.fn(async (org: string, id: string) => (org === ORG && id === RUN
    ? { id: RUN, subjectKind: 'lead', subjectId: 'lead-1', lifecycleState: 'active', createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z' }
    : null)),
}));
jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  listInstanceTasks: jest.fn(async () => [{ id: EXEC_TASK, planStepId: 'step-1', channel: 'email' }]),
}));
jest.mock('../../services/outreachBridge/outreachBridgeStore', () => ({
  listInstanceHandoffs: jest.fn(async () => [{ executionTaskId: EXEC_TASK, outreachTaskId: OUTREACH_TASK }]),
}));
jest.mock('../../services/leadOutreachExecution/personAnchor', () => ({ resolveSubjectPersonId: jest.fn(async () => ({ ok: false })) }));
jest.mock('../../services/orchestration/journeyDecisionLog', () => ({ listJourneyDecisions: jest.fn(async () => mockDecisions) }));
jest.mock('../../services/orchestration/journeyResponses', () => ({ durableJourneyResponsePort: { whatsappReply: async () => null } }));

import { isComplaintInferredEvidence, readJourneyEvents } from '../../services/orchestration/journeyEvents';
import { POSITIVE_ENGAGEMENT_EVENTS, type JourneyEvent } from '../../services/orchestration/executionContract';

const MARKER = { sesEventType: 'Complaint', complaintFeedbackType: 'abuse', deliveryInferredFrom: 'Complaint', snsMessageId: 'sns-1' };
let seq = 0;
const evidence = (delivery_status: string, transport_response: unknown = {}): Row => {
  seq += 1;
  return {
    id: `ev-${String(seq).padStart(3, '0')}`, company_id: ORG, task_id: OUTREACH_TASK, delivery_status,
    observed_at: `2030-01-02T00:00:${String(seq).padStart(2, '0')}.000Z`, transport_response,
  };
};
const outcome = (outcome_type: string): Row => {
  seq += 1;
  return { id: `oc-${String(seq).padStart(3, '0')}`, company_id: ORG, task_id: OUTREACH_TASK, outcome_type, occurred_at: `2030-01-03T00:00:${String(seq).padStart(2, '0')}.000Z` };
};
const decision = (d: string, out: string | null): Row => {
  seq += 1;
  return { id: `jd-${seq}`, executionInstanceId: RUN, planStepId: 'step-1', stepKey: 'intro', channel: 'email', engine: 'ws3', decision: d, outcome: out, reasons: [], decidedAt: `2030-01-04T00:00:${String(seq).padStart(2, '0')}.000Z` };
};
const read = async (): Promise<readonly JourneyEvent[]> => (await readJourneyEvents(ORG, RUN))!.events;
const bySource = async (table: string) => (await read()).filter((e) => e.source.table === table).map((e) => [e.type, e.code]);

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockDecisions.length = 0;
  seq = 0;
});

describe('isComplaintInferredEvidence: fails toward complaint, never throws', () => {
  const yes = (transport_response: unknown, delivery_status: unknown = 'delivered') =>
    expect(isComplaintInferredEvidence({ delivery_status, transport_response })).toBe(true);
  const no = (transport_response: unknown, delivery_status: unknown = 'delivered') =>
    expect(isComplaintInferredEvidence({ delivery_status, transport_response })).toBe(false);

  it("the writer's exact shape is a complaint", () => yes(MARKER));
  it('the marker alone is enough', () => yes({ deliveryInferredFrom: 'Complaint' }));

  it('an unexpected delivery status with the marker is still a complaint', () => {
    for (const s of ['bounced', 'queued', 'confirmed', 'failed', 'not_a_status', '', null, undefined, 42]) yes(MARKER, s);
  });

  it('extra and malformed keys do not hide the marker', () => {
    yes({ ...MARKER, extra: { nested: true }, 'odd key': null, '': 1 });
    yes({ deliveryInferredFrom: 'Complaint', sesEventType: 42, complaintFeedbackType: ['x'] });
  });

  it('a JSON string, or a doubly encoded one, instead of an object', () => {
    yes(JSON.stringify(MARKER));
    yes(JSON.stringify(JSON.stringify(MARKER)));
  });

  it('text that is not JSON but names the marker', () => yes('deliveryInferredFrom=Complaint; truncated {'));

  it('case and spelling variants of the key and the value', () => {
    for (const v of ['complaint', 'COMPLAINT', ' Complaint ', 'Complaint:abuse', ['Complaint']]) yes({ deliveryInferredFrom: v });
    for (const k of ['DeliveryInferredFrom', 'deliveryinferredfrom', 'delivery_inferred_from', 'delivery-inferred-from']) yes({ [k]: 'Complaint' });
  });

  it('a row written before D7 (no marker, the SES type only) is a complaint', () => {
    yes({ sesEventType: 'Complaint', snsMessageId: 'sns-0' });
    yes({ SesEventType: 'complaint' });
  });

  it('no marker is not a complaint', () => {
    for (const r of [{}, { sesEventType: 'Delivery' }, { deliveryInferredFrom: 'Bounce' }, { outcome: 'complaint' }, [], ['Complaint'], 'garbage', '', null, undefined, 7, true]) no(r);
    no(JSON.stringify({ sesEventType: 'Bounce', bounceType: 'Permanent' }));
  });

  it('a hostile value cannot make it throw, and an unreadable row counts as a complaint', () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
    expect(() => isComplaintInferredEvidence({ delivery_status: 'delivered', transport_response: hostile })).not.toThrow();
    yes(hostile);
    const getter = Object.defineProperty({}, 'deliveryInferredFrom', { enumerable: true, get() { throw new Error('boom'); } });
    expect(() => isComplaintInferredEvidence({ delivery_status: 'delivered', transport_response: getter })).not.toThrow();
    yes(getter);
    expect(() => isComplaintInferredEvidence(null as unknown as { delivery_status: unknown })).not.toThrow();
    expect(isComplaintInferredEvidence({ delivery_status: 'delivered' })).toBe(false);
  });
});

describe('delivery evidence: every stored status, mapped deliberately', () => {
  it('only an observed delivery is delivery.confirmed; acceptance, suppression and expiry are execution facts', async () => {
    mockTables.outreach_delivery_evidence = ['queued', 'dispatched', 'confirmed', 'sent_unverified', 'delivered', 'bounced', 'failed', 'suppressed', 'expired']
      .map((s) => evidence(s));
    expect(await bySource('outreach_delivery_evidence')).toEqual([
      ['record.unmapped', 'queued'],
      ['record.unmapped', 'dispatched'],
      ['execution.accepted', 'confirmed'],
      ['execution.accepted', 'sent_unverified'],
      ['delivery.confirmed', 'delivered'],
      ['delivery.bounced', 'bounced'],
      ['delivery.failed', 'failed'],
      ['execution.cancelled', 'suppressed'],
      ['execution.cancelled', 'expired'],
    ]);
  });

  it('a status outside the CHECK is never dropped: record.unmapped with its own code', async () => {
    mockTables.outreach_delivery_evidence = [evidence('something_new')];
    expect(await bySource('outreach_delivery_evidence')).toEqual([['record.unmapped', 'something_new']]);
  });

  it('a complaint-inferred delivered row is delivery.complained, once, never delivery.confirmed', async () => {
    mockTables.outreach_delivery_evidence = [evidence('delivered', { sesEventType: 'Delivery', snsMessageId: 'sns-d' }), evidence('delivered', MARKER)];
    expect(await bySource('outreach_delivery_evidence')).toEqual([['delivery.confirmed', 'delivered'], ['delivery.complained', 'complained']]);
  });

  it('nothing of transport_response reaches an event but the verdict', async () => {
    mockTables.outreach_delivery_evidence = [evidence('delivered', { ...MARKER, recipient: 'person@example.test', diagnostic: 'SMTP 550 text' })];
    const text = JSON.stringify(await read());
    for (const s of ['person@example.test', 'SMTP 550', 'abuse', 'sns-1', 'transport_response']) expect(text).not.toContain(s);
  });
});

describe('outcomes: every stored type, mapped deliberately', () => {
  it('opened, clicked and no_response stay response.other; an unknown type is record.unmapped', async () => {
    mockTables.outreach_outcomes = ['replied', 'unsubscribed', 'rejected', 'complained', 'meeting_booked', 'converted', 'opened', 'clicked', 'no_response', 'brand_new']
      .map(outcome);
    expect(await bySource('outreach_outcomes')).toEqual([
      ['response.replied', 'replied'], ['response.unsubscribed', 'unsubscribed'], ['response.rejected', 'rejected'],
      ['delivery.complained', 'complained'], ['outcome.recorded', 'meeting_booked'], ['outcome.recorded', 'converted'],
      ['response.other', 'opened'], ['response.other', 'clicked'], ['response.other', 'no_response'],
      ['record.unmapped', 'brand_new'],
    ]);
  });
});

describe('journey.suspended', () => {
  it('a needs_human decision for an unclassified reply or a revocation suspends; nothing else does', async () => {
    mockDecisions.push(
      decision('needs_human', 'reply_awaiting_evaluation:whatsapp'),
      decision('needs_human', 'approval_revoked:task-1'),
      decision('needs_human', 'provider_refused_prior_attempt'),
      decision('needs_human', 'approval_revoked'),
      decision('waiting', 'approval_revoked:task-1'),
      decision('needs_human', null),
    );
    expect(await bySource('execution_journey_decisions')).toEqual([
      ['journey.suspended', 'reply_awaiting_evaluation:whatsapp'],
      ['journey.suspended', 'approval_revoked:task-1'],
      ['decision.recorded', 'provider_refused_prior_attempt'],
      ['decision.recorded', 'approval_revoked'],
      ['decision.recorded', 'approval_revoked:task-1'],
      ['decision.recorded', null],
    ]);
  });

  it('a suspension, an unmapped record and a complaint are never positive engagement', async () => {
    mockDecisions.push(decision('needs_human', 'approval_revoked:t'));
    mockTables.outreach_delivery_evidence = [evidence('queued'), evidence('delivered', MARKER)];
    for (const e of await read()) expect(e.positiveEngagement).toBe(e.type === 'response.replied');
    expect(POSITIVE_ENGAGEMENT_EVENTS).toEqual(['response.replied']);
  });
});
