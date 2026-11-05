/**
 * The journey-completion rules that have no database in them: sweep fairness, the
 * email step contract at the WS-3 adapter and the transport, what counts as a
 * response, and PI's verdict at enrollment. The whole lifecycle runs against real
 * PostgreSQL in backend/tests/realschema/orch_journey_lifecycle.test.ts.
 */

import {
  rotateInstanceWindow, SWEEP_LIMITS, SWEEP_ROTATION_MS, ROUTED_CHANNELS,
} from '../../services/workflowExecution/workflowProgressionSweeper';
import { createWs3Adapter, buildAdapterRegistry, type Ws3AdapterDeps } from '../../services/orchestration/engineAdapters';
import {
  assessJourneyResponse, evaluatedReplyKeys, JOURNEY_EXIT_OUTCOMES, REPLY_AWAITING_EVALUATION, replyReferenceKey, type JourneyResponsePort,
} from '../../services/orchestration/journeyResponses';
import { journeyDecisionKey } from '../../services/orchestration/journeyDecisionLog';
import { isProspectClosedToJourneys, NON_CONTACT_CHANNELS } from '../../services/orchestration/journeyPolicy';
import { loadIndividualFacts, PROSPECT_STATE_UNREADABLE_GAP, type IndividualIntelligencePort } from '../../services/orchestration/individualIntelligence';
import type { WorkflowStep } from '../../services/workflows/workflowStore';
import { renderEmailContent as renderContent } from '../../services/emailEngine/emailContentGenerator';
import { createEmailTransport } from '../../services/leadOutreachExecution/emailTransport';

const ORG = '00000000-0000-4000-8000-00000000000a';

describe('sweep rotation', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `run-${i}`);
  const at = (tick: number) => new Date(tick * SWEEP_ROTATION_MS).toISOString();

  it('leaves a set the budget already covers alone', () => {
    const few = ids.slice(0, SWEEP_LIMITS.tasksPerTenant);
    expect(rotateInstanceWindow(few, at(7))).toEqual(few);
  });

  it('reaches every run across successive sweeps, whatever the oldest ones are doing', () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < 10; tick += 1) {
      rotateInstanceWindow(ids, at(tick)).slice(0, SWEEP_LIMITS.tasksPerTenant).forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(ids.length);
  });

  it('never loses or repeats a run within one sweep', () => {
    const rotated = rotateInstanceWindow(ids, at(3));
    expect(new Set(rotated).size).toBe(ids.length);
    expect(rotated[0]).not.toBe(ids[0]);
  });

  it('an unparseable instant falls back to the oldest first instead of throwing', () => {
    expect(rotateInstanceWindow(ids, 'not-a-date')[0]).toBe(ids[0]);
  });
});

describe('the WS-3 adapter on an email step', () => {
  const INSTRUCTION = 'Hello {{first_name}}';
  const step = (instruction?: string) =>
    ({ key: 's', channel: 'email', delay_after_previous_hours: 0, execution_mode: 'human', ...(instruction ? { instruction } : {}) }) as WorkflowStep;
  const ctx = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG, executionInstanceId: 'i', executionTaskId: 't', planStepId: 'p', channel: 'email',
    subject: { kind: 'prospect', id: 'x' }, step: step(INSTRUCTION), personId: 'person', ...over,
  }) as never;
  const coded = (code: string) => Object.assign(new Error(code), { code });
  const deps = (over: Partial<Ws3AdapterDeps> = {}): Ws3AdapterDeps => ({
    bridge: jest.fn(async () => ({ handoff: { outreachTaskId: 'task' } })) as never,
    getTask: jest.fn(async () => ({ id: 'task', status: 'approved' })) as never,
    submitForApproval: jest.fn(async () => ({ ok: true })) as never,
    dispatch: jest.fn(async () => ({ outcome: 'sent', reason: null })) as never,
    registerTransports: jest.fn(),
    resolveRecipient: jest.fn(async () => ({ personId: 'person', email: 'p@example.test', sourceOfTruth: null, personalization: { first_name: 'Ana' } })) as never,
    renderContent,
    sendEmail: jest.fn(async () => ({ dispatch: { outcome: 'sent', reason: null } })) as never,
    ...over,
  });

  it('refuses before bridging when the step authored nothing', async () => {
    const d = deps();
    expect(await createWs3Adapter(d).execute(ctx({ step: step() }))).toMatchObject({ outcome: 'no_authored_content', disposition: 'needs_human' });
    expect(d.bridge).not.toHaveBeenCalled();
  });

  it.each([
    ['email_missing', 'skipped'], ['email_invalid', 'skipped'], ['recipient_error', 'wait'], ['person_not_found', 'needs_human'],
  ])('recipient refusal %s settles %s, before bridging', async (code, disposition) => {
    const d = deps({ resolveRecipient: jest.fn(async () => { throw coded(code); }) as never });
    expect(await createWs3Adapter(d).execute(ctx())).toMatchObject({ outcome: code, disposition });
    expect(d.bridge).not.toHaveBeenCalled();
  });

  it('a person missing a placeholder value is skipped; a placeholder nobody may use goes to a person', async () => {
    const none = deps({ resolveRecipient: jest.fn(async () => ({ personId: 'person', email: 'p@example.test', sourceOfTruth: null, personalization: {} })) as never });
    expect(await createWs3Adapter(none).execute(ctx())).toMatchObject({ outcome: 'personalization_missing', disposition: 'skipped' });
    const bad = deps();
    expect(await createWs3Adapter(bad).execute(ctx({ step: step('Hi {{ssn}}') }))).toMatchObject({ outcome: 'unauthorized_personalization', disposition: 'needs_human' });
    for (const d of [none, bad]) expect(d.bridge).not.toHaveBeenCalled();
  });

  it('no canonical person is skipped', async () => {
    expect(await createWs3Adapter(deps()).execute(ctx({ personId: null }))).toMatchObject({ outcome: 'person_unresolved', disposition: 'skipped' });
  });

  it('sends through the certified engine, never the plain dispatcher', async () => {
    const d = deps();
    const r = await createWs3Adapter(d).execute(ctx({ now: '2026-11-01T00:00:00.000Z' }));
    expect(r).toMatchObject({ outcome: 'sent', disposition: 'completed' });
    expect(d.sendEmail).toHaveBeenCalledWith({ organizationId: ORG, executionTaskId: 't', now: '2026-11-01T00:00:00.000Z' });
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('an engine refusal before dispatch goes to a person', async () => {
    const d = deps({ sendEmail: jest.fn(async () => { throw coded('handoff_not_found'); }) as never });
    expect(await createWs3Adapter(d).execute(ctx())).toMatchObject({ outcome: 'handoff_not_found', disposition: 'needs_human' });
  });

  it('leaves an internal step on the plain dispatcher, with no recipient read', async () => {
    const d = deps();
    await createWs3Adapter(d).execute(ctx({ channel: 'internal', step: { ...step(), channel: 'internal' } }));
    expect(d.resolveRecipient).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.dispatch).toHaveBeenCalledWith(ORG, 'task', {});
  });
});

describe('the email transport hooks', () => {
  const OLD = { ...process.env };
  beforeAll(() => {
    process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  });
  afterAll(() => { process.env = OLD; });

  const run = async (options: Record<string, unknown>) => {
    const calls: Array<Record<string, unknown>> = [];
    const transport = createEmailTransport(
      { name: 'stub', send: async (r: Record<string, unknown>) => { calls.push(r); return { accepted: true, messageId: 'm' }; } } as never,
      { enabled: () => true, ...options } as never,
    );
    const result = await transport.send({
      task: { companyId: ORG, action: 'send_intro', explanation: null } as never,
      attemptId: 'a', attemptNumber: 1, idempotencyKey: 'k', recipient: 'p@example.test', at: '2026-11-01T00:00:00.000Z',
    } as never);
    return { result, call: calls[0] };
  };
  const rendered = { subject: 'Hello Ana', body: 'Hello Ana', personalizationInputs: { first_name: 'Ana' }, contentSource: 'src' };

  it('hands over the rendered strings, after recording them', async () => {
    const order: string[] = [];
    const { call } = await run({
      content: async () => { order.push('render'); return rendered; },
      recordContent: async () => { order.push('record'); },
    });
    expect(order).toEqual(['render', 'record']);
    expect(call).toMatchObject({ subject: 'Hello Ana', body: 'Hello Ana' });
  });

  it('a failed render never falls back to the placeholder, and nothing is sent', async () => {
    const { result, call } = await run({ content: async () => { throw new Error('no'); } });
    expect(call).toBeUndefined();
    expect(result.response).toEqual({ reason: 'content_unavailable' });
  });

  it('what cannot be recorded is not sent', async () => {
    const { result, call } = await run({ content: async () => rendered, recordContent: async () => { throw new Error('db'); } });
    expect(call).toBeUndefined();
    expect(result.response).toEqual({ reason: 'content_evidence_unrecorded' });
  });

  it('with no hooks, the harness path keeps its placeholder', async () => {
    expect((await run({})).call).toMatchObject({ subject: 'send_intro', body: 'send_intro' });
  });
});

describe('application callers compose the certified engine', () => {
  const fs = require('fs') as typeof import('fs');
  it.each(['backend/services/leadOutreachActivation.ts', 'backend/services/leadOutreachRecoverySweep.ts'])('%s', (file) => {
    const calls = fs.readFileSync(file, 'utf8').match(/registerDefaultTransports\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toContain("email: 'engine'");
  });
});

describe('what ends a journey, and what suspends it (Prompt 4)', () => {
  type Reply = { outcome: 'replied' | 'unsubscribed'; messageId: string; threadId: string; inboundMessageIds?: string[] };
  const port = (outcomes: string[], reply: Reply | null = null, refs?: string[]): JourneyResponsePort => ({
    ws3Outcomes: async () => outcomes,
    whatsappReply: async () => reply,
    ...(refs ? { ws3ReplyRefs: async () => refs } : {}),
  });
  const none = new Set<string>();
  const assess = (p: JourneyResponsePort, evaluated: ReadonlySet<string> = none) => assessJourneyResponse(ORG, 'i', 'p', evaluated, p);

  it('the deterministic answers are exactly complained (Q-C1), booked, converted, rejected, unsubscribed', () => {
    expect([...JOURNEY_EXIT_OUTCOMES]).toEqual(['complained', 'meeting_booked', 'converted', 'rejected', 'unsubscribed']);
  });

  it.each(JOURNEY_EXIT_OUTCOMES)('%s ends it', async (o) => {
    expect(await assess(port([o]))).toMatchObject({ consequence: 'exit', outcome: o, replyKey: null });
  });

  it('a deterministic answer ends it even beside an unevaluated reply', async () => {
    expect(await assess(port(['replied', 'unsubscribed'], { outcome: 'replied', messageId: 'w1', threadId: 't' }, ['o1'])))
      .toMatchObject({ consequence: 'exit', outcome: 'unsubscribed' });
  });

  it.each(['opened', 'clicked', 'no_response'])('%s neither ends nor suspends it', async (o) => {
    expect(await assess(port([o]))).toEqual({ consequence: 'continue', outcome: null, whatsappReply: null, replyKey: null });
  });

  it('a WhatsApp STOP still ends it as an unsubscribe', async () => {
    const stop = { outcome: 'unsubscribed' as const, messageId: 'wamid.2', threadId: 'th' };
    expect(await assess(port([], stop))).toMatchObject({ consequence: 'exit', outcome: 'unsubscribed', whatsappReply: stop });
  });

  it('CHANGED: an unclassified WhatsApp reply SUSPENDS it, carrying the message identity for PI', async () => {
    const reply = { outcome: 'replied' as const, messageId: 'wamid.1', threadId: 'th', inboundMessageIds: ['wamid.1'] };
    expect(await assess(port([], reply))).toEqual({ consequence: 'suspend', outcome: 'replied', whatsappReply: reply, replyKey: replyReferenceKey('wa:wamid.1') });
  });

  it('CHANGED: a recorded WS-3 reply SUSPENDS it, keyed on the outcome row', async () => {
    expect(await assess(port(['replied'], null, ['o-1']))).toMatchObject({ consequence: 'suspend', outcome: 'replied', replyKey: replyReferenceKey('ws3:o-1') });
    // A port without row references keys the run's replies as one.
    expect(await assess(port(['replied']))).toMatchObject({ consequence: 'suspend', replyKey: replyReferenceKey('ws3:i') });
  });

  it('an evaluated reply does not suspend again; a later one does', async () => {
    const reply = { outcome: 'replied' as const, messageId: 'w1', threadId: 'th', inboundMessageIds: ['w1', 'w2'] };
    const first = await assess(port([], { ...reply, inboundMessageIds: ['w1'] }));
    expect(first.consequence).toBe('suspend');
    const evaluated = evaluatedReplyKeys([{ decision: 'needs_human', outcome: `${REPLY_AWAITING_EVALUATION}:${first.replyKey}` }]);
    expect(await assess(port([], { ...reply, inboundMessageIds: ['w1'] }), evaluated)).toMatchObject({ consequence: 'continue' });
    expect(await assess(port([], reply), evaluated)).toMatchObject({ consequence: 'suspend', replyKey: replyReferenceKey('wa:w2') });
  });

  it('evaluatedReplyKeys reads only suspension decisions', () => {
    expect([...evaluatedReplyKeys([
      { decision: 'needs_human', outcome: `${REPLY_AWAITING_EVALUATION}:k1` },
      { decision: 'needs_human', outcome: 'stuck_waiting' },
      { decision: 'waiting', outcome: `${REPLY_AWAITING_EVALUATION}:k2` },
      { decision: 'exited', outcome: null },
    ])]).toEqual(['k1']);
  });

  it('an unreadable source throws: "we could not tell" is never "carry on"', async () => {
    const broken: JourneyResponsePort = { ws3Outcomes: async () => { throw new Error('down'); }, whatsappReply: async () => null };
    await expect(assess(broken)).rejects.toThrow('down');
    const brokenRefs: JourneyResponsePort = { ws3Outcomes: async () => ['replied'], whatsappReply: async () => null, ws3ReplyRefs: async () => { throw new Error('refs down'); } };
    await expect(assess(brokenRefs)).rejects.toThrow('refs down');
  });
});

describe('PI state as a journey fact', () => {
  const port = (readProspectState?: IndividualIntelligencePort['readProspectState']): IndividualIntelligencePort => ({
    resolvePerson: async () => ({ ok: true, personId: 'p' }),
    readPersonContacts: async () => ({ email: null, phone: null }),
    readLeadIntelligence: async () => null,
    readProspectScore: async () => null,
    channelPermission: async () => true,
    ...(readProspectState ? { readProspectState } : {}),
  });
  const load = (p: IndividualIntelligencePort) => loadIndividualFacts(ORG, { kind: 'prospect', id: 'x' } as never, '2026-11-01T00:00:00.000Z', p);

  it('carries the state, and a prospect with no ledger is simply absent', async () => {
    expect((await load(port(async () => 'engaged'))).facts.prospect_lifecycle_state).toBe('engaged');
    expect((await load(port(async () => null))).facts.prospect_lifecycle_state).toBeUndefined();
  });

  it('an unreadable state is a named gap, never "open"', async () => {
    const r = await load(port(async () => { throw new Error('down'); }));
    expect(r.gaps).toContain(PROSPECT_STATE_UNREADABLE_GAP);
    expect(r.facts.prospect_lifecycle_state).toBeUndefined();
  });

  it.each([['closed_disqualified', true], ['not_interested', true], ['engaged', false], ['qualified', false]])('%s closed=%s', (state, closed) => {
    expect(isProspectClosedToJourneys({ prospect_lifecycle_state: state })).toBe(closed);
  });
  it('an unknown state is not treated as closed: the gap is what stops contact', () => {
    expect(isProspectClosedToJourneys({})).toBe(false);
  });
});

describe('small contracts', () => {
  it('a decision key ignores wording, so a deferral does not write a row every sweep', () => {
    const d = { executionInstanceId: 'i', planStepId: 's', stepKey: 'k', channel: 'email', engine: 'ws3', decision: 'deferred', outcome: null } as const;
    expect(journeyDecisionKey({ ...d, reasons: ['last action 1.0h ago'] })).toBe(journeyDecisionKey({ ...d, reasons: ['last action 2.0h ago'] }));
    expect(journeyDecisionKey({ ...d, decision: 'waiting', reasons: [] })).not.toBe(journeyDecisionKey({ ...d, reasons: [] }));
  });

  it('every routed channel has a real adapter claiming it, and bookkeeping channels are routed', () => {
    expect(ROUTED_CHANNELS).toEqual(expect.arrayContaining(['internal', 'email', 'whatsapp', 'social_post', 'community']));
    for (const c of NON_CONTACT_CHANNELS) expect(ROUTED_CHANNELS as readonly string[]).toContain(c);
    expect(() => buildAdapterRegistry([createWs3Adapter({} as never)])).not.toThrow();
  });
});
