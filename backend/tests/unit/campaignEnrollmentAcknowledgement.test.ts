/**
 * Orchestration, Follow-up E — batch enrolment (campaignEnrollment.enrollCampaignTargets) holds a
 * person whose acknowledgement check refuses, and enrols them only once it passes. The check is a
 * double (its behaviour: uncertainCommunicationAcknowledgement.test.ts); the stores are doubles.
 */
type Row = Record<string, unknown>;
const ORG = '00000000-0000-4000-8000-00000000000a';
const CAMPAIGN = '00000000-0000-4000-8000-0000000000c1';
const WORKFLOW = '00000000-0000-4000-8000-0000000000f1';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

const mockChecks: Row[] = [];
const mockCreated: string[] = [];
const mockHeld = new Set<string>();
const WARNING = { operation: 'reenrol', acknowledgementKey: 'k'.repeat(64), communications: [{ requestId: 'r1' }] };

jest.mock('../../services/orchestration/uncertainCommunicationAcknowledgement', () => ({
  checkUncertainAcknowledgement: jest.fn(async (i: Row) => {
    mockChecks.push(i);
    const subject = (i.scope as Row).subjectId as string;
    if (mockHeld.has(subject) && i.acknowledgementKey !== 'k'.repeat(64)) {
      return { ok: false, status: 409, code: 'uncertain_communication_unacknowledged', error: 'held', warning: WARNING };
    }
    if (subject === 'p-unreadable') return { ok: false, status: 503, code: 'uncertainty_history_unreadable', error: 'unreadable' };
    return { ok: true, acknowledged: mockHeld.has(subject) ? { id: 'ack-1', repeated: false } : null };
  }),
}));
jest.mock('../../services/prospectCampaigns/prospectCampaignStore', () => ({ getProspectCampaign: jest.fn(async () => ({ id: CAMPAIGN, status: 'active' })) }));
jest.mock('../../services/prospectCampaigns/campaignTargetStore', () => ({
  listCampaignTargets: jest.fn(async () => ['p-clear', 'p-held', 'p-unreadable'].map((p, i) => ({ id: `t-${i}`, prospectId: p }))),
}));
jest.mock('../../services/executionInstances/executionInstanceStore', () => {
  class ExecutionInstanceError extends Error { constructor(m: string, readonly code: string) { super(m); } }
  return {
    ExecutionInstanceError,
    getOccupiedExecutionInstance: jest.fn(async () => null),
    createExecutionInstance: jest.fn(async (i: Row) => { mockCreated.push(String(i.subjectId)); return { id: `run-${String(i.subjectId)}`, workflowVersionId: 'v1' }; }),
  };
});
jest.mock('../../services/executionPlans/executionPlanStore', () => ({ createExecutionPlan: jest.fn(async () => ({})), getPlanForInstance: jest.fn(async () => null) }));
jest.mock('../../services/orchestration/enrollment', () => ({
  checkEnrollmentEligibility: jest.fn(async () => ({ eligible: true, reasons: [], assessedVersionId: 'v1' })),
}));

import { enrollCampaignTargets } from '../../services/orchestration/campaignEnrollment';

const run = (extra: Row = {}) => enrollCampaignTargets({ organizationId: ORG, campaignId: CAMPAIGN, workflowId: WORKFLOW, actorUserId: ACTOR, ...extra } as Parameters<typeof enrollCampaignTargets>[0]);

beforeEach(() => { mockChecks.length = 0; mockCreated.length = 0; mockHeld.clear(); mockHeld.add('p-held'); });

describe('E: batch enrolment', () => {
  it('a held person is reported needs_acknowledgement with the warning and NOT enrolled; others enrol normally; unreadable is held too', async () => {
    const r = await run();
    expect(mockCreated).toEqual(['p-clear']);
    expect(r.enrolled).toBe(1);
    expect(r.needsAcknowledgement).toBe(2);
    expect(r.outcomes.find((o) => o.prospectId === 'p-held')).toMatchObject({ outcome: 'needs_acknowledgement', instanceId: null, reasons: ['uncertain_communication_unacknowledged'], warning: WARNING });
    const unreadable = r.outcomes.find((o) => o.prospectId === 'p-unreadable');
    expect(unreadable).toMatchObject({ outcome: 'needs_acknowledgement', reasons: ['uncertainty_history_unreadable'] });
    expect(unreadable).not.toHaveProperty('warning');
  });

  it('each person is checked as reenrol for this campaign and workflow, as the acting person, failing closed', async () => {
    await run();
    expect(mockChecks.map((c) => (c.scope as Row).subjectId)).toEqual(['p-clear', 'p-held', 'p-unreadable']);
    for (const c of mockChecks) {
      expect(c).toMatchObject({ organizationId: ORG, operation: 'reenrol', actorUserId: ACTOR, onUnreadable: 'refuse', record: true,
        scope: { kind: 'subject', subjectKind: 'prospect', campaignId: CAMPAIGN, workflowId: WORKFLOW } });
    }
  });

  it('only that person\'s key is passed for that person; once acknowledged they enrol', async () => {
    const r = await run({ acknowledgements: { 'p-held': 'k'.repeat(64) } });
    expect(mockChecks.find((c) => (c.scope as Row).subjectId === 'p-held')!.acknowledgementKey).toBe('k'.repeat(64));
    expect(mockChecks.find((c) => (c.scope as Row).subjectId === 'p-clear')!.acknowledgementKey).toBeUndefined();
    expect(mockCreated).toEqual(['p-clear', 'p-held']);
    expect(r.enrolled).toBe(2);
  });

  it('a malformed acknowledgements value is ignored (no key reaches anyone)', async () => {
    for (const bad of ['k', ['k'], null, 7]) {
      mockChecks.length = 0;
      await run({ acknowledgements: bad });
      expect(mockChecks.every((c) => c.acknowledgementKey === undefined)).toBe(true);
    }
  });

  it('a preview checks without recording and creates nothing', async () => {
    const r = await run({ dryRun: true, acknowledgements: { 'p-held': 'k'.repeat(64) } });
    expect(mockCreated).toEqual([]);
    expect(mockChecks.every((c) => c.record === false)).toBe(true);
    expect(r.wouldEnroll).toBe(2);
    expect(r.needsAcknowledgement).toBe(1);
  });
});
