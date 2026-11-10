/**
 * Orchestration, Follow-up E — every PERSON-initiated way to end a run or enrol a person again
 * passes through the acknowledgement check, and a refusal stops the operation before anything
 * moves. The check itself is a double here (its behaviour is uncertainCommunicationAcknowledgement
 * .test.ts and the real-schema suite); what is proven is the wiring:
 *
 *   POST  /api/execution-instances/:id/progression { action: 'cancel' }      end_run
 *   PATCH /api/execution-instances/:id { lifecycleState: completed|cancelled|failed }  end_run
 *   PATCH /api/execution-instances/:id { evaluation: 'end' }                 end_run
 *   PATCH /api/execution-instances/:id { evaluation: 'opt_out' }             NEVER held (stops contact)
 *   POST  /api/prospect-campaigns/:id/execution-instances                    reenrol
 *   POST  /api/prospect-campaigns/:id/enroll                                 reenrol (per person)
 */
import type { NextApiRequest, NextApiResponse } from 'next';

type Row = Record<string, unknown>;
const ORG = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-000000000101';
const CAMPAIGN = '00000000-0000-4000-8000-0000000000c1';
const WORKFLOW = '00000000-0000-4000-8000-0000000000f1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

const mockCalls: string[] = [];
const mockChecks: Row[] = [];
const mockAuth = { allow: true };
const mockVerdict: { next: Row } = { next: { ok: true, acknowledged: null } };

jest.mock('../../services/orchestration/uncertainCommunicationAcknowledgement', () => ({
  // PI F1: the real shape check (pure); only the database check is a double.
  acknowledgementShapeError: jest.requireActual('../../services/orchestration/uncertainCommunicationAcknowledgement').acknowledgementShapeError,
  checkUncertainAcknowledgement: jest.fn(async (input: Row) => { mockChecks.push(input); mockCalls.push(`check:${String(input.operation)}`); return mockVerdict.next; }),
  acknowledgementRefusalBody: (c: Row) => ('warning' in c ? { error: c.error, code: c.code, warning: c.warning } : { error: c.error, code: c.code }),
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: ACTOR })) }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async (_req: unknown, res: { status: (n: number) => { json: (j: unknown) => void } }) => {
    if (!mockAuth.allow) { res.status(403).json({ error: 'forbidden', code: 'CAPABILITY_DENIED' }); return { ok: false, sent: true }; }
    return { ok: true, principal: { userId: ACTOR } };
  }),
}));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/orchestration/journeyExit', () => ({
  exitJourney: jest.fn(async () => { mockCalls.push('exitJourney'); return 1; }),
  withdrawStepAction: jest.fn(async () => 'none'),
  withdrawUnsentTasks: jest.fn(async () => { mockCalls.push('withdrawUnsentTasks'); }),
}));
jest.mock('../../services/orchestration/journeyDecisionLog', () => ({
  recordPersonDecision: jest.fn(async () => { mockCalls.push('recordPersonDecision'); return false; }),
  listJourneyDecisions: jest.fn(async () => []),
}));
jest.mock('../../services/orchestration/journeyReplyEvaluation', () => ({
  evaluateSuspendedReply: jest.fn(async (i: Row) => { mockCalls.push(`evaluate:${String(i.action)}`); return { ok: true, instance: { id: RUN }, action: i.action, notBefore: null, cancelledSteps: 1, auditFailed: false }; }),
}));
jest.mock('../../services/orchestration/journeyRetiming', () => ({ resumeJourneyWithReturnDate: jest.fn() }));
jest.mock('../../services/executionInstances/executionInstanceStore', () => {
  class ExecutionInstanceError extends Error { constructor(m: string, readonly code: string) { super(m); } }
  return {
    ExecutionInstanceError,
    LIFECYCLE_STATES: ['created', 'queued', 'active', 'paused', 'completed', 'cancelled', 'failed'],
    TERMINAL_LIFECYCLE_STATES: ['completed', 'cancelled', 'failed'],
    SUBJECT_KINDS: ['lead', 'prospect'],
    getExecutionInstance: jest.fn(async () => ({ id: RUN, lifecycleState: 'active' })),
    setExecutionInstanceState: jest.fn(async (i: Row) => { mockCalls.push(`setState:${String(i.lifecycleState)}`); return { id: RUN, lifecycleState: i.lifecycleState }; }),
    compareAndSetExecutionInstanceState: jest.fn(),
    createExecutionInstance: jest.fn(async () => { mockCalls.push('createExecutionInstance'); return { id: 'new-run' }; }),
    listCampaignExecutionInstances: jest.fn(async () => []),
    getOccupiedExecutionInstance: jest.fn(async () => null),
  };
});
jest.mock('../../services/executionPlans/executionPlanStore', () => ({ getPlanForInstance: jest.fn(async () => null), listInstanceTasks: jest.fn(async () => []) }));
jest.mock('../../services/workflowExecution/stepProgressionStore', () => ({
  advanceExecutionRun: jest.fn(), transitionPlanStep: jest.fn(), listProgressionSteps: jest.fn(), getReadyStep: jest.fn(),
  StepProgressionError: class extends Error {}, STEP_STATES: ['pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled'],
}));
jest.mock('../../services/prospectCampaigns/prospectCampaignStore', () => ({ getProspectCampaign: jest.fn(async () => ({ id: CAMPAIGN, status: 'active' })) }));
jest.mock('../../services/orchestration/enrollment', () => ({
  checkEnrollmentEligibility: jest.fn(async () => ({ eligible: true, reasons: [], assessedVersionId: 'v1' })),
}));
jest.mock('../../services/orchestration/campaignEnrollment', () => ({
  enrollCampaignTargets: jest.fn(async (i: Row) => { mockCalls.push('enrollCampaignTargets'); mockChecks.push({ batch: i }); return { outcomes: [] }; }),
  CampaignEnrollmentError: class extends Error {},
}));
jest.mock('../../services/prospectCampaigns/campaignTargetStore', () => ({ CampaignTargetError: class extends Error {} }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

/* eslint-disable @typescript-eslint/no-var-requires */
const progressionRoute = require('../../../pages/api/execution-instances/[id]/progression').default;
const instanceRoute = require('../../../pages/api/execution-instances/[id]').default;
const invokeRoute = require('../../../pages/api/prospect-campaigns/[id]/execution-instances').default;
const enrollRoute = require('../../../pages/api/prospect-campaigns/[id]/enroll').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function call(route: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, id: string, body: Row) {
  const out: { status: number; json: Row } = { status: 0, json: {} };
  const res = {
    setHeader: () => res, status(n: number) { out.status = n; return res; }, json(j: Row) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method, query: { id, company_id: ORG }, body, headers: {}, url: `/api/x/${id}` };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

const HELD = {
  ok: false, status: 409, code: 'uncertain_communication_unacknowledged', error: 'held',
  warning: { operation: 'end_run', executionInstanceId: RUN, communications: [{ requestId: 'r1', reference: 'bcast-1' }], acknowledgementKey: 'k'.repeat(64), historyUnreadable: false, message: 'm', acknowledgementIsNotApproval: true },
};
const UNREADABLE = { ok: false, status: 503, code: 'uncertainty_history_unreadable', error: 'unreadable' };

beforeEach(() => {
  mockCalls.length = 0; mockChecks.length = 0; mockAuth.allow = true;
  mockVerdict.next = { ok: true, acknowledged: null };
});

describe('E wiring: ending a run', () => {
  it('cancel through progression: checked as end_run for THIS run, with the acting person and the sent key', async () => {
    const out = await call(progressionRoute, 'POST', RUN, { action: 'cancel', acknowledgeUncertain: 'abc' });
    expect(out.status).toBe(200);
    expect(mockChecks[0]).toMatchObject({ organizationId: ORG, operation: 'end_run', scope: { kind: 'run', executionInstanceId: RUN }, actorUserId: ACTOR, acknowledgementKey: 'abc', onUnreadable: 'warn' });
    expect(mockCalls).toEqual(['check:end_run', 'exitJourney', 'recordPersonDecision']);
  });

  it('cancel held: 409 with the warning, and the run is NOT ended and no decision is recorded', async () => {
    mockVerdict.next = HELD;
    const out = await call(progressionRoute, 'POST', RUN, { action: 'cancel' });
    expect(out.status).toBe(409);
    expect(out.json).toEqual({ error: 'held', code: 'uncertain_communication_unacknowledged', warning: HELD.warning });
    expect(mockCalls).toEqual(['check:end_run']);
  });

  it('cancel acknowledged: the recorded acknowledgement is returned with the result', async () => {
    mockVerdict.next = { ok: true, acknowledged: { id: 'ack-1', repeated: false } };
    const out = await call(progressionRoute, 'POST', RUN, { action: 'cancel', acknowledgeUncertain: 'k' });
    expect(out.json.acknowledgement).toEqual({ id: 'ack-1', repeated: false });
  });

  it.each(['completed', 'cancelled', 'failed'])('lifecycleState %s is an ending: checked first, held = nothing withdrawn or moved', async (state) => {
    mockVerdict.next = HELD;
    const out = await call(instanceRoute, 'PATCH', RUN, { lifecycleState: state });
    expect(out.status).toBe(409);
    expect(mockCalls).toEqual(['check:end_run']);
    mockVerdict.next = { ok: true, acknowledged: null };
    mockCalls.length = 0;
    expect((await call(instanceRoute, 'PATCH', RUN, { lifecycleState: state, acknowledgeUncertain: 'k' })).status).toBe(200);
    expect(mockCalls).toEqual(['check:end_run', 'withdrawUnsentTasks', `setState:${state}`, 'withdrawUnsentTasks']);
  });

  it('pausing or resuming is not an ending and is never held', async () => {
    mockVerdict.next = HELD;
    expect((await call(instanceRoute, 'PATCH', RUN, { lifecycleState: 'paused' })).status).toBe(200);
    expect(mockChecks).toEqual([]);
  });

  it('the evaluation `end` is an ending: held until acknowledged', async () => {
    mockVerdict.next = HELD;
    expect((await call(instanceRoute, 'PATCH', RUN, { evaluation: 'end' })).status).toBe(409);
    expect(mockCalls).toEqual(['check:end_run']);
  });

  it('an opt_out is NEVER held: stopping contact is not delayed by a warning', async () => {
    mockVerdict.next = HELD;
    const out = await call(instanceRoute, 'PATCH', RUN, { evaluation: 'opt_out' });
    expect(out.status).toBe(200);
    expect(mockChecks).toEqual([]);
    expect(mockCalls).toEqual(['evaluate:opt_out']);
  });

  it('continue and retime are not endings and are never held', async () => {
    mockVerdict.next = HELD;
    await call(instanceRoute, 'PATCH', RUN, { evaluation: 'continue' });
    expect(mockChecks).toEqual([]);
  });

  it('an unreadable history on an ending passes the check\'s own answer through (503 when refused)', async () => {
    mockVerdict.next = UNREADABLE;
    const out = await call(progressionRoute, 'POST', RUN, { action: 'cancel' });
    expect(out).toEqual({ status: 503, json: { error: 'unreadable', code: 'uncertainty_history_unreadable' } });
    expect(mockCalls).toEqual(['check:end_run']);
  });

  it('an unauthorized person never reaches the check: nothing is acknowledged or recorded', async () => {
    mockAuth.allow = false;
    for (const [route, method, body] of [
      [progressionRoute, 'POST', { action: 'cancel', acknowledgeUncertain: 'k' }],
      [instanceRoute, 'PATCH', { lifecycleState: 'cancelled', acknowledgeUncertain: 'k' }],
      [invokeRoute, 'POST', { workflowId: WORKFLOW, subjectKind: 'prospect', subjectId: 'p-1', acknowledgeUncertain: 'k' }],
      [enrollRoute, 'POST', { workflowId: WORKFLOW, acknowledgeUncertainByProspect: { 'p-1': 'k' } }],
    ] as const) {
      expect((await call(route, method, route === progressionRoute || route === instanceRoute ? RUN : CAMPAIGN, body as Row)).status).toBe(403);
    }
    expect(mockChecks).toEqual([]);
    expect(mockCalls).toEqual([]);
  });
});

describe('E wiring: enrolling a person again', () => {
  it('single enrolment: checked as reenrol for this person, campaign and workflow, failing closed on an unreadable history', async () => {
    const out = await call(invokeRoute, 'POST', CAMPAIGN, { workflowId: WORKFLOW, subjectKind: 'prospect', subjectId: 'p-1', acknowledgeUncertain: 'k' });
    expect(out.status).toBe(201);
    expect(mockChecks[0]).toMatchObject({
      organizationId: ORG, operation: 'reenrol', actorUserId: ACTOR, acknowledgementKey: 'k', onUnreadable: 'refuse',
      scope: { kind: 'subject', subjectKind: 'prospect', subjectId: 'p-1', campaignId: CAMPAIGN, workflowId: WORKFLOW },
    });
    expect(mockCalls).toEqual(['check:reenrol', 'createExecutionInstance']);
  });

  it('single enrolment held: no run is created', async () => {
    mockVerdict.next = HELD;
    const out = await call(invokeRoute, 'POST', CAMPAIGN, { workflowId: WORKFLOW, subjectKind: 'prospect', subjectId: 'p-1' });
    expect(out.status).toBe(409);
    expect(out.json.warning).toEqual(HELD.warning);
    expect(mockCalls).toEqual(['check:reenrol']);
  });

  it('batch enrolment passes the AUTHENTICATED person and the per-person keys to the enrolment service', async () => {
    await call(enrollRoute, 'POST', CAMPAIGN, { workflowId: WORKFLOW, acknowledgeUncertainByProspect: { 'p-1': 'k' }, actorUserId: 'spoofed' });
    expect(mockChecks[0]).toEqual({ batch: expect.objectContaining({ organizationId: ORG, actorUserId: ACTOR, acknowledgements: { 'p-1': 'k' } }) });
  });
});

describe('PI review F1: one field, one shape, per route; a wrong shape is refused before anything happens', () => {
  const SHAPE = 'acknowledgement_shape_invalid';
  const scalarRoutes: Array<[string, (req: NextApiRequest, res: NextApiResponse) => unknown, string, string, Row]> = [
    ['progression cancel', progressionRoute, 'POST', RUN, { action: 'cancel' }],
    ['lifecycle end', instanceRoute, 'PATCH', RUN, { lifecycleState: 'cancelled' }],
    ['evaluation end', instanceRoute, 'PATCH', RUN, { evaluation: 'end' }],
    ['single enrolment', invokeRoute, 'POST', CAMPAIGN, { workflowId: WORKFLOW, subjectKind: 'prospect', subjectId: 'p-1' }],
  ];

  it.each(scalarRoutes)('%s: a non-string acknowledgeUncertain is 400, nothing checked or done', async (_n, route, method, id, body) => {
    for (const bad of [{ 'p-1': 'k' }, ['k'], 42, null, true]) {
      mockCalls.length = 0; mockChecks.length = 0;
      const out = await call(route, method, id, { ...body, acknowledgeUncertain: bad });
      expect(out.status).toBe(400);
      expect(out.json.code).toBe(SHAPE);
      expect(mockChecks).toEqual([]);
      expect(mockCalls).toEqual([]);
    }
  });

  it.each(scalarRoutes)('%s: the batch field acknowledgeUncertainByProspect is 400, nothing checked or done', async (_n, route, method, id, body) => {
    const out = await call(route, method, id, { ...body, acknowledgeUncertainByProspect: { 'p-1': 'k' } });
    expect(out).toMatchObject({ status: 400, json: { code: SHAPE } });
    expect(mockChecks).toEqual([]);
    expect(mockCalls).toEqual([]);
  });

  it('batch enrolment: the single-enrolment field, or a malformed map, is 400 before anyone is enrolled', async () => {
    for (const body of [
      { acknowledgeUncertain: 'k' }, { acknowledgeUncertain: { 'p-1': 'k' } },
      { acknowledgeUncertainByProspect: 'k' }, { acknowledgeUncertainByProspect: ['k'] }, { acknowledgeUncertainByProspect: null },
      { acknowledgeUncertainByProspect: { 'p-1': 7 } }, { acknowledgeUncertainByProspect: { 'p-1': { k: 'k' } } },
    ]) {
      mockCalls.length = 0; mockChecks.length = 0;
      const out = await call(enrollRoute, 'POST', CAMPAIGN, { workflowId: WORKFLOW, ...body });
      expect(out.status).toBe(400);
      expect(out.json.code).toBe(SHAPE);
      expect(mockCalls).toEqual([]);
    }
  });

  it('a valid shape still reaches the check: a string on scalar routes, a string map on batch', async () => {
    expect((await call(progressionRoute, 'POST', RUN, { action: 'cancel', acknowledgeUncertain: 'k' })).status).toBe(200);
    await call(enrollRoute, 'POST', CAMPAIGN, { workflowId: WORKFLOW, acknowledgeUncertainByProspect: {} });
    expect(mockCalls).toContain('enrollCampaignTargets');
  });

  it('a shape check never runs where no acknowledgement applies: an opt_out with a junk field is not refused', async () => {
    const out = await call(instanceRoute, 'PATCH', RUN, { evaluation: 'opt_out', acknowledgeUncertain: 42 });
    expect(out.status).toBe(200);
  });
});

describe('PI review F2: the run route reports the acknowledgement on both gated paths', () => {
  it('lifecycle end: { instance, acknowledgement } with the recorded acknowledgement, or null when nothing was gated', async () => {
    mockVerdict.next = { ok: true, acknowledged: { id: 'ack-9', repeated: false } };
    const acked = await call(instanceRoute, 'PATCH', RUN, { lifecycleState: 'cancelled', acknowledgeUncertain: 'k' });
    expect(acked.json).toMatchObject({ instance: { id: RUN }, acknowledgement: { id: 'ack-9', repeated: false } });
    mockVerdict.next = { ok: true, acknowledged: null };
    expect((await call(instanceRoute, 'PATCH', RUN, { lifecycleState: 'cancelled' })).json.acknowledgement).toBeNull();
    expect((await call(instanceRoute, 'PATCH', RUN, { lifecycleState: 'paused' })).json).toHaveProperty('acknowledgement', null);
  });

  it('evaluation end: the evaluation answer carries the acknowledgement; other evaluations carry null', async () => {
    mockVerdict.next = { ok: true, acknowledged: { id: 'ack-7', repeated: true } };
    const ended = await call(instanceRoute, 'PATCH', RUN, { evaluation: 'end', acknowledgeUncertain: 'k' });
    expect(ended.json).toMatchObject({ evaluation: { action: 'end' }, acknowledgement: { id: 'ack-7', repeated: true } });
    expect((await call(instanceRoute, 'PATCH', RUN, { evaluation: 'opt_out' })).json).toHaveProperty('acknowledgement', null);
  });
});
