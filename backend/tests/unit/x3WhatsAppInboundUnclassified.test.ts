/**
 * X-3 (Orchestration Prompt 5, Agent B) — an unevaluated WhatsApp inbound is never the
 * business outcome `replied`, never a PI `engaged` transition and never positive engagement.
 *
 *   1. the durable reading labels every non-STOP inbound `inbound_unclassified`;
 *   2. the PI feed takes a STOP only, with provenance `provider_webhook` and the key
 *      `evidence:<fingerprint>` (PI ruling P-2); a STOP already recorded under the old
 *      `derivation:` key and re-delivered writes no second transition.
 *
 * The database proofs (sweeper, ledger, event view) are in
 * realschema/orch_journey_lifecycle.test.ts, "WhatsApp responses". The event mapping,
 * including the 4-way case, is in sharedMessageOutcomeMapping.test.ts.
 *
 * Codes only: no message content leaves a fixture.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

type Row = Record<string, unknown>;

const db = { tables: {} as Record<string, Row[]> };

// A table double: chained filters return the builder; awaiting it yields the rows seeded in
// that table. Filters are not evaluated, because each test seeds one run's rows only.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder: Record<string, unknown> = {};
    let one = false;
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'is']) builder[m] = () => builder;
    builder.maybeSingle = () => { one = true; return builder; };
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const rows = db.tables[table] ?? [];
      return Promise.resolve({ data: one ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
    };
    return builder;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no supabase in this suite'); } } }));
jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  listInstanceTasks: async () => [{ id: 'etask-wa', planStepId: 'step-wa', channel: 'whatsapp' }],
}));

const mockPi = { state: null as string | null };
jest.mock('../../services/prospectLifecycle', () => {
  const actual = jest.requireActual('../../services/prospectLifecycle');
  return {
    ...actual,
    interpretOutcome: jest.fn(actual.interpretOutcome),
    readCurrentProspectState: jest.fn(async () => (mockPi.state === null ? null : { state: mockPi.state })),
    recordProspectTransition: jest.fn(async () => ({ outcome: 'moved', wrote: true })),
    produceLifecycleFromOutcome: jest.fn(),
  };
});

import { durableJourneyResponsePort, WHATSAPP_INBOUND_UNCLASSIFIED } from '../../services/orchestration/journeyResponses';
import { feedWhatsAppReplyToLifecycle, whatsappReplyFingerprint } from '../../services/orchestration/journeyFeedback';
import * as pi from '../../services/prospectLifecycle';
import { isFeedbackSource } from '../../services/prospectLifecycle/outcomeProvenance';

const ORG = '00000000-0000-4000-8000-00000000000a';

function seedInbound(messages: Array<{ id: string; content: string | null }>): void {
  db.tables = {
    unified_persons: [{ primary_phone: '+15551230001' }],
    execution_engine_requests: [{ created_at: '2026-11-06T00:00:00.000Z', state: 'submitted', external_ref: 'b-1' }],
    social_accounts: [{ id: 'acct-1' }],
    engagement_threads: [{ id: 'thread-1' }],
    engagement_messages: messages.map((m) => ({ thread_id: 'thread-1', platform_message_id: m.id, content: m.content })),
  };
}
const read = () => durableJourneyResponsePort.whatsappReply(ORG, 'run-1', 'person-1');

beforeEach(() => {
  db.tables = {};
  mockPi.state = null;
  jest.clearAllMocks();
});

describe('the durable WhatsApp reading labels an unevaluated inbound inbound_unclassified', () => {
  it('the label is not a business outcome', () => {
    expect(WHATSAPP_INBOUND_UNCLASSIFIED).toBe('inbound_unclassified');
    const { BUSINESS_OUTCOME_TYPES } = jest.requireActual('../../services/leadOutreachExecution/lifecycle') as { BUSINESS_OUTCOME_TYPES: readonly string[] };
    expect(BUSINESS_OUTCOME_TYPES).not.toContain(WHATSAPP_INBOUND_UNCLASSIFIED);
  });

  it.each([
    ['a plain message', 'yes please, tell me more'],
    ['an empty message', ''],
    ['a whitespace-only message', '   '],
    ['a message with no text (media)', null],
    ['an ambiguous message', 'maybe? stop by next week, not sure'],
    ['a message in an unsupported language', 'bitte nicht mehr schreiben, danke'],
  ])('%s is inbound_unclassified, never replied', async (_label, content) => {
    seedInbound([{ id: 'wamid.1', content }]);
    const r = await read();
    expect(r).toEqual({ outcome: 'inbound_unclassified', messageId: 'wamid.1', threadId: 'thread-1', inboundMessageIds: ['wamid.1'] });
    expect(r!.outcome).not.toBe('replied');
  });

  it.each(['STOP', ' stop. ', 'Unsubscribe'])('a whole-message opt-out (%j) is unsubscribed', async (content) => {
    seedInbound([{ id: 'wamid.s', content }]);
    expect(await read()).toMatchObject({ outcome: 'unsubscribed', messageId: 'wamid.s' });
  });

  it('a STOP anywhere among the messages outranks an unclassified one, which stays listed for evaluation', async () => {
    seedInbound([{ id: 'wamid.a', content: 'hello' }, { id: 'wamid.s', content: 'STOP' }]);
    expect(await read()).toEqual({ outcome: 'unsubscribed', messageId: 'wamid.s', threadId: 'thread-1', inboundMessageIds: ['wamid.a'] });
  });

  it('a duplicate delivery of the same message is still one unclassified inbound', async () => {
    seedInbound([{ id: 'wamid.d', content: 'yes' }]);
    const first = await read();
    const again = await read();
    expect(again).toEqual(first);
    expect(again!.outcome).toBe('inbound_unclassified');
  });
});

describe('the PI feed takes a WhatsApp STOP only (PI rulings P-1, P-2)', () => {
  const stop = (messageId = 'wamid.stop-1') => ({
    organizationId: ORG, prospectId: 'prospect-1', messageId, threadId: 'thread-1', outcome: 'unsubscribed' as const, now: '2026-11-06T01:00:00.000Z',
  });

  it('a STOP closes the prospect: provenance provider_webhook, key evidence:<fingerprint>', async () => {
    mockPi.state = 'qualified';
    expect(await feedWhatsAppReplyToLifecycle(stop())).toEqual({ wrote: true, refusal: null });

    const interpreted = (pi.interpretOutcome as jest.Mock).mock.calls[0][0];
    expect(interpreted.outcome).toMatchObject({ id: whatsappReplyFingerprint('wamid.stop-1'), type: 'unsubscribed' });
    expect(interpreted.outcome.provenance).toMatchObject({ source: 'provider_webhook', provider: 'whatsapp', derived: false, actor: null });
    expect(isFeedbackSource(interpreted.outcome.provenance.source)).toBe(true);

    expect(pi.recordProspectTransition).toHaveBeenCalledTimes(1);
    expect((pi.recordProspectTransition as jest.Mock).mock.calls[0][0]).toMatchObject({
      to: 'closed_disqualified', origin: 'derived', actorUserId: null,
      evidence: { kind: 'engagement_thread', detail: { threadId: 'thread-1', messageId: 'wamid.stop-1' } },
      sourceEventKey: `evidence:${whatsappReplyFingerprint('wamid.stop-1')}`,
    });
  });

  it('REQUIRED: a STOP already recorded under the old derivation: key and re-delivered writes no second transition', async () => {
    // The old row moved the prospect to closed_disqualified; the same-state case is resolved
    // caller-side (stateModel.classifyProspectTransition), so the interpreter abstains.
    mockPi.state = 'closed_disqualified';
    expect(await feedWhatsAppReplyToLifecycle(stop('wamid.old-stop'))).toEqual({ wrote: false, refusal: 'no-transition' });
    expect((pi.interpretOutcome as jest.Mock).mock.results[0].value).toMatchObject({ kind: 'no-transition', reason: 'already_in_target_state' });
    expect(pi.recordProspectTransition).not.toHaveBeenCalled();
  });

  it.each(['replied', 'inbound_unclassified'])('an untyped caller passing %s is refused before PI is read', async (outcome) => {
    mockPi.state = 'not_interested';
    const r = await feedWhatsAppReplyToLifecycle({ ...stop(), outcome } as unknown as Parameters<typeof feedWhatsAppReplyToLifecycle>[0]);
    expect(r).toEqual({ wrote: false, refusal: 'not_an_opt_out' });
    expect(pi.readCurrentProspectState).not.toHaveBeenCalled();
    expect(pi.interpretOutcome).not.toHaveBeenCalled();
    expect(pi.recordProspectTransition).not.toHaveBeenCalled();
  });
});
