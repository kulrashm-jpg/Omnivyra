/**
 * Prompt 4 round 2 — the pure parts of governance precedence, Q-C1 and RV-1. The database
 * proofs are realschema/p4_governance_precedence.test.ts and p4_governance_whatsapp.test.ts.
 */
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no store in this suite'); } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no store in this suite'); } } }));
const mockA: { isComplaintInferredEvidence?: unknown } = {};
jest.mock('../../services/orchestration/journeyEvents', () => mockA);

import {
  assessComplaint, assessJourneyResponse, complaintEvidencePredicate, type JourneyResponsePort,
} from '../../services/orchestration/journeyResponses';
import { APPROVAL_REVOKED, createWs3Adapter, defaultWs3Deps } from '../../services/orchestration/engineAdapters';

const ORG = '00000000-0000-4000-8000-00000000000a';
const reply = { outcome: 'replied' as const, messageId: 'w1', threadId: 't', inboundMessageIds: ['w1'] };
const port = (over: Partial<JourneyResponsePort> & { order?: string[] } = {}): JourneyResponsePort => {
  const order = over.order ?? [];
  return {
    personRestrictions: async () => { order.push('restrictions'); return []; },
    ws3ComplaintEvidence: async () => { order.push('evidence'); return false; },
    ws3Outcomes: async () => { order.push('outcomes'); return []; },
    whatsappReply: async () => { order.push('reply'); return null; },
    ...over,
  };
};

describe('governance precedence: restrictions are read before any reply', () => {
  it('order: restrictions, complaint evidence, outcomes, then the WhatsApp reply', async () => {
    const order: string[] = [];
    await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ order }));
    expect(order).toEqual(['restrictions', 'evidence', 'outcomes', 'reply']);
  });

  it.each([
    [['complaint'], 'complained'], [['unsubscribe'], 'unsubscribed'], [['unsubscribe', 'complaint'], 'complained'],
  ])('a %j restriction ends the run even with an unevaluated reply pending', async (types, outcome) => {
    const v = await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({
      personRestrictions: async () => types, ws3Outcomes: async () => ['replied'], whatsappReply: async () => reply,
    }));
    expect(v).toMatchObject({ consequence: 'exit', outcome });
  });

  it('a STOP restriction exits AND still hands PI the STOP message; a failing reply read never blocks the exit', async () => {
    const stop = { outcome: 'unsubscribed' as const, messageId: 's1', threadId: 't' };
    expect(await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ personRestrictions: async () => ['unsubscribe'], whatsappReply: async () => stop })))
      .toEqual({ consequence: 'exit', outcome: 'unsubscribed', whatsappReply: stop, replyKey: null });
    expect(await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ personRestrictions: async () => ['unsubscribe'], whatsappReply: async () => { throw new Error('down'); } })))
      .toEqual({ consequence: 'exit', outcome: 'unsubscribed', whatsappReply: null, replyKey: null });
    // A plain reply beside an unsubscribe is not handed over as a STOP.
    expect((await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ personRestrictions: async () => ['unsubscribe'], whatsappReply: async () => reply }))).whatsappReply).toBeNull();
  });

  it('a hard bounce does not end the run here (governance refuses the email; the channel permission skips it)', async () => {
    expect(await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ personRestrictions: async () => ['bounce_hard'] })))
      .toMatchObject({ consequence: 'continue' });
  });

  it('an unreadable restriction source throws: "we could not tell" is never a pause or a send', async () => {
    await expect(assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ personRestrictions: async () => { throw new Error('down'); } }))).rejects.toThrow('down');
  });
});

describe('Q-C1 — the complaint', () => {
  it('evidence, a restriction or a future `complained` outcome each end it; a pending reply does not stop that', async () => {
    expect(await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ ws3ComplaintEvidence: async () => true, whatsappReply: async () => reply })))
      .toMatchObject({ consequence: 'exit', outcome: 'complained' });
    expect(await assessJourneyResponse(ORG, 'i', 'p', new Set(), port({ ws3Outcomes: async () => ['complained', 'replied'] })))
      .toMatchObject({ consequence: 'exit', outcome: 'complained' });
    for (const p of [port({ ws3ComplaintEvidence: async () => true }), port({ personRestrictions: async () => ['complaint'] }), port({ ws3Outcomes: async () => ['complained'] })]) {
      expect(await assessComplaint(ORG, 'i', 'p', p)).toBe(true);
    }
    expect(await assessComplaint(ORG, 'i', 'p', port({ ws3Outcomes: async () => ['replied'], personRestrictions: async () => ['unsubscribe'] }))).toBe(false);
  });

  it("the complaint exit uses journeyEvents.isComplaintInferredEvidence itself, so the rules cannot diverge", async () => {
    // The helper's fail-toward-complaint cases are pinned in journeyEventsOutcomeMapping.test.ts.
    const helper = jest.fn(() => true);
    mockA.isComplaintInferredEvidence = helper;
    expect(await complaintEvidencePredicate()).toBe(helper);
    delete mockA.isComplaintInferredEvidence;
  });
});

describe('RV-1 — the WS-3 adapter tells a revocation from any other cancellation by the stored approval row', () => {
  const adapter = (approvals: Array<Record<string, unknown>> | 'unreadable') => createWs3Adapter({
    ...defaultWs3Deps,
    registerTransports: () => undefined,
    bridge: (async () => ({ handoff: { outreachTaskId: 't-1' } })) as never,
    getTask: (async () => ({ id: 't-1', status: 'cancelled' })) as never,
    readApprovals: (async () => (approvals === 'unreadable' ? { ok: false, error: 'down' } : { ok: true, approvals })) as never,
  });
  const ctx = { organizationId: ORG, executionInstanceId: 'i', executionTaskId: 'x', planStepId: 's', channel: 'internal', subject: { kind: 'prospect', id: 'p' }, step: null, personId: null } as never;

  it('latest decision revoked → needs_human approval_revoked:<fingerprint>', async () => {
    const r = await adapter([{ id: 'a1', decision: 'approved' }, { id: 'a2', decision: 'revoked' }]).execute(ctx);
    expect(r.disposition).toBe('needs_human');
    expect(r.outcome).toMatch(new RegExp(`^${APPROVAL_REVOKED}:[0-9a-f]{32}$`));
  });
  it.each([
    ['no approval at all', []],
    ['a rejection', [{ id: 'a1', decision: 'rejected' }]],
    ['revoked, then approved again', [{ id: 'a1', decision: 'revoked' }, { id: 'a2', decision: 'approved' }]],
  ])('%s → an ordinary cancellation: skipped, as before', async (_l, approvals) => {
    expect(await adapter(approvals as Array<Record<string, unknown>>).execute(ctx)).toMatchObject({ outcome: 'cancelled', disposition: 'skipped' });
  });
  it('an unreadable approval log waits; it is never guessed either way', async () => {
    expect(await adapter('unreadable').execute(ctx)).toMatchObject({ outcome: 'approvals_unreadable', disposition: 'wait' });
  });
});
