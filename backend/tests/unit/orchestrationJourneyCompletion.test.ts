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
import { assessJourneyExit, JOURNEY_EXIT_OUTCOMES, type JourneyResponsePort } from '../../services/orchestration/journeyResponses';
import { journeyDecisionKey } from '../../services/orchestration/journeyDecisionLog';
import { isProspectClosedToJourneys, NON_CONTACT_CHANNELS } from '../../services/orchestration/journeyPolicy';
import { loadIndividualFacts, PROSPECT_STATE_UNREADABLE_GAP, type IndividualIntelligencePort } from '../../services/orchestration/individualIntelligence';
import { validateWorkflowDefinition, type WorkflowStep } from '../../services/workflows/workflowStore';
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
  const content = { subject: 'Hello', body: 'Authored body' };
  const step = (email?: { subject: string; body: string }) =>
    ({ key: 's', channel: 'email', delay_after_previous_hours: 0, execution_mode: 'human', ...(email ? { email } : {}) }) as WorkflowStep;
  const ctx = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG, executionInstanceId: 'i', executionTaskId: 't', planStepId: 'p', channel: 'email',
    subject: { kind: 'prospect', id: 'x' }, step: step(content), personId: 'person', ...over,
  }) as never;
  const deps = (over: Partial<Ws3AdapterDeps> = {}): Ws3AdapterDeps => ({
    bridge: jest.fn(async () => ({ handoff: { outreachTaskId: 'task' } })) as never,
    getTask: jest.fn(async () => ({ id: 'task', status: 'approved' })) as never,
    submitForApproval: jest.fn(async () => ({ ok: true })) as never,
    dispatch: jest.fn(async () => ({ outcome: 'sent', reason: null })) as never,
    registerTransports: jest.fn(),
    readPersonEmail: jest.fn(async () => 'person@example.test'),
    ...over,
  });

  it('refuses before bridging when the step has no authored message', async () => {
    const d = deps();
    const r = await createWs3Adapter(d).execute(ctx({ step: step() }));
    expect(r).toMatchObject({ outcome: 'no_authored_content', disposition: 'needs_human' });
    expect(d.bridge).not.toHaveBeenCalled();
  });

  it('skips a person with no address and waits on an unreadable one, before bridging', async () => {
    const none = deps({ readPersonEmail: jest.fn(async () => null) });
    expect(await createWs3Adapter(none).execute(ctx())).toMatchObject({ outcome: 'no_email_address', disposition: 'skipped' });
    const unread = deps({ readPersonEmail: jest.fn(async () => undefined) });
    expect(await createWs3Adapter(unread).execute(ctx())).toMatchObject({ outcome: 'email_unreadable', disposition: 'wait' });
    const anon = deps();
    expect(await createWs3Adapter(anon).execute(ctx({ personId: null }))).toMatchObject({ outcome: 'person_unresolved', disposition: 'skipped' });
    for (const d of [none, unread, anon]) expect(d.bridge).not.toHaveBeenCalled();
  });

  it('dispatches with the canonical address and the authored message', async () => {
    const d = deps();
    const r = await createWs3Adapter(d).execute(ctx({ now: '2026-11-01T00:00:00.000Z' }));
    expect(r).toMatchObject({ outcome: 'sent', disposition: 'completed' });
    expect(d.dispatch).toHaveBeenCalledWith(ORG, 'task', { now: '2026-11-01T00:00:00.000Z', recipient: 'person@example.test', content });
  });

  it('leaves an internal step exactly as it was: no address, no content', async () => {
    const d = deps();
    await createWs3Adapter(d).execute(ctx({ channel: 'internal', step: { ...step(), channel: 'internal' } }));
    expect(d.readPersonEmail).not.toHaveBeenCalled();
    expect(d.dispatch).toHaveBeenCalledWith(ORG, 'task', {});
  });
});

describe('the authored email contract', () => {
  const base = { key: 's', channel: 'email', delay_after_previous_hours: 0, execution_mode: 'human' };

  it('round-trips through validation so it reaches the frozen snapshot', () => {
    const def = validateWorkflowDefinition({ steps: [{ ...base, email: { subject: ' Hi ', body: 'Body' } }] });
    expect(def.steps[0].email).toEqual({ subject: 'Hi', body: 'Body' });
  });

  it('is optional while drafting, and refused where it means nothing', () => {
    expect(validateWorkflowDefinition({ steps: [base] }).steps[0].email).toBeUndefined();
    expect(() => validateWorkflowDefinition({ steps: [{ ...base, channel: 'internal', email: { subject: 'a', body: 'b' } }] }))
      .toThrow(/only allowed on an email step/);
  });

  it.each([
    [{ subject: '', body: 'b' }],
    [{ subject: 'a', body: '' }],
    [{ subject: 'x'.repeat(201), body: 'b' }],
    [{ subject: 'a', body: 'x'.repeat(4001) }],
    [{ subject: 'a', body: 'b', to: 'someone@example.test' }],
    ['not an object'],
  ])('refuses %j', (email) => {
    expect(() => validateWorkflowDefinition({ steps: [{ ...base, email }] })).toThrow();
  });
});

describe('the email transport', () => {
  const OLD = { ...process.env };
  beforeAll(() => {
    process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
    process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  });
  afterAll(() => { process.env = OLD; });

  const send = async (extra: Record<string, unknown>) => {
    const calls: Array<Record<string, unknown>> = [];
    const transport = createEmailTransport(
      { name: 'stub', send: async (r: Record<string, unknown>) => { calls.push(r); return { accepted: true, messageId: 'm' }; } } as never,
      { enabled: () => true },
    );
    await transport.send({
      task: { companyId: ORG, action: 'send_intro', explanation: null } as never,
      attemptId: 'a', attemptNumber: 1, idempotencyKey: 'k', recipient: 'p@example.test', at: '2026-11-01T00:00:00.000Z', ...extra,
    } as never);
    return calls[0];
  };

  it('sends the authored message when one is supplied', async () => {
    expect(await send({ content: { subject: 'Authored', body: 'Words' } })).toMatchObject({ subject: 'Authored', body: 'Words' });
  });

  it('other callers keep the placeholder path unchanged', async () => {
    expect(await send({})).toMatchObject({ subject: 'send_intro', body: 'send_intro' });
  });
});

describe('what ends a journey', () => {
  const port = (outcomes: string[], reply: { messageId: string; threadId: string } | null = null): JourneyResponsePort => ({
    ws3Outcomes: async () => outcomes,
    whatsappReply: async () => reply,
  });

  it.each(JOURNEY_EXIT_OUTCOMES)('%s ends it', async (o) => {
    expect(await assessJourneyExit(ORG, 'i', 'p', port([o]))).toMatchObject({ exit: true, outcome: o });
  });

  it.each(['opened', 'clicked', 'no_response'])('%s does not', async (o) => {
    expect(await assessJourneyExit(ORG, 'i', 'p', port([o]))).toMatchObject({ exit: false, outcome: null });
  });

  it('a WhatsApp reply ends it, carrying the message identity for PI', async () => {
    const reply = { messageId: 'wamid.1', threadId: 'th' };
    expect(await assessJourneyExit(ORG, 'i', 'p', port([], reply))).toEqual({ exit: true, outcome: 'replied', whatsappReply: reply });
  });

  it('an unreadable source throws: "we could not tell" is never "carry on"', async () => {
    const broken: JourneyResponsePort = { ws3Outcomes: async () => { throw new Error('down'); }, whatsappReply: async () => null };
    await expect(assessJourneyExit(ORG, 'i', 'p', broken)).rejects.toThrow('down');
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
