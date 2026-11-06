/**
 * D-02 security regression — the independent review's repro suite (D02-SECURITY-REVIEW-r2,
 * sec-review/d02secReview.test.ts), converted: every SEC-* attack it demonstrated is now
 * asserted REFUSED, and its three controls (SEC-OK*) still hold.
 *
 * Mocked in the WS-3 dispatch suites' own style (an in-memory table fake behind
 * `ownedDbTable`). The database-backed proofs, including the claim-time trigger, are in
 * realschema/d02_approval_binding.test.ts. The WebAuthn service is replaced by a faithful
 * in-memory double of its contract: one stored challenge per ceremony, user-bound,
 * five-minute TTL, consumed on first use. W1 runs the REAL verifier.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  /** Reads of this table fail (an unreadable store). */
  failTable: null as string | null,
  /** Every status write to outreach_tasks: target status and rows it changed. */
  statusWrites: [] as Array<{ to: unknown; changed: number }>,
  onInsert: null as null | ((table: string, row: Row) => Promise<void>),
};
const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items', 'outreach_approvals'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) =>
      st.filters.every(([c, v]) => {
        if (c.startsWith('__gte__')) return String(r[c.slice(7)] ?? '') >= String(v);
        if (c.startsWith('__is__')) return (r[c.slice(6)] ?? null) === v;
        if (c.startsWith('__in__')) return Array.isArray(v) && (v as unknown[]).includes(r[c.slice(6)]);
        return r[c] === v;
      });
    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (st.op === 'select' && db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };
      if (st.op === 'insert') {
        if (db.onInsert) await db.onInsert(table, st.payload as Row);
        const row = st.payload as Row;
        if (table === 'outreach_attempts'
          && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
          return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
        }
        const created = { ...row, id: row.id ?? `${table}-${db.nextId++}`, created_at: '2026-11-03T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) return { data: null, error: { code: '2F004', message: `${table} is append-only` } };
        const affected = rows().filter(matches);
        for (const r of affected) Object.assign(r, st.payload);
        if (table === 'outreach_tasks' && st.payload && 'status' in st.payload) db.statusWrites.push({ to: st.payload.status, changed: affected.length });
        return { data: affected.map((r) => ({ id: r.id })), error: null };
      }
      const found = rows().filter(matches);
      if (table === 'outreach_approvals') found.sort((a, b) => String(a.decided_at).localeCompare(String(b.decided_at)));
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      gte: (c: string, v: unknown) => { st.filters.push([`__gte__${c}`, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([`__is__${c}`, v]); return b; },
      in: (c: string, v: unknown[]) => { st.filters.push([`__in__${c}`, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no client in this suite'); } } }));

const fakeRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) + n; this.store.set(k, v); return v; },
  async decrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) - n; this.store.set(k, v); return v; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => fakeRedis }));

/** What a journey email would say right now. Edited by the tests to simulate content edits. */
const mockEmail = { subject: 'Hello Ada', body: 'A short intro.', email: 'ada@bigcorp.example', workflowVersionId: '00000000-0000-4000-8000-0000000000f1', fail: null as string | null };
jest.mock('../../services/emailEngine/emailSendPath', () => ({
  prepareEmailSend: async () => {
    if (mockEmail.fail) throw Object.assign(new Error(mockEmail.fail), { code: mockEmail.fail });
    return {
      context: { workflowVersionId: mockEmail.workflowVersionId },
      recipient: { email: mockEmail.email, personId: 'p-1', personalization: {} },
      rendered: { subject: mockEmail.subject, body: mockEmail.body, personalizationInputs: {}, contentSource: 'test' },
    };
  },
  emailContentHook: () => async () => ({ subject: mockEmail.subject, body: mockEmail.body, personalizationInputs: {}, contentSource: 'test' }),
  emailContentEvidenceHook: () => async () => undefined,
  EmailSendPathError: class extends Error {},
}));

/** The WebAuthn ceremony, as its contract describes it. */
const mockPk = {
  challenges: new Map<string, { userId: string | null; expiresAt: number; consumed: boolean }>(),
  verifyCalls: 0,
};
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => ({
  beginAuthentication: async (input: { userId: string | null; challenge?: Uint8Array }) => {
    const bytes = input.challenge ? Buffer.from(input.challenge) : require('crypto').randomBytes(32);
    const challenge = Buffer.from(bytes).toString('base64url');
    mockPk.challenges.set(challenge, { userId: input.userId, expiresAt: Date.now() + 300_000, consumed: false });
    return { options: { challenge, rpId: 'test' } };
  },
  verifyAuthentication: async (input: { userId: string; response: { response: { clientDataJSON: string; signature: string } } }) => {
    mockPk.verifyCalls += 1;
    const challenge = JSON.parse(Buffer.from(input.response.response.clientDataJSON, 'base64url').toString('utf8')).challenge;
    const stored = mockPk.challenges.get(challenge);
    if (!stored) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'NOT_FOUND' };
    if (stored.consumed) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'ALREADY_CONSUMED' };
    if (stored.expiresAt <= Date.now()) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'EXPIRED' };
    if (stored.userId !== null && stored.userId !== input.userId) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'WRONG_USER_BINDING' };
    stored.consumed = true;
    if (input.response.response.signature !== 'valid') return { ok: false, reason: 'VERIFICATION_FAILED' };
    return { ok: true, result: { userId: input.userId } };
  },
}));

/** Self-approval reads the frozen version's publisher; the store is replaced, nothing else. */
const mockVersion = { publishedBy: '00000000-0000-4000-8000-0000000000e1' as string | null, createdBy: null as string | null };
jest.mock('../../services/workflows/workflowStore', () => ({
  getWorkflowVersion: async () => ({ publishedBy: mockVersion.publishedBy, createdBy: mockVersion.createdBy }),
}));
jest.mock('../../services/emailEngine/emailExecutionContext', () => ({
  ...jest.requireActual('../../services/emailEngine/emailExecutionContext'),
  resolveEmailExecutionContext: async () => ({ workflowVersionId: '00000000-0000-4000-8000-0000000000f1' }),
}));
jest.mock('../../services/orchestration/journeyApprovalPreview', () => ({
  buildEmailApprovalPreview: async () => ({ previewHash: 'preview' }),
}));


import {
  EXECUTION_RUNTIME_VERSION, GOVERNANCE_VERSION, INTERNAL_CHANNEL, TRANSLATION_VERSION,
  __clearTransportsForTests, __resetQuotaRedisForTests, approveOutreachTask, dispatchInternalOutreachTask,
  insertOutreachTask, listApprovals, registerDefaultTransports, setOutreachTaskState,
  type EmailProviderPort, type NewOutreachTask,
} from '../../services/leadOutreachExecution';
import { revokeOutreachApproval } from '../../services/leadOutreachExecution/approvalRevocation';
import { BRIDGED_TASK_PLANNER_VERSION } from '../../services/emailEngine/emailExecutionContext';
import { approveTenantJourneyTask, beginTenantJourneyApproval } from '../../services/orchestration/journeyApproval';
import { approveOutreachTaskForOperator, beginOperatorApproval } from '../../services/leadOutreachActivation';
import { APPROVAL_PROOF_MAX_AGE_MS, beginApprovalPasskey, verifyApprovalPasskey } from '../../services/leadOutreachExecution/approvalPasskey';
import { computeApprovalBinding, requestFreshApproval } from '../../services/leadOutreachExecution/approvalBinding';
import { getOutreachTaskById } from '../../services/leadOutreachExecution/storage';
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';

const ORG = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-000000000101';
const PLAN = '00000000-0000-4000-8000-000000000201';
const STEP = '00000000-0000-4000-8000-000000000301';
const APPROVER = '00000000-0000-4000-8000-0000000000e2';
const PUBLISHER = '00000000-0000-4000-8000-0000000000e1';
const BOUND = 'ada@bigcorp.example';
const ATTACKER = 'attacker@evil.example';
const DAY = 24 * 3_600_000;

const sent: Array<{ to: string; subject: string; body: string }> = [];
const provider: EmailProviderPort = {
  name: 'recording_provider',
  async send(r) { sent.push({ to: r.to, subject: r.subject, body: r.body }); return { accepted: true, messageId: `m-${r.idempotencyKey}` }; },
};

let seq = 0;
const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: ORG, leadId: 'L1', planTaskId: `sec-${(seq += 1)}`, taskOrder: 1,
  kind: 'outreach', action: 'Send intro email', channel: INTERNAL_CHANNEL, dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Intro', requiresApproval: true,
  plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: '2026-11-01T00:00:00.000Z', ...over,
});
async function awaiting(over: Partial<NewOutreachTask> = {}): Promise<string> {
  const id = (await insertOutreachTask(newTask(over))).data!.id as string;
  await setOutreachTaskState(ORG, id, { status: 'awaiting_approval' });
  if (over.plannerVersion === BRIDGED_TASK_PLANNER_VERSION) {
    // O-2: a real handoff names its plan and step (both NOT NULL); the journey hold reads the step.
    (db.tables.outreach_bridge_handoffs ??= []).push({
      organization_id: ORG, outreach_task_id: id, execution_instance_id: RUN, execution_plan_id: PLAN, execution_plan_step_id: STEP,
    });
    if (!(db.tables.execution_plan_steps ?? []).some((r) => r.id === STEP)) {
      (db.tables.execution_plan_steps ??= []).push({
        id: STEP, organization_id: ORG, plan_id: PLAN, step_key: 'intro', step_order: 1, channel: 'email', delay_after_previous_hours: 0,
        state: 'ready', ready_at: null, started_at: null, settled_at: null, completed_at: null, not_before: null,
      });
    }
    if (!(db.tables.execution_instances ?? []).some((r) => r.id === RUN)) {
      (db.tables.execution_instances ??= []).push({ organization_id: ORG, id: RUN, lifecycle_state: 'active' });
    }
  }
  return id;
}
const journey = (over: Partial<NewOutreachTask> = {}) => awaiting({ plannerVersion: BRIDGED_TASK_PLANNER_VERSION, channel: 'email', ...over });
const assertion = (challenge: string) => ({
  id: 'cred-1', rawId: 'cred-1', type: 'public-key',
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge })).toString('base64url'), signature: 'valid', authenticatorData: 'x' },
  clientExtensionResults: {},
});

beforeEach(() => {
  db.tables = {}; db.nextId = 1; db.failTable = null; db.statusWrites = []; db.onInsert = null;
  sent.length = 0; fakeRedis.store.clear(); mockPk.challenges.clear(); mockPk.verifyCalls = 0;
  mockEmail.subject = 'Hello Ada'; mockEmail.body = 'A short intro.'; mockEmail.email = BOUND;
  mockEmail.workflowVersionId = '00000000-0000-4000-8000-0000000000f1'; mockEmail.fail = null;
  mockVersion.publishedBy = PUBLISHER; mockVersion.createdBy = null;
  __resetQuotaRedisForTests(); __clearTransportsForTests();
  registerDefaultTransports({ email: 'engine', emailProvider: provider });
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  db.tables.outreach_governance_config = [{
    company_id: ORG, enabled: true, kill_switch: false, enabled_channels: ['email', INTERNAL_CHANNEL],
    restricted_regions: [], daily_limit_tenant: null, daily_limit_lead: null, self_approval_allowed: false,
  }];
});
beforeAll(() => {
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `t1:${'t'.repeat(40)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
afterAll(() => { delete process.env.LEAD_OUTREACH_EMAIL_ENABLED; });

/** A proper tenant approval (begin + bound passkey) by `approver`. */
async function tenantApprove(id: string, approver = APPROVER) {
  const b = await beginTenantJourneyApproval({ organizationId: ORG, taskId: id, approverUserId: approver });
  if (b.ok !== true) throw new Error(`begin refused ${b.code}`);
  return approveTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: approver, expectedContentHash: b.contentHash, passkey: assertion(String((b.passkeyOptions as Row).challenge)) });
}


/** An operator (platform override) approval with a bound passkey. */
async function operatorApprove(id: string, operator: string) {
  const b = await beginOperatorApproval(ORG, id, operator);
  if (b.ok !== true) return { ok: false, reason: b.reason };
  return approveOutreachTaskForOperator(ORG, id, operator, 'override', null, {
    passkey: assertion(String((b.passkeyOptions as Row).challenge)), expectedContentHash: b.contentHash ?? null,
  });
}
const attempts = () => (db.tables.outreach_attempts ?? []).length;
const auditRows = () => (db.tables.capability_audit_log ?? []).filter((r) => String(r.reason ?? '').startsWith('outreach_platform_override'));

// Each SEC-* test is the review's attack; it now asserts the attack is REFUSED.

describe('S-02 no external-channel approval without fresh passkey evidence', () => {
  it('SEC-S02a: approveOutreachTask with NO passkey is refused for an email task, and nothing is sent', async () => {
    const id = await journey();
    expect(await approveOutreachTask(ORG, id, { approverUserId: 'any-string-not-a-user' }))
      .toMatchObject({ ok: false, refusal: 'passkey_required', changed: false });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(r.outcome).not.toBe('sent');
    expect(sent).toHaveLength(0);
  });
  it('SEC-S02b: the platform override without a passkey is refused (no opt-out remains)', async () => {
    const id = await journey();
    expect(await approveOutreachTaskForOperator(ORG, id, 'svc', 'override')).toMatchObject({ ok: false, reason: 'passkey_required' });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
    await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(sent).toHaveLength(0);
  });
  it('SEC-S02c: a forged proof (field-for-field copy) and a replayed proof are both refused', async () => {
    const id = await journey();
    const b = await beginTenantJourneyApproval({ organizationId: ORG, taskId: id, approverUserId: APPROVER });
    if (b.ok !== true) throw new Error('begin');
    const ceremony = { userId: APPROVER, organizationId: ORG, taskId: id, action: 'approve' as const, bindingHash: b.contentHash };
    const verified = await verifyApprovalPasskey(ceremony, assertion(String((b.passkeyOptions as Row).challenge)));
    if (verified.ok !== true) throw new Error('verify');
    const forged = { ...verified.proof };
    expect(await approveOutreachTask(ORG, id, { approverUserId: APPROVER, passkeyProof: forged })).toMatchObject({ ok: false, refusal: 'passkey_required' });
    // A proof is bound to its approver: presenting it as someone else redeems (burns) it and refuses.
    expect(await approveOutreachTask(ORG, id, { approverUserId: 'someone-else', passkeyProof: verified.proof })).toMatchObject({ ok: false, refusal: 'passkey_required' });
    expect(await approveOutreachTask(ORG, id, { approverUserId: APPROVER, passkeyProof: verified.proof })).toMatchObject({ ok: false, refusal: 'passkey_required' });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
  });
  it('SEC-S02d: an approved row with a valid hash but no passkey evidence never authorises an external send', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    for (const r of db.tables.outreach_approvals) { delete r.passkey_credential_id; delete r.passkey_verified_at; }
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(r).toMatchObject({ outcome: 'blocked_governance' });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(attempts()).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('the passkey evidence is persisted with the approval; the internal channel stays passkey-free', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    expect(db.tables.outreach_approvals[0]).toMatchObject({ decision: 'approved', passkey_credential_id: 'cred-1' });
    expect(String(db.tables.outreach_approvals[0].passkey_verified_at)).toMatch(/^\d{4}-/);
    const internal = await awaiting();
    expect((await approveOutreachTask(ORG, internal, { approverUserId: APPROVER })).ok).toBe(true);
    expect(await dispatchInternalOutreachTask(ORG, internal)).toMatchObject({ outcome: 'sent' });
  });
});

describe('S-04 the transport sends only to the recipient bound into the approval', () => {
  it('SEC-S04a: a journey email approved for BOUND is refused for a caller-supplied ATTACKER, with no attempt and no quota', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: ATTACKER });
    expect(r).toMatchObject({ outcome: 'blocked_governance', status: 'approved' });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_recipient_mismatch');
    expect(attempts()).toBe(0);
    expect(fakeRedis.store.size).toBe(0);
    expect(sent).toHaveLength(0);
    // A missing recipient is refused the same way; the bound address (any case) still sends.
    expect((await dispatchInternalOutreachTask(ORG, id, {})).governance?.blockingCondition).toBe('eligibility.approval_recipient_mismatch');
    expect(await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND })).toMatchObject({ outcome: 'sent' });
    expect(sent.map((s) => s.to)).toEqual([BOUND]);
  });
  it('SEC-S04b: a non-journey email approval that binds no recipient sends nowhere; one bound to BOUND sends only to BOUND', async () => {
    __clearTransportsForTests();
    registerDefaultTransports({ emailProvider: provider });
    const unbound = await awaiting({ channel: 'email' });
    // Outreach L-2 — an approval naming no recipient is refused when it is made, not only at dispatch.
    expect(await approveWithPasskey(ORG, unbound, APPROVER)).toMatchObject({ ok: false, refusal: 'recipient_required' });
    expect(await listApprovals(ORG, unbound)).toHaveLength(0);
    expect((await dispatchInternalOutreachTask(ORG, unbound, { recipient: ATTACKER })).outcome).toBe('blocked_governance');
    const bound = await awaiting({ channel: 'email' });
    expect((await approveWithPasskey(ORG, bound, APPROVER, { recipient: BOUND })).ok).toBe(true);
    const wrong = await dispatchInternalOutreachTask(ORG, bound, { recipient: ATTACKER });
    // L-3 — the stored bound address makes it a mismatch: refused, and the approval stays valid.
    expect(wrong).toMatchObject({ outcome: 'blocked_governance', status: 'approved' });
    expect(wrong.governance?.blockingCondition).toBe('eligibility.approval_recipient_mismatch');
    expect(sent).toHaveLength(0);
    expect(await dispatchInternalOutreachTask(ORG, bound, { recipient: BOUND })).toMatchObject({ outcome: 'sent' });
    expect(sent.map((s) => s.to)).toEqual([BOUND]);
  });
});

describe('S-03 approval-check-to-render race', () => {
  it('SEC-S03: content edited after the gate but before render is not sent', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    db.onInsert = async (table) => { if (table === 'outreach_attempts') mockEmail.body = 'EDITED AFTER THE GATE'; };
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(r.outcome).toBe('rejected');
    expect(r.reason).toMatch(/differs from what was approved/);
    expect(sent).toHaveLength(0);
    // The next run refuses at the gate and returns the task for a fresh approval.
    db.onInsert = null;
    const again = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(again).toMatchObject({ outcome: 'blocked_governance', status: 'awaiting_approval' });
    expect(sent).toHaveLength(0);
  });
  it('the unedited render passes the post-render check and sends once', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    expect(await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND })).toMatchObject({ outcome: 'sent' });
    expect(sent.map((s) => s.body)).toEqual(['A short intro.']);
  });
});

describe('S-01 self-approval', () => {
  it('SEC-S01a: the workflow publisher cannot approve their own journey through the platform override', async () => {
    const id = await journey();
    expect(await beginOperatorApproval(ORG, id, PUBLISHER)).toMatchObject({ ok: false, reason: 'self_approval_not_permitted' });
    expect(await approveOutreachTaskForOperator(ORG, id, PUBLISHER, 'override', null, { passkey: null }))
      .toMatchObject({ ok: false, reason: 'self_approval_not_permitted' });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
    expect(auditRows()).toEqual([expect.objectContaining({ decision: 'denied', actor_user_id: PUBLISHER, resource_id: id, organization_id: ORG })]);
  });
  it('SEC-S01b: the author (created_by) of the workflow version cannot approve it on either surface', async () => {
    mockVersion.createdBy = APPROVER;
    const id = await journey();
    expect(await beginTenantJourneyApproval({ organizationId: ORG, taskId: id, approverUserId: APPROVER }))
      .toMatchObject({ ok: false, code: 'self_approval_not_permitted' });
    expect(await operatorApprove(id, APPROVER)).toMatchObject({ ok: false, reason: 'self_approval_not_permitted' });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
  });
  it('a permitted platform override is recorded `platform`, carries passkey evidence and emits the security audit event', async () => {
    const id = await journey();
    expect(await operatorApprove(id, 'operator-1')).toMatchObject({ ok: true, status: 'approved' });
    expect(db.tables.outreach_approvals[0]).toMatchObject({ tier: 'platform', passkey_credential_id: 'cred-1' });
    expect(auditRows()).toEqual([expect.objectContaining({ decision: 'allowed', capability: 'outreach.platform.manage', actor_user_id: 'operator-1' })]);
  });
});

describe('T1 / T2 — server time', () => {
  it('SEC-T1: an approval recorded with a future decidedAt never authorises a send', async () => {
    const id = await journey();
    const future = new Date(Date.now() + 365 * DAY).toISOString();
    expect((await approveWithPasskey(ORG, id, APPROVER, { decidedAt: future })).ok).toBe(true);
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND, now: new Date(Date.now() + 30 * DAY).toISOString() });
    expect(r.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });
  it('SEC-T1b: outside tests a caller-supplied decidedAt is not written (the database stamps it)', async () => {
    const id = await journey();
    const env = process.env.NODE_ENV;
    const seen: Row[] = [];
    db.onInsert = async (table, row) => { if (table === 'outreach_approvals') seen.push(row); };
    try {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      await approveWithPasskey(ORG, id, APPROVER, { decidedAt: new Date(Date.now() + 365 * DAY).toISOString() });
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = env;
    }
    expect(seen).toHaveLength(1);
    expect('decided_at' in seen[0]).toBe(false);
  });
  it('SEC-T2: expiry does not trust a caller-supplied instant (8-day-old approval, now injected 2 days earlier)', async () => {
    const id = await journey();
    expect((await approveWithPasskey(ORG, id, APPROVER, { decidedAt: new Date(Date.now() - 8 * DAY).toISOString() })).ok).toBe(true);
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND, now: new Date(Date.now() - 2 * DAY).toISOString() });
    expect(r).toMatchObject({ outcome: 'blocked_governance', status: 'expired' });
    expect(sent).toHaveLength(0);
  });
});

describe('W1 — ceremony separation in the REAL verifier', () => {
  const real = () => jest.requireActual('../../security/webauthn/WebAuthnAuthenticationService') as typeof import('../../security/webauthn/WebAuthnAuthenticationService');
  const response = (bytes: number) => ({
    id: 'cred-1', rawId: 'cred-1', type: 'public-key' as const, clientExtensionResults: {},
    response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: Buffer.alloc(bytes, 7).toString('base64url') })).toString('base64url'), signature: 'x', authenticatorData: 'x' },
  });
  beforeAll(() => {
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_RP_ORIGIN = 'http://localhost:3000';
    process.env.SESSION_COOKIE_SECRET = 'd02-unit-placeholder-secret-0123456789abcdef';
  });
  it('a generic (login / step-up) verification refuses an approval-shaped challenge before touching the store', async () => {
    expect(await real().verifyAuthentication({ userId: APPROVER, response: response(48) as never }))
      .toMatchObject({ ok: false, reason: 'CHALLENGE_REJECTED', detail: 'PURPOSE_MISMATCH' });
  });
  it('an approval verification refuses a generic challenge', async () => {
    expect(await real().verifyAuthentication({ userId: APPROVER, response: response(32) as never, purpose: 'outreach_approval' }))
      .toMatchObject({ ok: false, reason: 'CHALLENGE_REJECTED', detail: 'PURPOSE_MISMATCH' });
  });
});

describe('Controls that held in the review (still hold)', () => {
  it('SEC-OK1: revocation landing between the gate and the claim sends nothing', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    let fired = false;
    db.onInsert = async (table) => {
      if (table === 'outreach_decisions' && !fired) { fired = true; await revokeOutreachApproval(ORG, id, { approverUserId: APPROVER }); }
    };
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(fired).toBe(true);
    expect(r.outcome).not.toBe('sent');
    expect(sent).toHaveLength(0);
  });
  it('SEC-OK2: content edited after approval (before dispatch) is refused', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    mockEmail.subject = 'changed';
    expect((await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND })).outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });
  it('SEC-OK3: a tenant approval passkey cannot be replayed onto a second task', async () => {
    const a = await journey(); const c = await journey();
    const b = await beginTenantJourneyApproval({ organizationId: ORG, taskId: a, approverUserId: APPROVER });
    if (b.ok !== true) throw new Error('begin');
    const pk = assertion(String((b.passkeyOptions as Row).challenge));
    const bc = await beginTenantJourneyApproval({ organizationId: ORG, taskId: c, approverUserId: APPROVER });
    if (bc.ok !== true) throw new Error('begin c');
    expect(await approveTenantJourneyTask({ organizationId: ORG, taskId: c, approverUserId: APPROVER, expectedContentHash: bc.contentHash, passkey: pk }))
      .toMatchObject({ ok: false, code: 'passkey_wrong_binding' });
    expect(await listApprovals(ORG, c)).toHaveLength(0);
  });
});

// ── r3 (D02-SECURITY-REVIEW-r3) Low findings, each asserted fixed ─────────────

/** A proof for `id` as the approval writer would receive it. */
async function proofFor(id: string, recipient: string | null = null, approver = APPROVER) {
  const task = (await getOutreachTaskById(ORG, id))!;
  const binding = await computeApprovalBinding(ORG, task, { recipient });
  if (!binding.ok) throw new Error(`binding ${binding.code}`);
  const b = { userId: approver, organizationId: ORG, taskId: id, action: 'approve' as const, bindingHash: binding.hash };
  const opts = await beginApprovalPasskey(b);
  const v = await verifyApprovalPasskey(b, assertion(String((opts as unknown as Row).challenge)));
  if (v.ok !== true) throw new Error(`verify ${v.code}`);
  return v.proof;
}

describe('r3 L-1 — a passkey proof is fresh for the approval it backs', () => {
  it('R3-b5: a proof held past five minutes is refused at redeem; nothing is recorded', async () => {
    const id = await journey();
    const proof = await proofFor(id);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + APPROVAL_PROOF_MAX_AGE_MS + 1_000);
    try {
      expect(await approveOutreachTask(ORG, id, { approverUserId: APPROVER, passkeyProof: proof }))
        .toMatchObject({ ok: false, refusal: 'passkey_required', reason: expect.stringMatching(/too old/) });
    } finally { clock.mockRestore(); }
    expect(await listApprovals(ORG, id)).toHaveLength(0);
  });
  it('a proof inside the window is accepted', async () => {
    const id = await journey();
    const proof = await proofFor(id);
    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER, passkeyProof: proof })).ok).toBe(true);
  });
  it('the gate refuses a recorded approval whose verification was not taken at the decision', async () => {
    const id = await journey();
    expect((await tenantApprove(id)).ok).toBe(true);
    db.tables.outreach_approvals[0].passkey_verified_at = new Date(Date.now() - 3 * DAY).toISOString();
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(r.reason).toMatch(/not made at the time of the approval/);
    expect(sent).toHaveLength(0);
  });
});

describe('r3 L-3 / L-4 — a non-journey approval stores the address it binds', () => {
  const nonJourney = async () => {
    __clearTransportsForTests();
    registerDefaultTransports({ emailProvider: provider });
    const id = await awaiting({ channel: 'email' });
    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER, passkeyProof: await proofFor(id, BOUND), recipient: BOUND })).ok).toBe(true);
    return id;
  };
  it('R3-f1: a caller-supplied wrong recipient is refused as a mismatch; the valid approval stays approved', async () => {
    const id = await nonJourney();
    expect(db.tables.outreach_approvals[0].approved_recipient).toBe(BOUND);
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: ATTACKER });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_recipient_mismatch');
    expect(sent).toHaveLength(0);
    expect((await getOutreachTaskById(ORG, id))!.status).toBe('approved');
  });
  it('R3-f2: the bound recipient sends once', async () => {
    const id = await nonJourney();
    expect((await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND })).outcome).toBe('sent');
    expect(sent.map((x) => x.to)).toEqual([BOUND]);
  });
  it('L-4: requestFreshApproval does not mistake a valid non-journey approval for stale', async () => {
    const id = await nonJourney();
    expect(await requestFreshApproval(ORG, id)).toMatchObject({ ok: false, status: 'approved' });
    expect((await getOutreachTaskById(ORG, id))!.status).toBe('approved');
  });
  it('a stored address that disagrees with the hash (tampered row) is stale, never valid', async () => {
    const id = await nonJourney();
    db.tables.outreach_approvals[0].approved_recipient = ATTACKER;
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: ATTACKER });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(sent).toHaveLength(0);
  });
});

// ── Outreach review of 9bbbacd2: L-1 / L-2 ───────────────────────────────────

describe('Outreach L-1 / L-2 — the non-journey binding covers the body and requires a recipient', () => {
  const nonJourney = async () => {
    __clearTransportsForTests();
    registerDefaultTransports({ emailProvider: provider });
    return awaiting({ channel: 'email' });
  };
  it('L-1: editing the explanation (the placeholder transport body) after approval is stale, nothing sent', async () => {
    const id = await nonJourney();
    expect((await approveWithPasskey(ORG, id, APPROVER, { recipient: BOUND })).ok).toBe(true);
    (db.tables.outreach_tasks ?? []).find((r) => r.id === id)!.explanation = 'A different body nobody approved';
    const r = await dispatchInternalOutreachTask(ORG, id, { recipient: BOUND });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(sent).toHaveLength(0);
  });
  it('L-2: the platform override refuses a non-journey external task (it cannot name a recipient), before any challenge', async () => {
    const id = await nonJourney();
    expect(await beginOperatorApproval(ORG, id, 'operator-1')).toMatchObject({ ok: false, reason: 'recipient_required' });
    expect(mockPk.challenges.size).toBe(0);
    expect(await approveOutreachTaskForOperator(ORG, id, 'operator-1', 'override', null, { passkey: null }))
      .toMatchObject({ ok: false, reason: 'recipient_required' });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
  });
});
