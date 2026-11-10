/**
 * Orchestration, Follow-up E — operator warnings for unresolved uncertain communications.
 *
 * The real module (uncertainCommunicationAcknowledgement.ts) over an in-memory ledger, task,
 * run and acknowledgement store that enforces the acknowledgement table's UNIQUE key (23505)
 * like the migration does. The real routes are exercised in
 * realschema/e_uncertain_acknowledgement_real.test.ts.
 */
type Row = Record<string, unknown>;

const mockDb: {
  tasks: Row[]; requests: Row[]; instances: Row[]; acks: Row[];
  failRead: string | null; failInsert: boolean; selects: string[];
} = { tasks: [], requests: [], instances: [], acks: [], failRead: null, failInsert: false, selects: [] };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: null as Row | null, filters: [] as Array<(r: Row) => boolean>, limit: Infinity };
    const tableRows = (): Row[] => {
      if (table === 'execution_tasks') return mockDb.tasks;
      if (table === 'execution_engine_requests') return mockDb.requests;
      if (table === 'execution_uncertain_acknowledgements') return mockDb.acks;
      throw new Error(`double: unexpected table ${table}`);
    };
    const exec = async () => {
      if (mockDb.failRead === table && st.op === 'select') return { data: null, error: { code: '57014', message: 'read refused' } };
      const t = tableRows();
      if (st.op === 'insert') {
        if (mockDb.failInsert) return { data: null, error: { code: '57014', message: 'write refused' } };
        const row = st.payload as Row;
        if (t.some((r) => r.organization_id === row.organization_id && r.acknowledgement_key === row.acknowledgement_key)) {
          return { data: null, error: { code: '23505', message: 'execution_uncertain_acks_key_unique' } };
        }
        const stored = { id: `ack-${t.length + 1}`, acknowledged_at: new Date().toISOString(), ...row };
        t.push(stored);
        return { data: [{ id: stored.id }], error: null };
      }
      return { data: t.filter((r) => st.filters.every((f) => f(r))).slice(0, st.limit).map((r) => ({ ...r })), error: null };
    };
    const b: Row = {
      select: (cols: string) => { mockDb.selects.push(`${table}:${cols}`); return b; },
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: () => { throw new Error('double: this module must never update'); },
      delete: () => { throw new Error('double: this module must never delete'); },
      eq: (c: string, v: unknown) => { st.filters.push((r) => r[c] === v); return b; },
      in: (c: string, v: unknown[]) => { st.filters.push((r) => v.includes(r[c])); return b; },
      order: () => b,
      limit: (n: number) => { st.limit = n; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));
jest.mock('../../services/executionInstances/executionInstanceStore', () => ({
  listSubjectExecutionInstances: jest.fn(async (org: string, kind: string, id: string) => {
    if (mockDb.failRead === 'execution_instances') throw Object.assign(new Error('subject instance listing failed'), { code: 'read_failed' });
    return mockDb.instances
      .filter((r) => r.organization_id === org && r.subject_kind === kind && r.subject_id === id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((r) => ({ id: r.id }));
  }),
}));

import {
  checkUncertainAcknowledgement, acknowledgementKeyFor, acknowledgementRefusalBody,
  type AcknowledgementCheck, type UncertaintyScope,
} from '../../services/orchestration/uncertainCommunicationAcknowledgement';

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ACTOR_2 = '00000000-0000-4000-8000-0000000000bb';
const CAMPAIGN = '00000000-0000-4000-8000-0000000000c1';
const WORKFLOW = '00000000-0000-4000-8000-0000000000f1';
const RUN_1 = 'run-1';
const RUN_2 = 'run-2';

let n = 0;
/** A run of `subject` with one task on `channel` and a ledger request in `state`. */
function seed(opts: { org?: string; run?: string; subject?: string; channel?: string; state?: string; queuedAt?: string | null; ref?: string | null; createdAt?: string } = {}) {
  n += 1;
  const org = opts.org ?? ORG;
  const run = opts.run ?? RUN_1;
  const subject = opts.subject ?? 'p-1';
  if (!mockDb.instances.some((r) => r.id === run)) {
    mockDb.instances.push({ id: run, organization_id: org, subject_kind: 'prospect', subject_id: subject, created_at: opts.createdAt ?? `2026-11-0${n}T00:00:00Z` });
  }
  const task = `task-${n}`;
  mockDb.tasks.push({ id: task, organization_id: org, execution_instance_id: run, subject_kind: 'prospect', subject_id: subject, channel: opts.channel ?? 'whatsapp' });
  const request = `req-${String(n).padStart(3, '0')}`;
  if (opts.state !== undefined) {
    mockDb.requests.push({
      id: request, organization_id: org, execution_task_id: task, engine: 'whatsapp', state: opts.state,
      queued_at: opts.queuedAt === undefined ? '2026-11-09T10:00:00.000Z' : opts.queuedAt,
      external_ref: opts.ref === undefined ? `bcast-${n}` : opts.ref,
    });
  }
  return { task, request, run };
}

const endRun = (over: Partial<Parameters<typeof checkUncertainAcknowledgement>[0]> = {}) => checkUncertainAcknowledgement({
  organizationId: ORG, operation: 'end_run', scope: { kind: 'run', executionInstanceId: RUN_1 },
  actorUserId: ACTOR, acknowledgementKey: undefined, onUnreadable: 'warn', ...over,
});
const subjectScope = (subject = 'p-1'): UncertaintyScope => ({ kind: 'subject', subjectKind: 'prospect', subjectId: subject, campaignId: CAMPAIGN, workflowId: WORKFLOW });
const reenrol = (over: Partial<Parameters<typeof checkUncertainAcknowledgement>[0]> = {}) => checkUncertainAcknowledgement({
  organizationId: ORG, operation: 'reenrol', scope: subjectScope(),
  actorUserId: ACTOR, acknowledgementKey: undefined, onUnreadable: 'refuse', ...over,
});
const warningOf = (c: AcknowledgementCheck) => {
  if (c.ok === true || !('warning' in c)) throw new Error(`expected a warning, got ${JSON.stringify(c)}`);
  return c.warning;
};

beforeEach(() => {
  n = 0;
  mockDb.tasks = []; mockDb.requests = []; mockDb.instances = []; mockDb.acks = [];
  mockDb.failRead = null; mockDb.failInsert = false; mockDb.selects = [];
});

describe('E: ending a run', () => {
  it('no uncertain communication: no warning, nothing recorded', async () => {
    seed({ state: 'completed' });
    seed({ state: 'failed' });
    seed({ state: 'submitted' });
    expect(await endRun()).toEqual({ ok: true, acknowledged: null });
    expect(mockDb.acks).toEqual([]);
  });

  it('one unresolved uncertain communication: the operation is held with a warning that names it', async () => {
    const s = seed({ state: 'uncertain', ref: 'bcast-77', queuedAt: '2026-11-09T10:00:00.000Z' });
    const c = await endRun();
    expect(c).toMatchObject({ ok: false, status: 409, code: 'uncertain_communication_unacknowledged' });
    const w = warningOf(c);
    expect(w.communications).toEqual([{
      requestId: s.request, executionTaskId: s.task, executionInstanceId: RUN_1,
      engine: 'whatsapp', channel: 'whatsapp', queuedAt: '2026-11-09T10:00:00.000Z', reference: 'bcast-77',
    }]);
    expect(w.message).toMatch(/may already have been sent/);
    expect(w.message).toMatch(/duplicate/);
    expect(w.message).toMatch(/approves nothing, sends nothing and resolves nothing/);
    expect(w.acknowledgementIsNotApproval).toBe(true);
    expect(w.acknowledgementKey).toMatch(/^[0-9a-f]{64}$/);
    expect(mockDb.acks).toEqual([]);
  });

  it('several uncertain communications: every one is shown, in a stable order', async () => {
    const a = seed({ state: 'uncertain' });
    seed({ state: 'completed' });
    const b = seed({ state: 'uncertain', channel: 'linkedin', ref: null, queuedAt: null });
    const w = warningOf(await endRun());
    expect(w.communications.map((x) => x.requestId)).toEqual([a.request, b.request]);
    expect(w.communications[1]).toMatchObject({ channel: 'linkedin', reference: null, queuedAt: null });
  });

  it('a non-contact channel is not a communication to the person and is not warned about', async () => {
    seed({ state: 'uncertain', channel: 'social_post' });
    seed({ state: 'uncertain', channel: 'internal' });
    expect(await endRun()).toEqual({ ok: true, acknowledged: null });
  });

  it('the matching acknowledgement is recorded with the actor, operation, run and communication references', async () => {
    const s = seed({ state: 'uncertain', ref: 'bcast-9' });
    const key = warningOf(await endRun()).acknowledgementKey;
    const c = await endRun({ acknowledgementKey: key });
    expect(c).toEqual({ ok: true, acknowledged: { id: 'ack-1', repeated: false } });
    expect(mockDb.acks).toHaveLength(1);
    expect(mockDb.acks[0]).toMatchObject({
      organization_id: ORG, operation: 'end_run', execution_instance_id: RUN_1, campaign_id: null, workflow_id: null,
      actor_user_id: ACTOR, history_unreadable: false, acknowledgement_key: key,
    });
    expect(mockDb.acks[0].communications).toEqual([expect.objectContaining({ requestId: s.request, reference: 'bcast-9' })]);
    expect(typeof mockDb.acks[0].acknowledged_at).toBe('string');
  });

  it('a repeated request records nothing new: one acknowledgement, the same id', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await endRun()).acknowledgementKey;
    await endRun({ acknowledgementKey: key });
    const again = await endRun({ acknowledgementKey: key });
    expect(again).toEqual({ ok: true, acknowledged: { id: 'ack-1', repeated: true } });
    expect(mockDb.acks).toHaveLength(1);
  });

  it('concurrent identical acknowledgements converge on one record, and both may continue', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await endRun()).acknowledgementKey;
    const [x, y] = await Promise.all([endRun({ acknowledgementKey: key }), endRun({ acknowledgementKey: key })]);
    expect(x.ok && y.ok).toBe(true);
    expect(mockDb.acks).toHaveLength(1);
  });

  it('a rejected or incomplete acknowledgement does not let the operation continue', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await endRun()).acknowledgementKey;
    for (const bad of [undefined, null, '', '   ', 42, true, {}, key.slice(0, 63), `${key}0`, 'f'.repeat(64)]) {
      const c = await endRun({ acknowledgementKey: bad });
      expect(c.ok).toBe(false);
    }
    expect(mockDb.acks).toEqual([]);
  });

  it('a new uncertain communication after the warning makes the old acknowledgement stale', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await endRun()).acknowledgementKey;
    seed({ state: 'uncertain' });
    const c = await endRun({ acknowledgementKey: key });
    expect(c).toMatchObject({ ok: false, status: 409, code: 'acknowledgement_stale' });
    expect(warningOf(c).communications).toHaveLength(2);
    expect(mockDb.acks).toEqual([]);
  });

  it('only an authenticated person can acknowledge; an unknown actor records nothing', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await endRun()).acknowledgementKey;
    for (const actor of [undefined, null, '', 'not-a-uuid', 7]) {
      const c = await endRun({ actorUserId: actor, acknowledgementKey: key });
      expect(c).toMatchObject({ ok: false, status: 403, code: 'acknowledging_person_unknown' });
    }
    expect(mockDb.acks).toEqual([]);
  });

  it('an acknowledgement is bound to the person who saw the warning: another operator is warned afresh', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await endRun()).acknowledgementKey;
    const c = await endRun({ actorUserId: ACTOR_2, acknowledgementKey: key });
    expect(c).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
    expect(warningOf(c).acknowledgementKey).not.toBe(key);
  });

  it('an end_run acknowledgement cannot be used for another run', async () => {
    seed({ state: 'uncertain', run: RUN_1 });
    seed({ state: 'uncertain', run: RUN_2 });
    const key = warningOf(await endRun()).acknowledgementKey;
    const c = await endRun({ scope: { kind: 'run', executionInstanceId: RUN_2 }, acknowledgementKey: key });
    expect(c).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
  });

  it('an unreadable history is itself the warning: acknowledged as unreadable, then the run may end', async () => {
    seed({ state: 'uncertain' });
    mockDb.failRead = 'execution_engine_requests';
    const c = await endRun();
    const w = warningOf(c);
    expect(w.historyUnreadable).toBe(true);
    expect(w.communications).toEqual([]);
    expect(w.message).toMatch(/could not be read/);
    const done = await endRun({ acknowledgementKey: w.acknowledgementKey });
    expect(done.ok).toBe(true);
    expect(mockDb.acks[0]).toMatchObject({ history_unreadable: true, communications: [] });
  });

  it('a malformed ledger row is an unreadable history, never "nothing to warn about"', async () => {
    seed({ state: 'uncertain' });
    mockDb.requests[0].id = null;
    expect(warningOf(await endRun()).historyUnreadable).toBe(true);
  });

  it('an unreadable history that the caller says to refuse is refused (503)', async () => {
    mockDb.failRead = 'execution_tasks';
    expect(await endRun({ onUnreadable: 'refuse' })).toMatchObject({ ok: false, status: 503, code: 'uncertainty_history_unreadable' });
  });

  it('an acknowledgement that cannot be recorded stops the operation (503), never continues unrecorded', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await endRun()).acknowledgementKey;
    mockDb.failInsert = true;
    expect(await endRun({ acknowledgementKey: key })).toMatchObject({ ok: false, status: 503, code: 'acknowledgement_unrecorded' });
  });
});

describe('E: enrolling a person again', () => {
  it('no earlier run, or no unresolved uncertainty: the normal flow', async () => {
    expect(await reenrol()).toEqual({ ok: true, acknowledged: null });
    seed({ state: 'completed' });
    seed({ state: 'skipped' });
    expect(await reenrol()).toEqual({ ok: true, acknowledged: null });
  });

  it('an uncertain communication from an earlier run holds the enrolment, naming that run', async () => {
    const s = seed({ state: 'uncertain', run: RUN_1, ref: 'bcast-1' });
    const c = await reenrol();
    expect(c).toMatchObject({ ok: false, status: 409, code: 'uncertain_communication_unacknowledged' });
    const w = warningOf(c);
    expect(w.operation).toBe('reenrol');
    expect(w.communications).toEqual([expect.objectContaining({ requestId: s.request, executionInstanceId: RUN_1, reference: 'bcast-1' })]);
    expect(w.message).toMatch(/Enrolling them again could contact them a second time/);
    expect(w.message).toMatch(/consent, suppression, opt-out, approval, frequency/);
  });

  it('the acknowledgement is recorded against the person\'s latest run and the target campaign and workflow', async () => {
    seed({ state: 'uncertain', run: RUN_1, createdAt: '2026-11-01T00:00:00Z' });
    seed({ run: RUN_2, createdAt: '2026-11-05T00:00:00Z' });                      // a later run, no uncertainty of its own
    const key = warningOf(await reenrol()).acknowledgementKey;
    expect((await reenrol({ acknowledgementKey: key })).ok).toBe(true);
    expect(mockDb.acks[0]).toMatchObject({ operation: 'reenrol', execution_instance_id: RUN_2, campaign_id: CAMPAIGN, workflow_id: WORKFLOW, actor_user_id: ACTOR });
  });

  it('it is specific to the person: another person\'s acknowledgement does not carry over', async () => {
    seed({ state: 'uncertain', run: RUN_1, subject: 'p-1' });
    seed({ state: 'uncertain', run: RUN_2, subject: 'p-2' });
    const key = warningOf(await reenrol()).acknowledgementKey;
    const c = await reenrol({ scope: subjectScope('p-2'), acknowledgementKey: key });
    expect(c).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
  });

  it('it is specific to the operation: an end_run key cannot enrol, and a reenrol key cannot end a run', async () => {
    seed({ state: 'uncertain', run: RUN_1 });
    const endKey = warningOf(await endRun()).acknowledgementKey;
    const enrolKey = warningOf(await reenrol()).acknowledgementKey;
    expect(endKey).not.toBe(enrolKey);
    expect(await reenrol({ acknowledgementKey: endKey })).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
    expect(await endRun({ acknowledgementKey: enrolKey })).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
  });

  it('it is specific to the target: another campaign or workflow is warned afresh', async () => {
    seed({ state: 'uncertain', run: RUN_1 });
    const key = warningOf(await reenrol()).acknowledgementKey;
    const other: UncertaintyScope = { kind: 'subject', subjectKind: 'prospect', subjectId: 'p-1', campaignId: CAMPAIGN, workflowId: '00000000-0000-4000-8000-0000000000f2' };
    expect(await reenrol({ scope: other, acknowledgementKey: key })).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
  });

  it('a newer run with the SAME creation time still changes the key (rows written in one transaction share now())', async () => {
    seed({ state: 'uncertain', run: RUN_1, createdAt: '2026-11-01T00:00:00Z' });
    const key = warningOf(await reenrol()).acknowledgementKey;
    mockDb.instances.push({ id: 'run-0', organization_id: ORG, subject_kind: 'prospect', subject_id: 'p-1', created_at: '2026-11-01T00:00:00Z' });
    expect(await reenrol({ acknowledgementKey: key })).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
  });

  it('a person with too many runs to read whole is refused (fail closed)', async () => {
    seed({ state: 'uncertain', run: RUN_1 });
    for (let i = 0; i < 1000; i += 1) mockDb.instances.push({ id: `bulk-${i}`, organization_id: ORG, subject_kind: 'prospect', subject_id: 'p-1', created_at: '2026-10-01T00:00:00Z' });
    expect(await reenrol()).toMatchObject({ ok: false, status: 503, code: 'uncertainty_history_unreadable' });
  });

  it('an old acknowledgement cannot authorize a LATER re-enrolment: once a newer run exists the key no longer matches', async () => {
    seed({ state: 'uncertain', run: RUN_1, createdAt: '2026-11-01T00:00:00Z' });
    const key = warningOf(await reenrol()).acknowledgementKey;
    expect((await reenrol({ acknowledgementKey: key })).ok).toBe(true);
    // the enrolment happened, and that run later ended: the person now has a newer run
    mockDb.instances.push({ id: 'run-3', organization_id: ORG, subject_kind: 'prospect', subject_id: 'p-1', created_at: '2026-11-08T00:00:00Z' });
    const replay = await reenrol({ acknowledgementKey: key });
    expect(replay).toMatchObject({ ok: false, code: 'acknowledgement_stale' });
    expect(mockDb.acks).toHaveLength(1);
  });

  it('the ledger read is tenant-scoped itself, not only through the tasks: a foreign tenant\'s row is never shown', async () => {
    const s1 = seed({ state: 'uncertain', run: RUN_1 });
    // A row of another tenant naming this tenant's task: the database forbids it (composite FK),
    // and the read must not depend on that alone.
    mockDb.requests.push({ id: 'req-foreign', organization_id: OTHER_ORG, execution_task_id: s1.task, engine: 'whatsapp', state: 'uncertain', queued_at: null, external_ref: 'foreign' });
    const w = warningOf(await endRun());
    expect(w.communications.map((c) => c.requestId)).toEqual([s1.request]);
  });

  it('another tenant cannot discover this tenant\'s uncertain history', async () => {
    seed({ state: 'uncertain', org: ORG, run: RUN_1, subject: 'p-1' });
    const c = await reenrol({ organizationId: OTHER_ORG });
    expect(c).toEqual({ ok: true, acknowledged: null });
    const e = await endRun({ organizationId: OTHER_ORG });
    expect(e).toEqual({ ok: true, acknowledged: null });
  });

  it('an unreadable history refuses the enrolment (fail closed), never warns-and-continues', async () => {
    for (const t of ['execution_instances', 'execution_tasks', 'execution_engine_requests']) {
      mockDb.failRead = t;
      seed({ state: 'uncertain' });
      expect(await reenrol()).toMatchObject({ ok: false, status: 503, code: 'uncertainty_history_unreadable' });
      expect(await reenrol({ onUnreadable: 'warn' })).toMatchObject({ ok: false, status: 503 });   // a subject scope never warns-and-continues
    }
    expect(mockDb.acks).toEqual([]);
  });

  it('a preview warns and records nothing, even with the right key', async () => {
    seed({ state: 'uncertain' });
    const key = warningOf(await reenrol({ record: false })).acknowledgementKey;
    expect(await reenrol({ acknowledgementKey: key, record: false })).toEqual({ ok: true, acknowledged: { id: null, repeated: false } });
    expect(mockDb.acks).toEqual([]);
  });
});

describe('E: acknowledgement is not approval, and changes nothing it reads', () => {
  it('the ledger is never written: the request stays uncertain with its reference and time', async () => {
    seed({ state: 'uncertain', ref: 'bcast-5' });
    const before = JSON.stringify(mockDb.requests);
    const key = warningOf(await endRun()).acknowledgementKey;
    await endRun({ acknowledgementKey: key });
    expect(JSON.stringify(mockDb.requests)).toBe(before);
    expect(mockDb.requests[0].state).toBe('uncertain');
  });

  it('reads only the ledger columns it shows, and only uncertain rows, tenant first', async () => {
    seed({ state: 'uncertain' });
    await endRun();
    expect(mockDb.selects).toContain('execution_engine_requests:id, execution_task_id, engine, queued_at, external_ref');
    expect(mockDb.selects).toContain('execution_tasks:id, channel, execution_instance_id');
  });

  it('the source has no send, claim, approval, suppression or ledger write path', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(process.cwd(), 'backend/services/orchestration/uncertainCommunicationAcknowledgement.ts'), 'utf8') as string;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      .replace(/createHash\('sha256'\)\.update\(/g, 'createHash(');   // the key's hash, not a database write
    expect(code).not.toMatch(/\.update\(|\.delete\(|\.upsert\(|ownedDbRpc|orch_claim_engine_request/);
    // Identifiers and calls only: the operator's message text names the checks that still apply.
    expect(code).not.toMatch(/execution_approvals|contact_governance|recordContactGovernance|\w*[Ss]uppress\w*\(|sendWhatsApp|dispatch\w*\(|enqueue\w*\(|import[^;]*(leadOutreachExecution|whatsappBroadcastService|communityAi|approval)/);
    expect(code).not.toMatch(/state:\s*'(sent|delivered|completed|failed|skipped)'/);
    expect(code.match(/\.insert\(/g)).toHaveLength(1);
    expect(code).toMatch(/ownedDbTable\(UNCERTAIN_ACKNOWLEDGEMENTS_TABLE\)\s*\.insert/);
  });

  it('the refusal body never carries anything but the code, the reason and the warning', async () => {
    seed({ state: 'uncertain' });
    const c = await endRun();
    if (c.ok === true) throw new Error('expected a refusal');
    expect(Object.keys(acknowledgementRefusalBody(c)).sort()).toEqual(['code', 'error', 'warning']);
    mockDb.failRead = 'execution_tasks';
    const r = await reenrol();
    if (r.ok === true) throw new Error('expected a refusal');
    expect(Object.keys(acknowledgementRefusalBody(r)).sort()).toEqual(['code', 'error']);
  });

  it('the key binds every element: changing any one changes the key', () => {
    const base = {
      organizationId: ORG, operation: 'end_run' as const, anchorInstanceId: RUN_1, runIds: [RUN_1, RUN_2], campaignId: null, workflowId: null,
      actorUserId: ACTOR, requestIds: ['a', 'b'], historyUnreadable: false,
    };
    const k = acknowledgementKeyFor(base);
    expect(acknowledgementKeyFor({ ...base, requestIds: ['b', 'a'] })).toBe(k);                // order-independent
    expect(acknowledgementKeyFor({ ...base, runIds: [RUN_2, RUN_1] })).toBe(k);
    expect(acknowledgementKeyFor({ ...base, actorUserId: ACTOR.toUpperCase() })).toBe(k);     // uuid case
    for (const changed of [
      { organizationId: OTHER_ORG }, { operation: 'reenrol' as const }, { anchorInstanceId: RUN_2 }, { runIds: [RUN_1] }, { runIds: [RUN_1, RUN_2, 'run-3'] },
      { campaignId: CAMPAIGN }, { workflowId: WORKFLOW }, { actorUserId: ACTOR_2 }, { requestIds: ['a'] },
      { requestIds: ['a', 'b', 'c'] }, { historyUnreadable: true },
    ]) {
      expect(acknowledgementKeyFor({ ...base, ...changed })).not.toBe(k);
    }
  });
});
