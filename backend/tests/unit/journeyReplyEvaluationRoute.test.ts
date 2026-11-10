/**
 * Prompt 5 — a person evaluates the reply that paused a run, through the existing run route
 * (PATCH /api/execution-instances/:id, `{ evaluation }`): continue, retime or end, recorded
 * as a journey decision with the actor. Nothing reaches PI (P-1 = a).
 *
 * The real route, the real evaluation module, the real store and the real decision log,
 * over in-memory `execution_instances` and `execution_journey_decisions` tables. The
 * real-schema twin is realschema/o2f1_resume_race.test.ts (evaluation section).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;
const mockDb: { instances: Row[]; decisions: Row[]; failInsert: boolean } = { instances: [], decisions: [], failInsert: false };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: null as Row | null, filters: [] as Array<[string, unknown]>, one: false };
    const exec = async () => {
      const t = table === 'execution_instances' ? mockDb.instances : table === 'execution_journey_decisions' ? mockDb.decisions : null;
      if (table === 'company_scheduler_prefs') return { data: { timezone: 'Europe/London' }, error: null };
      if (t === null) return { data: st.one ? null : [], error: null };
      if (st.op === 'insert') {
        if (mockDb.failInsert) return { data: null, error: { code: '57014', message: 'write refused' } };
        const row = st.payload as Row;
        if (t.some((r) => r.decision_key === row.decision_key && r.execution_instance_id === row.execution_instance_id)) return { data: null, error: { code: '23505', message: 'dup' } };
        const stored = { id: `d${t.length + 1}`, decided_at: new Date(Date.now() + t.length).toISOString(), ...row };
        t.push(stored);
        return { data: [{ id: stored.id }], error: null };
      }
      const hit = t.filter((r) => st.filters.every(([c, v]) => r[c] === v));
      if (st.op === 'update') for (const r of hit) Object.assign(r, st.payload);
      const copy = hit.map((r) => ({ ...r }));
      return { data: st.one ? copy[0] ?? null : copy, error: null };
    };
    const b: Row = {
      select: () => b, order: () => b,
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      // Follow-up E reads tasks and the ledger with in/limit: those tables are not modelled here, so they hold no rows.
      in: () => b, limit: () => b,
      maybeSingle: () => { st.one = true; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { rpc: () => { throw new Error('no rpc here'); } } }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const mockAuth = { allow: true };
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: 'u' })) }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async (_req: unknown, res: { status: (n: number) => { json: (j: unknown) => void } }) => {
    if (!mockAuth.allow) { res.status(401).json({ error: 'Authorization required', code: 'NOT_AUTHENTICATED' }); return { ok: false, sent: true }; }
    return { ok: true, principal: { userId: '00000000-0000-4000-8000-0000000000aa' } };
  }),
}));
const mockExit = jest.fn(async () => {
  mockCalls.push('exit');
  mockDb.instances[0].lifecycle_state = 'cancelled';
  return 2;
});
jest.mock('../../services/orchestration/journeyExit', () => ({ withdrawUnsentTasks: jest.fn(async () => undefined), exitJourney: (...a: unknown[]) => mockExit(...(a as [])) }));
jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  getPlanForInstance: jest.fn(async () => ({ id: '00000000-0000-4000-8000-000000000301', definitionSnapshot: {} })),
}));
const STEP = '00000000-0000-4000-8000-000000000201';
const mockStep = { id: STEP, state: 'ready', channel: 'whatsapp', stepKey: 'next', delayAfterPreviousHours: 0, notBefore: null as string | null };
jest.mock('../../services/workflowExecution/stepProgressionStore', () => ({
  listProgressionSteps: jest.fn(async () => [{ ...mockStep }]),
  deferStepUntil: jest.fn(async (i: { notBefore: string }) => { mockStep.notBefore = i.notBefore; return { ...mockStep }; }),
}));
const mockFacts = { personId: null as string | null, contacts: { email: 'Ana@Example.test', phone: '+44 7700 900123' } as { email: string | null; phone: string | null } | null };
jest.mock('../../services/orchestration/individualIntelligence', () => ({
  loadIndividualFacts: jest.fn(async () => ({ personId: mockFacts.personId, personTimezone: null, gaps: [], facts: {} })),
  durableIntelligencePort: { readPersonContacts: jest.fn(async () => mockFacts.contacts) },
}));
const mockCalls: string[] = [];
const mockGovernance = { fail: false, written: [] as Row[] };
jest.mock('../../services/prospectIdentity/contactGovernanceWriter', () => ({
  recordContactGovernance: jest.fn(async (i: Row) => {
    mockCalls.push('governance');
    if (mockGovernance.fail) throw Object.assign(new Error('write refused'), { code: '57014' });
    mockGovernance.written.push(i);
    return { id: `gov-${mockGovernance.written.length}`, outcome: 'created' };
  }),
}));
// G-11: the hold writer is the real one (over the writer double above); the review open is a double.
const mockReview = { fail: false, inputs: [] as Row[] };
jest.mock('../../services/orchestration/optOutReview', () => ({
  ...jest.requireActual('../../services/orchestration/optOutReview'),
  openOptOutReview: jest.fn(async (i: Row) => {
    mockCalls.push('review');
    if (mockReview.fail) throw Object.assign(new Error('review store down'), { code: 'review_write_failed' });
    mockReview.inputs.push(i);
    return { reviewId: 'rev-1', outcome: 'opened', dueAt: '2026-11-11T10:00:00.000Z' };
  }),
}));
jest.mock('../../services/orchestration/journeyGovernance', () => ({ channelRefusal: jest.fn(async () => null) }));
jest.mock('../../services/orchestration/journeyResponses', () => ({
  REPLY_AWAITING_EVALUATION: 'reply_awaiting_evaluation',
  durableJourneyResponsePort: { ws3Outcomes: async () => [], whatsappReply: async () => null },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/execution-instances/[id]').default;
const { awaitingReply } = require('../../services/orchestration/journeyReplyEvaluation');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-000000000101';
const KEY = 'a'.repeat(32);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function patch(body: Row): Promise<{ status: number; json: Row }> {
  const out = { status: 0, json: {} as Row };
  const res = {
    setHeader: () => res, status(n: number) { out.status = n; return res; }, json(j: Row) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method: 'PATCH', query: { id: RUN, company_id: ORG }, body, headers: {}, url: `/api/execution-instances/${RUN}` };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}
const suspension = (outcome = `reply_awaiting_evaluation:${KEY}`): Row => ({
  id: 'd0', organization_id: ORG, execution_instance_id: RUN, plan_step_id: STEP, step_key: 'next', channel: 'whatsapp', engine: 'whatsapp',
  decision: 'needs_human', outcome, reasons: [], decision_key: `${STEP}|needs_human|${outcome}`, decided_at: '2026-11-06T00:00:00.000Z',
});
const state = () => String(mockDb.instances[0].lifecycle_state);
const newDecisions = () => mockDb.decisions.filter((d) => d.id !== 'd0');

beforeEach(() => {
  mockAuth.allow = true;
  mockDb.failInsert = false;
  mockStep.notBefore = null;
  mockExit.mockClear();
  mockFacts.personId = null;
  mockFacts.contacts = { email: 'Ana@Example.test', phone: '+44 7700 900123' };
  mockReview.fail = false;
  mockReview.inputs = [];
  mockCalls.length = 0;
  mockGovernance.fail = false;
  mockGovernance.written = [];
  mockDb.instances = [{
    id: RUN, organization_id: ORG, campaign_id: 'c', workflow_id: 'w', workflow_version_id: 'v', target_id: null,
    subject_kind: 'prospect', subject_id: 'p', lifecycle_state: 'paused', created_at: 't0', updated_at: 't0',
  }];
  mockDb.decisions = [suspension()];
});

describe('the three evaluations, each recorded with its actor', () => {
  it('continue: the run resumes; a `waiting` decision names the actor and the reply', async () => {
    const r = await patch({ evaluation: 'continue' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ evaluation: { action: 'continue', notBefore: null, cancelledSteps: null }, auditFailed: false, instance: { lifecycleState: 'active' } });
    expect(state()).toBe('active');
    expect(newDecisions()).toEqual([expect.objectContaining({
      plan_step_id: STEP, decision: 'waiting', engine: null, outcome: `reply_evaluated:continue:${KEY}`,
      reasons: [`actor:${ACTOR}`, 'evaluation:continue', `reply:${KEY}`],
    })]);
  });

  it('retime: resumes through the Prompt 4 retiming with the floor; a `deferred` decision records it', async () => {
    const r = await patch({ evaluation: 'retime', returnDate: { kind: 'date', date: inDays(10) } });
    expect(r.status).toBe(200);
    expect(Date.parse(String((r.json.evaluation as Row).notBefore))).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    expect(mockStep.notBefore).not.toBeNull();
    expect(state()).toBe('active');
    const [d] = newDecisions();
    expect(d).toMatchObject({ decision: 'deferred', outcome: `reply_evaluated:retime:${KEY}` });
    expect((d.reasons as string[]).slice(0, 3)).toEqual([`actor:${ACTOR}`, 'evaluation:retime', `reply:${KEY}`]);
    expect((d.reasons as string[])[3]).toMatch(/^return_floor=\d{4}-/);
  });

  it('end: the run ends through exitJourney; an `exited` decision with the actor', async () => {
    const r = await patch({ evaluation: 'end' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ evaluation: { action: 'end', cancelledSteps: 2 }, instance: { lifecycleState: 'cancelled' } });
    expect(mockExit).toHaveBeenCalledWith(ORG, RUN);
    expect(newDecisions()).toEqual([expect.objectContaining({
      plan_step_id: null, decision: 'exited', outcome: 'cancelled_by_person', reasons: [`actor:${ACTOR}`, 'evaluation:end', `reply:${KEY}`],
    })]);
  });

  it('the actor is the authenticated principal, never a body field', async () => {
    await patch({ evaluation: 'continue', actorUserId: 'someone-else', actor: 'x' });
    expect((newDecisions()[0].reasons as string[])[0]).toBe(`actor:${ACTOR}`);
  });

  it('a decision that cannot be written is reported (auditFailed), and the evaluation stands', async () => {
    mockDb.failInsert = true;
    const r = await patch({ evaluation: 'continue' });
    expect(r).toMatchObject({ status: 200, json: { auditFailed: true } });
    expect(state()).toBe('active');
  });

  it('an already-evaluated reply is not evaluated again: 409, not a second decision', async () => {
    mockDb.decisions.push({ ...suspension(), id: 'dx', decision: 'waiting', outcome: `reply_evaluated:continue:${KEY}`, decision_key: 'other' });
    expect(await patch({ evaluation: 'continue' })).toMatchObject({ status: 409, json: { code: 'not_awaiting_evaluation' } });
    expect(state()).toBe('paused');
  });
});

describe('refusals', () => {
  it('auth: an unauthenticated request is refused by the guard; nothing moves, nothing is recorded', async () => {
    mockAuth.allow = false;
    const r = await patch({ evaluation: 'end' });
    expect(r.status).toBe(401);
    expect(state()).toBe('paused');
    expect(newDecisions()).toEqual([]);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it.each([['approve'], [''], [42], [null], [{ action: 'continue' }]])('an invalid action %p → 400 invalid_action', async (evaluation) => {
    const r = await patch({ evaluation });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('invalid_action');
    expect(state()).toBe('paused');
    expect(newDecisions()).toEqual([]);
  });

  it('evaluation together with lifecycleState → 400', async () => {
    const r = await patch({ evaluation: 'continue', lifecycleState: 'active' });
    expect(r.status).toBe(400);
    expect(state()).toBe('paused');
  });

  it.each(['active', 'queued', 'created', 'cancelled', 'completed'])('a %s (non-paused) run → 409 not_paused', async (s) => {
    mockDb.instances[0].lifecycle_state = s;
    for (const evaluation of ['continue', 'end']) {
      const r = await patch({ evaluation });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('not_paused');
    }
    expect(newDecisions()).toEqual([]);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('retime without a date → 400 return_date_required; continue/end with one → 400', async () => {
    expect(await patch({ evaluation: 'retime' })).toMatchObject({ status: 400, json: { code: 'return_date_required' } });
    expect(await patch({ evaluation: 'retime', returnDate: null })).toMatchObject({ status: 400, json: { code: 'return_date_required' } });
    expect(await patch({ evaluation: 'continue', returnDate: { kind: 'date', date: inDays(3) } })).toMatchObject({ status: 400, json: { code: 'return_date_not_allowed' } });
    expect(await patch({ evaluation: 'retime', returnDate: { kind: 'date', date: '2020-01-01' } })).toMatchObject({ status: 400, json: { code: 'return_date_in_past' } });
    expect(state()).toBe('paused');
    expect(newDecisions()).toEqual([]);
  });

  it('a pause that is not a reply awaiting evaluation → 409', async () => {
    mockDb.decisions = [suspension(`approval_revoked:${KEY}`)];
    expect(await patch({ evaluation: 'continue' })).toMatchObject({ status: 409, json: { code: 'not_awaiting_evaluation' } });
    mockDb.decisions = [];
    expect(await patch({ evaluation: 'continue' })).toMatchObject({ status: 409, json: { code: 'not_awaiting_evaluation' } });
    expect(state()).toBe('paused');
  });

  it('a missing run → 404', async () => {
    mockDb.instances[0].organization_id = '00000000-0000-4000-8000-0000000000ff';
    expect((await patch({ evaluation: 'continue' })).status).toBe(404);
  });
});

describe('awaitingReply: the latest suspension decides', () => {
  const d = (decision: string, outcome: string | null) => ({ decision, outcome, planStepId: STEP, stepKey: 'k', channel: 'whatsapp' });
  it('a later revocation outranks an earlier reply; a later reply after a revocation is the one awaited', () => {
    expect(awaitingReply([d('needs_human', `reply_awaiting_evaluation:${KEY}`), d('needs_human', 'approval_revoked:x')])).toBeNull();
    expect(awaitingReply([d('needs_human', 'approval_revoked:x'), d('needs_human', `reply_awaiting_evaluation:${KEY}`)])).toMatchObject({ replyKey: KEY });
    expect(awaitingReply([d('needs_human', 'running_step_unattended'), d('needs_human', `reply_awaiting_evaluation:${KEY}`)])).toMatchObject({ replyKey: KEY });
  });
});

describe('opt_out (owner decision G-11): a free-text opt-out is never contacted again', () => {
  const PERSON = '00000000-0000-4000-8000-0000000000f1';

  const HOLD = { organizationId: ORG, governanceType: 'unsubscribe', channel: '*', source: 'optout_review:reply_opt_out' };
  const REF = `${RUN}:${KEY}`;

  it('writes the all-channel holds on the person, the CANONICAL address and number FIRST, opens the review, then ends the run', async () => {
    mockFacts.personId = PERSON;
    const r = await patch({ evaluation: 'opt_out' });
    expect(r.status).toBe(200);
    expect(mockCalls).toEqual(['governance', 'governance', 'governance', 'review', 'exit']);
    expect(mockGovernance.written).toEqual([
      expect.objectContaining({ ...HOLD, personId: PERSON }),
      expect.objectContaining({ ...HOLD, target: 'ana@example.test' }),
      expect.objectContaining({ ...HOLD, target: '+447700900123' }),
    ]);
    for (const w of mockGovernance.written) {
      expect(w).not.toHaveProperty('purposeScope');
      expect(w).not.toHaveProperty('sourceRecordId');            // an LI-2 foreign key: the ref lives in evidence
      expect(w.evidence).toEqual({ actor: ACTOR, reason: 'free_text_opt_out', reply: KEY, executionInstanceId: RUN, source_ref: REF });
    }
    expect(mockReview.inputs).toEqual([{
      organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'reply_opt_out',
      holdIds: ['gov-1', 'gov-2', 'gov-3'], sourceRef: REF, holdSource: 'optout_review:reply_opt_out', now: undefined,
    }]);
    expect(state()).toBe('cancelled');
    const [d] = newDecisions();
    expect(d).toMatchObject({ decision: 'exited', outcome: 'unsubscribed' });
    expect(d.reasons).toEqual([`actor:${ACTOR}`, 'evaluation:opt_out', `reply:${KEY}`, 'governance:gov-1', 'governance:gov-2', 'governance:gov-3', 'optout_review:rev-1']);
  });

  it('a person with no known address or number: the person hold alone, then the review', async () => {
    mockFacts.personId = PERSON;
    mockFacts.contacts = { email: null, phone: null };
    expect((await patch({ evaluation: 'opt_out' })).status).toBe(200);
    expect(mockGovernance.written).toEqual([expect.objectContaining({ ...HOLD, personId: PERSON })]);
    expect(mockCalls).toEqual(['governance', 'review', 'exit']);
  });

  it('no person behind the run: 409 person_unknown, nothing written, the run stays paused', async () => {
    const r = await patch({ evaluation: 'opt_out' });
    expect(r).toMatchObject({ status: 409, json: { code: 'person_unknown' } });
    expect(mockCalls).toEqual([]);
    expect(state()).toBe('paused');
    expect(newDecisions()).toEqual([]);
  });

  it('the hold cannot be written: 503, no review, the run is NOT ended and stays paused', async () => {
    mockFacts.personId = PERSON;
    mockGovernance.fail = true;
    const r = await patch({ evaluation: 'opt_out' });
    expect(r).toMatchObject({ status: 503, json: { code: 'governance_write_failed' } });
    expect(mockCalls).toEqual(['governance']);
    expect(mockExit).not.toHaveBeenCalled();
    expect(state()).toBe('paused');
    expect(newDecisions()).toEqual([]);
  });

  it('the address and number cannot be read: 503 before any write, the run stays paused', async () => {
    mockFacts.personId = PERSON;
    mockFacts.contacts = null;
    expect(await patch({ evaluation: 'opt_out' })).toMatchObject({ status: 503, json: { code: 'governance_write_failed' } });
    expect(mockCalls).toEqual([]);
    expect(state()).toBe('paused');
  });

  it('the review cannot be opened after the holds: 503, the holds stand, the run stays paused; the retry ends it', async () => {
    mockFacts.personId = PERSON;
    mockReview.fail = true;
    const r = await patch({ evaluation: 'opt_out' });
    expect(r).toMatchObject({ status: 503, json: { code: 'governance_write_failed' } });
    expect(mockCalls).toEqual(['governance', 'governance', 'governance', 'review']);
    expect(mockExit).not.toHaveBeenCalled();
    expect(state()).toBe('paused');
    expect(newDecisions()).toEqual([]);
    mockReview.fail = false;
    expect((await patch({ evaluation: 'opt_out' })).status).toBe(200);
    expect(mockReview.inputs[0]).toMatchObject({ sourceRef: REF, holdSource: 'optout_review:reply_opt_out' });   // the same ref: the retry adopts
    expect(state()).toBe('cancelled');
  });

  it('a returnDate is refused with opt_out, and only a paused, awaiting run is opted out', async () => {
    mockFacts.personId = PERSON;
    expect(await patch({ evaluation: 'opt_out', returnDate: { kind: 'date', date: inDays(3) } })).toMatchObject({ status: 400, json: { code: 'return_date_not_allowed' } });
    mockDb.instances[0].lifecycle_state = 'active';
    expect(await patch({ evaluation: 'opt_out' })).toMatchObject({ status: 409, json: { code: 'not_paused' } });
    expect(mockCalls).toEqual([]);
  });
});

describe('nothing from an evaluation reaches PI (P-1 = a)', () => {
  it('the evaluation module imports no lifecycle, feedback or event-feeding code', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/orchestration/journeyReplyEvaluation.ts'), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '../executionInstances/executionInstanceStore',
      './individualIntelligence', './journeyDecisionLog', './journeyEvents', './journeyExit', './journeyResponses', './journeyRetiming', './optOutReview',
    ]);
    expect(src).not.toMatch(/prospectLifecycle|journeyFeedback|feedWhatsApp|recordProspectTransition|interpretOutcome/);
  });

  // PI review F-2: the evaluation calls exitJourney, resumeJourneyWithReturnDate and the decision
  // log, so a PI feed added to any module it reaches would break P-1. Walk the whole closure of
  // relative imports, static `from '...'` AND dynamic `import('...')` (PI review F-2b: the one
  // alias writer in the repo is reached only through a dynamic import), comments stripped.
  // One boundary: backend/queue/jobProcessors/ is not entered. Those modules are loaded only
  // inside a BullMQ Worker's job handler (bullmqClient getEngagementPollingWorker); the
  // evaluation reaches bullmqClient only for getSharedRedisClient (leadOutreachExecution/quota),
  // and never starts a worker. Without the boundary the graph pulls in every queue job's code.
  it('no module the evaluation reaches imports or calls a PI writer or the feedback path', () => {
    const root = path.resolve(__dirname, '../../services/orchestration/journeyReplyEvaluation.ts');
    const seen = new Set<string>();
    const queue = [root];
    while (queue.length) {
      const file = queue.shift() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
        const base = path.resolve(path.dirname(file), m[1]);
        const hit = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
        if (hit && !/[\\/]queue[\\/]jobProcessors[\\/]/.test(hit)) queue.push(hit);
      }
    }
    const rel = [...seen].map((f) => path.relative(path.resolve(__dirname, '../..'), f).replace(/\\/g, '/'));
    expect(rel).toContain('services/orchestration/journeyExit.ts');
    expect(rel).toContain('services/orchestration/journeyRetiming.ts');
    // PI is READ to decide closure (stateModel, lifecycleReader, provenance readers). The alias
    // store is reached by a read edge only (leadIntelligenceReadService imports
    // readProspectAliases); its writer recordProspectAlias is pinned unreachable below. No
    // lifecycle writer, interpreter, producer or barrel may be reached. A new PI module in the
    // closure fails here and needs a PI review before it is added to this list.
    expect(rel.filter((f) => /prospectLifecycle\/|prospectProvenance\//.test(f)).sort()).toEqual([
      '../lib/prospectProvenance/contract.ts',
      '../lib/prospectProvenance/prospectAliases.ts',
      '../lib/prospectProvenance/scoreSemantics.ts',
      'services/prospectLifecycle/lifecycleReader.ts',
      'services/prospectLifecycle/stateModel.ts',
      'services/prospectProvenance/accountReader.ts',
      'services/prospectProvenance/contributionReader.ts',
      'services/prospectProvenance/prospectAliasStore.ts',
    ]);
    expect(rel.filter((f) => /lifecycleWriter|outcomeInterpreter|outcomeLifecycleProducer|contributionWriter|journeyFeedback|prospectLifecycle\/index/.test(f))).toEqual([]);
    const callers = [...seen].filter((f) => /feedWhatsApp|recordProspectTransition|interpretOutcome|writeLifecycleTransition/
      .test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(callers.map((f) => path.basename(f))).toEqual([]);
    // The alias writer is defined in prospectAliasStore; no OTHER module in the closure may name it.
    const aliasWriters = [...seen].filter((f) => !f.endsWith('prospectAliasStore.ts')
      && /\brecordProspectAlias\b/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(aliasWriters.map((f) => path.basename(f))).toEqual([]);
    // The jobProcessors/ boundary is crossed in exactly one documented place. A request-path
    // module that imports a processor to run it fails here and comes back to review.
    const processorImporters = [...seen].filter((f) => /jobProcessors\//
      .test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(processorImporters.map((f) => path.relative(path.resolve(__dirname, '../..'), f).replace(/\\/g, '/'))).toEqual(['queue/bullmqClient.ts']);
  });
});
