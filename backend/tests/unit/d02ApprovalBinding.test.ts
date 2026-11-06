/**
 * D-02 — an outreach approval binds to the exact content and action, lives seven days,
 * can be revoked, and (on the tenant surface) needs a fresh passkey bound to it.
 *
 * Mocked in the WS-3 dispatch suites' own style (an in-memory table fake behind
 * `ownedDbTable`). The database-backed proof is realschema/d02_approval_binding.test.ts.
 * The WebAuthn service is replaced by a faithful in-memory double of its contract: one
 * stored challenge per ceremony, user-bound, five-minute TTL, consumed on first use.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  /** Reads of this table fail (an unreadable store). */
  failTable: null as string | null,
  /** Every status write to outreach_tasks: target status and rows it changed. */
  statusWrites: [] as Array<{ to: unknown; changed: number }>,
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
const mockEmail = { subject: 'Hello Ada', body: 'A short intro.', email: 'cto@bigcorp.example', workflowVersionId: '00000000-0000-4000-8000-0000000000f1', fail: null as string | null };
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
const mockVersion = { publishedBy: '00000000-0000-4000-8000-0000000000e1' as string | null };
jest.mock('../../services/workflows/workflowStore', () => ({
  getWorkflowVersion: async () => (mockVersion.publishedBy === undefined ? null : { publishedBy: mockVersion.publishedBy }),
}));
jest.mock('../../services/emailEngine/emailExecutionContext', () => ({
  ...jest.requireActual('../../services/emailEngine/emailExecutionContext'),
  resolveEmailExecutionContext: async () => ({ workflowVersionId: '00000000-0000-4000-8000-0000000000f1' }),
}));
jest.mock('../../services/orchestration/journeyApprovalPreview', () => ({
  buildEmailApprovalPreview: async () => ({ previewHash: 'preview' }),
}));

import * as fs from 'fs';
import * as path from 'path';
import {
  EXECUTION_RUNTIME_VERSION, GOVERNANCE_VERSION, INTERNAL_CHANNEL, TRANSLATION_VERSION,
  __clearTransportsForTests, __resetQuotaRedisForTests, approveOutreachTask, dispatchInternalOutreachTask,
  getOutreachTaskById, insertOutreachTask, listApprovals, listAttempts, registerDefaultTransports, setOutreachTaskState,
  type EmailProviderPort, type NewOutreachTask,
} from '../../services/leadOutreachExecution';
import { getApprovalState, submitForApproval } from '../../services/leadOutreachExecution/approval';
import { revokeOutreachApproval } from '../../services/leadOutreachExecution/approvalRevocation';
import {
  APPROVAL_LIFETIME_MS, RESUBMISSION_AUDIT_ACTION, computeApprovalBinding, requestFreshApproval, resolveApprovalAuthority,
} from '../../services/leadOutreachExecution/approvalBinding';
import * as auditActorService from '../../services/auditActorService';
import { rejectOutreachTask } from '../../services/leadOutreachExecution';
import { approvalChallengeBytes, verifyApprovalPasskey } from '../../services/leadOutreachExecution/approvalPasskey';
import { evaluateEligibility, type GovernanceEvaluationInput } from '../../services/leadOutreachExecution/governance';
import { BRIDGED_TASK_PLANNER_VERSION } from '../../services/emailEngine/emailExecutionContext';
import {
  approveTenantJourneyTask, beginTenantJourneyApproval, resubmitTenantJourneyTask, revokeTenantJourneyApproval,
} from '../../services/orchestration/journeyApproval';
import { approveOutreachTaskForOperator, beginOperatorApproval } from '../../services/leadOutreachActivation';
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';

const ORG = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-000000000101';
const APPROVER = '00000000-0000-4000-8000-0000000000e2';
const PUBLISHER = '00000000-0000-4000-8000-0000000000e1';
const RECIPIENT = 'cto@bigcorp.example';
const DAY = 24 * 3_600_000;

const sent: string[] = [];
const provider: EmailProviderPort = {
  name: 'recording_provider',
  async send(r) { sent.push(r.to); return { accepted: true, messageId: `m-${r.idempotencyKey}` }; },
};

let seq = 0;
const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: ORG, leadId: 'L1', planTaskId: `plan-${(seq += 1)}`, taskOrder: 1,
  kind: 'outreach', action: 'Send intro email', channel: INTERNAL_CHANNEL, dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Intro', requiresApproval: true,
  plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: '2026-11-01T00:00:00.000Z', ...over,
});

const configureTenant = (selfApprovalAllowed = false) => {
  db.tables.outreach_governance_config = [{
    company_id: ORG, enabled: true, kill_switch: false,
    enabled_channels: ['email', INTERNAL_CHANNEL], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null, self_approval_allowed: selfApprovalAllowed,
  }];
};

/** A task awaiting approval; a journey task also gets a handoff to an active run. */
async function awaiting(over: Partial<NewOutreachTask> = {}): Promise<string> {
  const id = (await insertOutreachTask(newTask(over))).data!.id as string;
  await setOutreachTaskState(ORG, id, { status: 'awaiting_approval' });
  if (over.plannerVersion === BRIDGED_TASK_PLANNER_VERSION) {
    (db.tables.outreach_bridge_handoffs ??= []).push({ organization_id: ORG, outreach_task_id: id, execution_instance_id: RUN });
    if (!(db.tables.execution_instances ?? []).some((r) => r.id === RUN)) {
      (db.tables.execution_instances ??= []).push({ organization_id: ORG, id: RUN, lifecycle_state: 'active' });
    }
  }
  return id;
}
const journey = (over: Partial<NewOutreachTask> = {}) => awaiting({ plannerVersion: BRIDGED_TASK_PLANNER_VERSION, channel: 'email', ...over });
const taskRow = (id: string) => db.tables.outreach_tasks.find((r) => r.id === id)!;
const status = async (id: string) => (await getOutreachTaskById(ORG, id))!.status;
const workItems = (id: string) => (db.tables.outreach_internal_work_items ?? []).filter((r) => r.task_id === id).length;
const dispatch = (id: string, now?: string) => dispatchInternalOutreachTask(ORG, id, { recipient: RECIPIENT, ...(now ? { now } : {}) });

/** A browser's assertion over `challenge` (base64url), signed or not. */
const assertion = (challenge: string, signature = 'valid') => ({
  id: 'cred-1', rawId: 'cred-1', type: 'public-key',
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge })).toString('base64url'), signature, authenticatorData: 'x' },
  clientExtensionResults: {},
});

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.statusWrites = [];
  sent.length = 0;
  fakeRedis.store.clear();
  mockPk.challenges.clear();
  mockPk.verifyCalls = 0;
  // D-02 (S-04) — the journey's canonical address IS the dispatch recipient: an approval
  // authorises only the address it binds (this suite once asserted delivery to another one).
  mockEmail.subject = 'Hello Ada'; mockEmail.body = 'A short intro.'; mockEmail.email = RECIPIENT;
  mockEmail.workflowVersionId = '00000000-0000-4000-8000-0000000000f1'; mockEmail.fail = null;
  mockVersion.publishedBy = PUBLISHER;
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  registerDefaultTransports({ emailProvider: provider });
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  configureTenant();
});
const prior = { keys: process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS, appUrl: process.env.NEXT_PUBLIC_APP_URL };
beforeAll(() => {
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `t1:${'t'.repeat(40)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
afterAll(() => {
  delete process.env.LEAD_OUTREACH_EMAIL_ENABLED;
  for (const [k, v] of [['OUTREACH_UNSUBSCRIBE_TOKEN_KEYS', prior.keys], ['NEXT_PUBLIC_APP_URL', prior.appUrl]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ── the dispatch boundary ────────────────────────────────────────────────────

describe('D-02 — a matching approval sends exactly once', () => {
  it('a non-journey task approved through the one approval path dispatches once', async () => {
    const id = await awaiting();
    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER })).ok).toBe(true);
    const [row] = await listApprovals(ORG, id);
    expect(row.approved_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent', attemptNumber: 1 });
    expect(await dispatch(id)).toMatchObject({ outcome: 'blocked_governance' });
    expect(workItems(id)).toBe(1);
  });

  it('a journey email approved for the shown content sends once, and only to the address it binds', async () => {
    const id = await journey();
    expect((await approveWithPasskey(ORG, id, APPROVER)).ok).toBe(true);
    const elsewhere = await dispatchInternalOutreachTask(ORG, id, { recipient: 'someone@else.example' });
    expect(elsewhere.governance?.blockingCondition).toBe('eligibility.approval_recipient_mismatch');
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent' });
    expect(sent).toEqual([RECIPIENT]);
  });
});

describe('D-02 — content edited after approval refuses with approval_stale and sends nothing', () => {
  const editsJourney: Array<[string, () => void]> = [
    ['subject', () => { mockEmail.subject = 'Hello Ada!'; }],
    ['body', () => { mockEmail.body = 'A longer intro.'; }],
    ['address', () => { mockEmail.email = 'ada@other.example'; }],
    ['workflow version', () => { mockEmail.workflowVersionId = '00000000-0000-4000-8000-0000000000f2'; }],
  ];
  it.each(editsJourney)('journey email: %s edited', async (_n, edit) => {
    const id = await journey();
    expect((await approveWithPasskey(ORG, id, APPROVER)).ok).toBe(true);
    edit();
    const r = await dispatch(id);
    expect(r.outcome).toBe('blocked_governance');
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    expect(sent).toHaveLength(0);
    // F1 — a stale approval sends the task back to review, not to a dead end.
    expect(await status(id)).toBe('awaiting_approval');
  });

  const editsTask: Array<[string, Row]> = [
    ['action', { action: 'Send a different email' }],
    ['channel', { channel: 'email' }],
    ['kind', { kind: 'follow_up' }],
    ['person', { person_id: '00000000-0000-4000-8000-0000000000c9' }],
  ];
  it.each(editsTask)('any task: %s edited', async (_n, patch) => {
    const id = await awaiting();
    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER })).ok).toBe(true);
    Object.assign(taskRow(id), patch);
    const r = await dispatch(id);
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    expect(workItems(id)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('a journey email action edit is refused even when the render would not change', async () => {
    const id = await journey();
    expect((await approveWithPasskey(ORG, id, APPROVER)).ok).toBe(true);
    taskRow(id).action = 'Send intro email (v2)';
    expect((await dispatch(id)).governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(sent).toHaveLength(0);
  });

  it('content that can no longer be prepared is stale, not sent', async () => {
    const id = await journey();
    expect((await approveWithPasskey(ORG, id, APPROVER)).ok).toBe(true);
    mockEmail.fail = 'email_missing';
    expect((await dispatch(id)).governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(sent).toHaveLength(0);
  });

  it('an approval refused when the expected hash no longer matches writes nothing', async () => {
    const id = await awaiting();
    const r = await approveOutreachTask(ORG, id, { approverUserId: APPROVER, expectedContentHash: 'f'.repeat(64) });
    expect(r).toMatchObject({ ok: false, refusal: 'approval_stale' });
    expect(await status(id)).toBe('awaiting_approval');
    expect(await listApprovals(ORG, id)).toHaveLength(0);
  });
});

describe('D-02 — seven-day lifetime at the execution boundary', () => {
  // Relative to the real clock: expiry is judged at the later of the caller's instant and the server's (T2).
  const approvedAt = new Date(Date.now() - DAY).toISOString();
  const later = (ms: number) => new Date(Date.parse(approvedAt) + ms).toISOString();

  it('8 days old: refused, the task moves to the existing expired status, nothing is sent', async () => {
    const id = await awaiting();
    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER, decidedAt: approvedAt })).ok).toBe(true);
    const r = await dispatch(id, later(8 * DAY));
    expect(r).toMatchObject({ outcome: 'blocked_governance', status: 'expired' });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_expired');
    expect(await status(id)).toBe('expired');
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    expect(workItems(id)).toBe(0);
  });

  it('exactly seven days is already expired', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER, decidedAt: approvedAt });
    expect((await dispatch(id, later(APPROVAL_LIFETIME_MS))).governance?.blockingCondition).toBe('eligibility.approval_expired');
  });

  it('6 days old: sends', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER, decidedAt: approvedAt });
    expect(await dispatch(id, later(6 * DAY))).toMatchObject({ outcome: 'sent' });
  });

  it('a requeued task is expired on the same rule', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER, decidedAt: approvedAt });
    await setOutreachTaskState(ORG, id, { status: 'queued' });
    const r = await dispatch(id, later(8 * DAY));
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_expired');
    expect(await status(id)).toBe('expired');
  });
});

describe('D-02 — revocation', () => {
  it('revoked: the task is cancelled, the approval refuses, history is kept', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    const r = await revokeOutreachApproval(ORG, id, { approverUserId: APPROVER, reason: 'changed my mind' });
    expect(r).toMatchObject({ ok: true, status: 'cancelled' });
    // The stored task, not only the reported status, is cancelled (compare-and-set).
    expect(await status(id)).toBe('cancelled');
    expect((await listApprovals(ORG, id)).map((a) => a.decision)).toEqual(['approved', 'revoked']);
    expect((await getApprovalState(ORG, id)).latestDecision).toBe('revoked');
    expect(await dispatch(id)).toMatchObject({ outcome: 'blocked_governance' });
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    const task = (await getOutreachTaskById(ORG, id))!;
    expect((await resolveApprovalAuthority(ORG, { ...task, status: 'approved' }, new Date().toISOString())).verdict).toBe('revoked');
  });

  it('a requeued task can be revoked; a task with no approval cannot', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    await setOutreachTaskState(ORG, id, { status: 'queued' });
    expect(await revokeOutreachApproval(ORG, id, { approverUserId: APPROVER })).toMatchObject({ ok: true, status: 'cancelled' });
    const fresh = await awaiting();
    expect(await revokeOutreachApproval(ORG, fresh, { approverUserId: APPROVER })).toMatchObject({ ok: false, refusal: 'invalid_state' });
  });
});

describe('D-02 — a legacy approval (no hash) never authorises', () => {
  it('refused with approval_stale; the row is kept, nothing is backfilled', async () => {
    const id = await awaiting();
    await setOutreachTaskState(ORG, id, { status: 'approved' });
    (db.tables.outreach_approvals ??= []).push({
      id: 'legacy-1', company_id: ORG, task_id: id, decision: 'approved', approver_user_id: APPROVER,
      decided_at: new Date().toISOString(), missing_information: [],
    });
    const r = await dispatch(id);
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(r.reason).toMatch(/no content hash/);
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    expect(db.tables.outreach_approvals).toHaveLength(1);
    expect(db.tables.outreach_approvals[0].approved_content_hash).toBeUndefined();
  });

  it('a task set to approved with no approval on record is refused', async () => {
    const id = await awaiting();
    await setOutreachTaskState(ORG, id, { status: 'approved' });
    expect((await dispatch(id)).governance?.blockingCondition).toBe('eligibility.approval_stale');
  });
});

describe('D-02 — the pure eligibility gate fails closed', () => {
  const input = (over: Partial<GovernanceEvaluationInput>): GovernanceEvaluationInput => ({
    task: { status: 'approved', requiresApproval: true } as GovernanceEvaluationInput['task'],
    config: {} as GovernanceEvaluationInput['config'], suppressions: {} as GovernanceEvaluationInput['suppressions'],
    canonicalGovernance: null, usage: {} as GovernanceEvaluationInput['usage'], globalKillSwitch: false, region: null,
    evaluatedAt: '2026-11-04T00:00:00.000Z', ...over,
  });
  it.each([
    [undefined, 'eligibility.approval_stale'],
    [{ verdict: 'stale', reason: 'x', decidedAt: null, expiresAt: null }, 'eligibility.approval_stale'],
    [{ verdict: 'expired', reason: 'x', decidedAt: null, expiresAt: null }, 'eligibility.approval_expired'],
    [{ verdict: 'revoked', reason: 'x', decidedAt: null, expiresAt: null }, 'eligibility.approval_revoked'],
  ] as const)('authority %j refuses with %s', (authority, rule) => {
    const g = evaluateEligibility(input({ approvalAuthority: authority as GovernanceEvaluationInput['approvalAuthority'] }));
    expect(g).toMatchObject({ decision: 'blocked', rule });
  });
  it('a valid authority allows', () => {
    expect(evaluateEligibility(input({ approvalAuthority: { verdict: 'valid', reason: 'ok', decidedAt: null, expiresAt: null } })).decision).toBe('allowed');
  });
});

describe('D-02 — the binding', () => {
  it('is deterministic and differs for another task', async () => {
    const a = await awaiting();
    const b = await awaiting();
    const ta = (await getOutreachTaskById(ORG, a))!;
    const h1 = await computeApprovalBinding(ORG, ta);
    const h2 = await computeApprovalBinding(ORG, ta);
    const hb = await computeApprovalBinding(ORG, (await getOutreachTaskById(ORG, b))!);
    expect(h1).toEqual(h2);
    expect(h1.ok && hb.ok && h1.hash !== hb.hash).toBe(true);
  });
});

// ── the passkey bound to one approval ────────────────────────────────────────

describe('D-02 — fresh, single-use passkey bound to the approval', () => {
  const binding = (over: Partial<{ taskId: string; bindingHash: string; userId: string }> = {}) => ({
    userId: APPROVER, organizationId: ORG, taskId: 't-1', action: 'approve' as const, bindingHash: 'a'.repeat(64), ...over,
  });
  const issued = async (b = binding()) => {
    const { beginApprovalPasskey } = jest.requireActual('../../services/leadOutreachExecution/approvalPasskey');
    return String((await beginApprovalPasskey(b)).challenge);
  };

  it('missing → passkey_required, and the ceremony is never reached', async () => {
    expect(await verifyApprovalPasskey(binding(), undefined)).toMatchObject({ ok: false, code: 'passkey_required' });
    expect(await verifyApprovalPasskey(binding(), { response: {} })).toMatchObject({ ok: false, code: 'passkey_required' });
    expect(mockPk.verifyCalls).toBe(0);
  });

  it('bound to another task, another hash or another user → passkey_wrong_binding, challenge left unburnt', async () => {
    const c = await issued();
    for (const other of [binding({ taskId: 't-2' }), binding({ bindingHash: 'b'.repeat(64) }), binding({ userId: PUBLISHER })]) {
      expect(await verifyApprovalPasskey(other, assertion(c))).toMatchObject({ ok: false, code: 'passkey_wrong_binding' });
    }
    expect(mockPk.verifyCalls).toBe(0);
    expect(await verifyApprovalPasskey(binding(), assertion(c))).toMatchObject({ ok: true, proof: { taskId: 't-1', credentialId: 'cred-1' } });
  });

  it('a generic (login / step-up) challenge never satisfies an approval', async () => {
    const generic = Buffer.alloc(32, 7).toString('base64url');
    mockPk.challenges.set(generic, { userId: APPROVER, expiresAt: Date.now() + 300_000, consumed: false });
    expect(await verifyApprovalPasskey(binding(), assertion(generic))).toMatchObject({ ok: false, code: 'passkey_wrong_binding' });
  });

  it('replayed → passkey_replayed', async () => {
    const c = await issued();
    expect(await verifyApprovalPasskey(binding(), assertion(c))).toMatchObject({ ok: true, proof: { taskId: 't-1', credentialId: 'cred-1' } });
    expect(await verifyApprovalPasskey(binding(), assertion(c))).toMatchObject({ ok: false, code: 'passkey_replayed' });
  });

  it('stale → passkey_stale', async () => {
    const c = await issued();
    mockPk.challenges.get(c)!.expiresAt = Date.now() - 1;
    expect(await verifyApprovalPasskey(binding(), assertion(c))).toMatchObject({ ok: false, code: 'passkey_stale' });
  });

  it('a bad signature → passkey_rejected', async () => {
    const c = await issued();
    expect(await verifyApprovalPasskey(binding(), assertion(c, 'forged'))).toMatchObject({ ok: false, code: 'passkey_rejected' });
  });

  it('the challenge is nonce || digest over exactly the binding', () => {
    const nonce = Buffer.alloc(16, 1);
    const bytes = approvalChallengeBytes(nonce, binding());
    expect(bytes).toHaveLength(48);
    expect(bytes.subarray(0, 16)).toEqual(nonce);
    expect(approvalChallengeBytes(nonce, binding({ bindingHash: 'c'.repeat(64) }))).not.toEqual(bytes);
  });
});

// ── the tenant surface's service ─────────────────────────────────────────────

describe('D-02 — tenant journey approval', () => {
  const actor = (taskId: string, approverUserId = APPROVER) => ({ organizationId: ORG, taskId, approverUserId });
  async function begin(taskId: string, approverUserId = APPROVER) {
    const b = await beginTenantJourneyApproval(actor(taskId, approverUserId));
    if (b.ok !== true) throw new Error(`begin refused: ${b.code}`);
    return b;
  }

  it('begin → approve with the bound passkey records a tenant-tier approval that dispatches once', async () => {
    const id = await journey();
    const b = await begin(id);
    expect(b.passkeyRequired).toBe(true);
    const r = await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: assertion(String((b.passkeyOptions as Row).challenge)) });
    expect(r).toMatchObject({ ok: true, status: 'approved' });
    const [row] = await listApprovals(ORG, id);
    expect(row).toMatchObject({ decision: 'approved', tier: 'tenant', approved_content_hash: b.contentHash, approver_user_id: APPROVER });
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent' });
    expect(sent).toHaveLength(1);
  });

  it('passkey missing, replayed or bound to another approval → refused, nothing recorded', async () => {
    const id = await journey();
    const other = await journey();
    const b = await begin(id);
    const bo = await begin(other);
    const challenge = String((b.passkeyOptions as Row).challenge);
    expect(await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: null }))
      .toMatchObject({ ok: false, code: 'passkey_required' });
    expect(await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: assertion(String((bo.passkeyOptions as Row).challenge)) }))
      .toMatchObject({ ok: false, code: 'passkey_wrong_binding' });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
    expect(await status(id)).toBe('awaiting_approval');
    expect(await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: assertion(challenge) })).toMatchObject({ ok: true });
    // The same verification cannot approve a second time (here: the re-submitted approval).
    await setOutreachTaskState(ORG, id, { status: 'awaiting_approval' });
    expect(await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: assertion(challenge) }))
      .toMatchObject({ ok: false, code: 'passkey_replayed' });
  });

  it('a stale passkey is refused', async () => {
    const id = await journey();
    const b = await begin(id);
    const challenge = String((b.passkeyOptions as Row).challenge);
    mockPk.challenges.get(challenge)!.expiresAt = Date.now() - 1;
    expect(await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: assertion(challenge) }))
      .toMatchObject({ ok: false, code: 'passkey_stale' });
  });

  it('content edited between begin and approve → approval_stale, and the passkey is not consumed', async () => {
    const id = await journey();
    const b = await begin(id);
    mockEmail.body = 'Edited after it was shown.';
    expect(await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: assertion(String((b.passkeyOptions as Row).challenge)) }))
      .toMatchObject({ ok: false, code: 'approval_stale' });
    expect(mockPk.verifyCalls).toBe(0);
    expect(await listApprovals(ORG, id)).toHaveLength(0);
  });

  it('self-approval is refused by default and allowed when the tenant turns it on', async () => {
    const id = await journey();
    expect(await beginTenantJourneyApproval(actor(id, PUBLISHER))).toMatchObject({ ok: false, code: 'self_approval_not_permitted' });
    expect(await approveTenantJourneyTask({ ...actor(id, PUBLISHER), expectedContentHash: 'a'.repeat(64), passkey: null }))
      .toMatchObject({ ok: false, code: 'approval_stale' });
    const hash = ((await computeApprovalBinding(ORG, (await getOutreachTaskById(ORG, id))!)) as { hash: string }).hash;
    expect(await approveTenantJourneyTask({ ...actor(id, PUBLISHER), expectedContentHash: hash, passkey: null }))
      .toMatchObject({ ok: false, code: 'self_approval_not_permitted' });

    configureTenant(true);
    const b = await begin(id, PUBLISHER);
    expect(await approveTenantJourneyTask({ ...actor(id, PUBLISHER), expectedContentHash: b.contentHash, passkey: assertion(String((b.passkeyOptions as Row).challenge)) }))
      .toMatchObject({ ok: true });
  });

  it('a publisher that cannot be established refuses (fail closed)', async () => {
    const id = await journey();
    mockVersion.publishedBy = null;
    expect(await beginTenantJourneyApproval(actor(id))).toMatchObject({ ok: false, code: 'self_approval_unverifiable' });
  });

  it('an internal journey step needs no passkey (it contacts nobody)', async () => {
    const id = await journey({ channel: INTERNAL_CHANNEL });
    const b = await begin(id);
    expect(b).toMatchObject({ passkeyRequired: false, passkeyOptions: null });
    expect(await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: null })).toMatchObject({ ok: true });
  });

  it('a non-journey task has no routine tenant approver', async () => {
    const id = await awaiting();
    expect(await beginTenantJourneyApproval(actor(id))).toMatchObject({ ok: false, code: 'not_a_journey_task' });
  });

  it('revocation through the tenant surface cancels the task and labels the row tenant', async () => {
    const id = await journey({ channel: INTERNAL_CHANNEL });
    const b = await begin(id);
    await approveTenantJourneyTask({ ...actor(id), expectedContentHash: b.contentHash, passkey: null });
    expect(await revokeTenantJourneyApproval(actor(id))).toMatchObject({ ok: true, status: 'cancelled' });
    expect((await listApprovals(ORG, id)).map((r) => [r.decision, r.tier])).toEqual([['approved', 'tenant'], ['revoked', 'tenant']]);
  });
});

// ── the platform override ────────────────────────────────────────────────────

describe('D-02 — the platform override route path', () => {
  it('labels its rows platform, and an external task ALWAYS needs the bound passkey (no opt-out)', async () => {
    const id = await journey();
    expect(await approveOutreachTaskForOperator(ORG, id, APPROVER, 'override', null, { passkey: null }))
      .toMatchObject({ ok: false, reason: 'passkey_required' });
    expect(await approveOutreachTaskForOperator(ORG, id, APPROVER, 'override')).toMatchObject({ ok: false, reason: 'passkey_required' });
    expect(await listApprovals(ORG, id)).toHaveLength(0);
    const b = await beginOperatorApproval(ORG, id, APPROVER);
    expect((await approveOutreachTaskForOperator(ORG, id, APPROVER, 'override', null, {
      passkey: assertion(String((b.passkeyOptions as Row).challenge)), expectedContentHash: b.contentHash ?? null,
    })).ok).toBe(true);
    expect((await listApprovals(ORG, id))[0]).toMatchObject({ tier: 'platform', passkey_credential_id: 'cred-1' });
  });
});

// ── no AI path writes an approval ────────────────────────────────────────────

describe('D-02 — AI recommendations never constitute approval', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const WRITER = /\b(approveOutreachTask|rejectOutreachTask|revokeOutreachApproval|appendApproval|approveOutreachTaskForOperator|approveTenantJourneyTask|revokeTenantJourneyApproval|cancelApprovalRequest)\s*\(/;
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') walk(p, out); } else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  it('only the human approval surfaces and the approval module itself call an approval writer', () => {
    const files = [...walk(path.join(ROOT, 'backend')), ...walk(path.join(ROOT, 'pages', 'api'))];
    const writers = files.filter((f) => WRITER.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();
    expect(writers).toEqual([
      'backend/services/leadOutreachActivation.ts',
      'backend/services/leadOutreachExecution/approval.ts',
      'backend/services/leadOutreachExecution/approvalRevocation.ts',
      'backend/services/leadOutreachExecution/storage.ts',
      'backend/services/orchestration/journeyApproval.ts',
      'pages/api/outreach/journey-approval.ts',
      'pages/api/super-admin/outreach/approve.ts',
    ]);
    for (const f of writers) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src).not.toMatch(/from ['"][^'"]*(openai|anthropic|aiGateway|llm|\/ai\/|generation|recommend)/i);
    }
  });
});

// ── F1: a stale approval returns the task to review, and only a stale one ─────

const approvalsOf = (id: string) => (db.tables.outreach_approvals ?? []).filter((r) => r.task_id === id);

describe('D-02 F1 — re-review: approval_stale → awaiting_approval, then a fresh approval', () => {
  /** What a refusal may touch (D-03 footprint): everything but the task status. */
  const footprint = (id: string) => ({
    decisions: (db.tables.outreach_decisions ?? []).filter((r) => r.task_id === id).length,
    attempts: (db.tables.outreach_attempts ?? []).filter((r) => r.task_id === id).length,
    evidence: (db.tables.outreach_delivery_evidence ?? []).filter((r) => r.task_id === id).length,
    workItems: workItems(id),
    quota: JSON.stringify([...fakeRedis.store.entries()].sort()),
    providerCalls: sent.length,
    approvals: JSON.stringify(approvalsOf(id)),
  });

  /** Refuse once as stale, prove the edge was the only extra write, then approve afresh and send once. */
  async function staleThenFresh(id: string, makeStale: () => Promise<void> | void) {
    await makeStale();
    const before = footprint(id);
    const firstRows = JSON.stringify(approvalsOf(id));
    const r = await dispatch(id);
    expect(r).toMatchObject({ outcome: 'blocked_governance', status: 'awaiting_approval' });
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(await status(id)).toBe('awaiting_approval');
    // Only the status moved, plus the one refusal decision row the gate always writes.
    expect(footprint(id)).toEqual({ ...before, decisions: before.decisions + 1 });

    // Nothing auto-approves on the way back: it cannot be sent until a person approves.
    for (let i = 0; i < 2; i += 1) {
      const again = await dispatch(id);
      expect(again.ok).toBe(false);
      expect(again.governance?.blockingCondition).toBe('eligibility.not_approved');
    }
    expect(sent).toHaveLength(0);
    expect(JSON.stringify(approvalsOf(id))).toBe(firstRows);

    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER })).ok).toBe(true);
    const rows = approvalsOf(id);
    expect(rows).toHaveLength(JSON.parse(firstRows).length + 1);
    // The first approval row is still there, byte-for-byte as it was.
    expect(JSON.stringify(rows.slice(0, -1))).toBe(firstRows);
    expect(rows[rows.length - 1].approved_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent' });
    expect(await dispatch(id)).toMatchObject({ ok: false });
    expect(await listAttempts(ORG, id)).toHaveLength(1);
  }

  it('content edited after approval', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    await staleThenFresh(id, () => { taskRow(id).action = 'Send a different email'; });
    expect(workItems(id)).toBe(1);
  });

  it('a journey email edited after approval (fresh approval through the tenant path, with passkey)', async () => {
    const id = await journey();
    await approveWithPasskey(ORG, id, APPROVER);
    mockEmail.body = 'Edited after approval.';
    expect((await dispatch(id)).status).toBe('awaiting_approval');
    // The fresh approval is the full D-02 path: binding, self rule, passkey.
    expect(await beginTenantJourneyApproval({ organizationId: ORG, taskId: id, approverUserId: PUBLISHER }))
      .toMatchObject({ ok: false, code: 'self_approval_not_permitted' });
    const b = await beginTenantJourneyApproval({ organizationId: ORG, taskId: id, approverUserId: APPROVER });
    if (b.ok !== true) throw new Error(b.code);
    expect(await approveTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: APPROVER, expectedContentHash: b.contentHash, passkey: null }))
      .toMatchObject({ ok: false, code: 'passkey_required' });
    expect(await approveTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: APPROVER, expectedContentHash: b.contentHash, passkey: assertion(String((b.passkeyOptions as Row).challenge)) }))
      .toMatchObject({ ok: true });
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent' });
    expect(sent).toEqual([RECIPIENT]);
  });

  it('a legacy approval with no hash', async () => {
    const id = await awaiting();
    await setOutreachTaskState(ORG, id, { status: 'approved' });
    await staleThenFresh(id, () => {
      (db.tables.outreach_approvals ??= []).push({
        id: 'legacy-1', company_id: ORG, task_id: id, decision: 'approved', approver_user_id: APPROVER,
        decided_at: new Date(Date.now() - 60_000).toISOString(), missing_information: [],
      });
    });
    expect(approvalsOf(id)[0]).toMatchObject({ id: 'legacy-1' });
    expect(approvalsOf(id)[0].approved_content_hash).toBeUndefined();
  });

  it('a person anchored after approval', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    await staleThenFresh(id, () => { taskRow(id).person_id = '00000000-0000-4000-8000-0000000000c9'; });
  });

  it('a requeued task takes the same edge from queued', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    await setOutreachTaskState(ORG, id, { status: 'queued' });
    taskRow(id).action = 'changed';
    db.statusWrites = [];
    expect(await dispatch(id)).toMatchObject({ status: 'awaiting_approval' });
    expect(db.statusWrites.filter((w) => w.to === 'awaiting_approval' && w.changed > 0)).toHaveLength(1);
  });

  it('two concurrent stale refusals make exactly one transition', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    taskRow(id).action = 'changed';
    db.statusWrites = [];
    const [a, b] = await Promise.all([dispatch(id), dispatch(id)]);
    expect([a.governance?.blockingCondition, b.governance?.blockingCondition]).toEqual(['eligibility.approval_stale', 'eligibility.approval_stale']);
    expect(db.statusWrites.filter((w) => w.to === 'awaiting_approval' && w.changed > 0)).toHaveLength(1);
    expect(await status(id)).toBe('awaiting_approval');
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});

describe('D-02 F1 — every other refusal keeps its outcome (no re-review)', () => {
  // Relative to the real clock: expiry is judged at the later of the caller's instant and the server's (T2).
  const approvedAt = new Date(Date.now() - DAY).toISOString();
  const noEdge = () => expect(db.statusWrites.filter((w) => w.to === 'awaiting_approval')).toHaveLength(0);

  it('approval_expired → expired, not awaiting_approval', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER, decidedAt: approvedAt });
    taskRow(id).action = 'changed as well';
    db.statusWrites = []; // only what the refusal itself writes
    const r = await dispatch(id, new Date(Date.parse(approvedAt) + 8 * DAY).toISOString());
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_expired');
    expect(await status(id)).toBe('expired');
    noEdge();
  });

  it('approval_revoked → status unchanged', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    await revokeOutreachApproval(ORG, id, { approverUserId: APPROVER });
    // A revoked task the gate still meets as approved (e.g. a stale read elsewhere).
    await setOutreachTaskState(ORG, id, { status: 'approved' });
    db.statusWrites = []; // only what the refusal itself writes
    const r = await dispatch(id);
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_revoked');
    expect(await status(id)).toBe('approved');
    noEdge();
  });

  it('approval_unverified (the approval log cannot be read) → stays approved, sends once readable', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    db.failTable = 'outreach_approvals';
    db.statusWrites = []; // only what the refusal itself writes
    const r = await dispatch(id);
    db.failTable = null;
    expect(r.governance?.blockingCondition).toBe('eligibility.approval_unverified');
    expect(await status(id)).toBe('approved');
    noEdge();
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent' });
  });

  it('kill switch (with a stale approval behind it) → stays approved', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    taskRow(id).action = 'changed';
    db.tables.outreach_governance_config[0].kill_switch = true;
    db.statusWrites = []; // only what the refusal itself writes
    const r = await dispatch(id);
    expect(r.governance?.blockingCondition).toBe('tenant.kill_switch');
    expect(await status(id)).toBe('approved');
    noEdge();
  });

  it('channel not enabled (with a stale approval behind it) → stays approved', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    taskRow(id).action = 'changed';
    db.tables.outreach_governance_config[0].enabled_channels = ['email'];
    db.statusWrites = []; // only what the refusal itself writes
    const r = await dispatch(id);
    expect(r.governance?.blockingCondition).toBe('suppression.channel_not_enabled');
    expect(await status(id)).toBe('approved');
    noEdge();
  });

  it('rate-limit deferral → stays approved', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    db.tables.outreach_governance_config[0].daily_limit_tenant = 0;
    db.statusWrites = []; // only what the refusal itself writes
    const r = await dispatch(id);
    expect(r.outcome).toBe('deferred_governance');
    expect(await status(id)).toBe('approved');
    noEdge();
  });
});

describe('D-02 F1 — the explicit resubmit, and no third writer', () => {
  it('requestFreshApproval moves a stale task to review; refuses valid, expired and revoked', async () => {
    const stale = await awaiting();
    await approveOutreachTask(ORG, stale, { approverUserId: APPROVER });
    taskRow(stale).action = 'changed';
    // N2 — RE-PINNED: an accepted resubmit needs an attributable requester (see the N2 suite).
    expect(await requestFreshApproval(ORG, stale, undefined, { userId: APPROVER })).toMatchObject({ ok: true, status: 'awaiting_approval' });
    expect(approvalsOf(stale)).toHaveLength(1);

    const valid = await awaiting();
    await approveOutreachTask(ORG, valid, { approverUserId: APPROVER });
    expect(await requestFreshApproval(ORG, valid)).toMatchObject({ ok: false, status: 'approved' });

    const old = await awaiting();
    await approveOutreachTask(ORG, old, { approverUserId: APPROVER, decidedAt: '2026-01-01T00:00:00.000Z' });
    expect(await requestFreshApproval(ORG, old)).toMatchObject({ ok: false, status: 'approved' });

    const revoked = await awaiting();
    await approveOutreachTask(ORG, revoked, { approverUserId: APPROVER });
    await revokeOutreachApproval(ORG, revoked, { approverUserId: APPROVER });
    expect(await requestFreshApproval(ORG, revoked)).toMatchObject({ ok: false, status: 'cancelled' });
  });

  it('the tenant resubmit returns a stale journey step to review; approving it again needs the full path', async () => {
    const id = await journey();
    await approveWithPasskey(ORG, id, APPROVER);
    mockEmail.subject = 'Edited';
    expect(await resubmitTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: APPROVER }))
      .toMatchObject({ ok: true, status: 'awaiting_approval' });
    expect(await beginTenantJourneyApproval({ organizationId: ORG, taskId: id, approverUserId: PUBLISHER }))
      .toMatchObject({ ok: false, code: 'self_approval_not_permitted' });
    expect(await dispatch(id)).toMatchObject({ ok: false });
    expect(sent).toHaveLength(0);
  });

  it('submitForApproval and the operator path never take the edge for an approved task', async () => {
    const id = await awaiting();
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    db.statusWrites = [];
    expect(await submitForApproval(ORG, id)).toMatchObject({ ok: false, refusal: 'invalid_state', status: 'approved' });
    expect(await approveOutreachTaskForOperator(ORG, id, APPROVER, 'again')).toMatchObject({ ok: false });
    expect(await status(id)).toBe('approved');
    expect(approvalsOf(id)).toHaveLength(1);
    expect(db.statusWrites.filter((w) => w.to === 'awaiting_approval' && w.changed > 0)).toHaveLength(0);
  });
});

// ── The D-02 verification set (named, one property each) ─────────────────────

describe('D-02 verification set', () => {
  /** An approved task whose content was then edited, so its approval is stale. */
  async function staleTask(): Promise<string> {
    const id = await awaiting();
    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER })).ok).toBe(true);
    taskRow(id).action = 'Send a different email';
    return id;
  }

  it('VS-1 approve → edit content → dispatch → stale refusal → re-review → fresh approval → successful dispatch', async () => {
    const id = await staleTask();
    const refused = await dispatch(id);
    expect(refused).toMatchObject({ ok: false, outcome: 'blocked_governance', status: 'awaiting_approval' });
    expect(refused.governance?.blockingCondition).toBe('eligibility.approval_stale');
    expect(await status(id)).toBe('awaiting_approval');
    expect((await approveOutreachTask(ORG, id, { approverUserId: APPROVER })).ok).toBe(true);
    expect(await dispatch(id)).toMatchObject({ ok: true, outcome: 'sent', attemptNumber: 1 });
    expect(workItems(id)).toBe(1);
  });

  it('VS-2 re-review alone cannot authorise sending', async () => {
    const id = await staleTask();
    await dispatch(id);
    expect(await status(id)).toBe('awaiting_approval');
    for (let i = 0; i < 3; i += 1) {
      const r = await dispatch(id);
      expect(r.ok).toBe(false);
      expect(r.governance?.blockingCondition).toBe('eligibility.not_approved');
    }
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    expect(workItems(id)).toBe(0);
    expect(approvalsOf(id).map((r) => r.decision)).toEqual(['approved']);
  });

  it('VS-3 the original approval row is unchanged, byte for byte, through refusal, re-review and fresh approval', async () => {
    const id = await staleTask();
    const original = JSON.stringify(approvalsOf(id)[0]);
    await dispatch(id);
    expect(JSON.stringify(approvalsOf(id)[0])).toBe(original);
    await approveOutreachTask(ORG, id, { approverUserId: APPROVER });
    await dispatch(id);
    const rows = approvalsOf(id);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows[0])).toBe(original);
    expect(rows[1].approved_content_hash).not.toBe(rows[0].approved_content_hash);
  });

  it('VS-4 the stale refusal consumes no execution resources: one refusal decision, a status-only task change', async () => {
    const id = await staleTask();
    const taskBefore = { ...taskRow(id) };
    const count = (t: string) => (db.tables[t] ?? []).filter((r) => r.task_id === id).length;
    const before = {
      decisions: count('outreach_decisions'), attempts: count('outreach_attempts'), evidence: count('outreach_delivery_evidence'),
      workItems: workItems(id), approvals: count('outreach_approvals'), quota: JSON.stringify([...fakeRedis.store.entries()]), provider: sent.length,
    };
    await dispatch(id);
    expect({
      decisions: count('outreach_decisions'), attempts: count('outreach_attempts'), evidence: count('outreach_delivery_evidence'),
      workItems: workItems(id), approvals: count('outreach_approvals'), quota: JSON.stringify([...fakeRedis.store.entries()]), provider: sent.length,
    }).toEqual({ ...before, decisions: before.decisions + 1 });
    // The one decision row is the governance refusal itself, written as before F1.
    const decision = (db.tables.outreach_decisions ?? []).filter((r) => r.task_id === id).pop()!;
    expect(decision).toMatchObject({ gate: 'approval', decision: 'denied' });
    expect(String(decision.reason)).toMatch(/^eligibility\.approval_stale: /);
    // The edge changed the task's status and timestamp, nothing else.
    const after = taskRow(id);
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(taskBefore[k])).sort();
    expect(changed).toContain('status');
    expect(changed.filter((k) => k !== 'status' && k !== 'updated_at')).toEqual([]);
    expect(after.status).toBe('awaiting_approval');

    // And the edge adds no decision of its own: a refusal that takes no edge writes the same one row.
    const other = await awaiting();
    await approveOutreachTask(ORG, other, { approverUserId: APPROVER });
    await revokeOutreachApproval(ORG, other, { approverUserId: APPROVER });
    await setOutreachTaskState(ORG, other, { status: 'approved' });
    const n = (db.tables.outreach_decisions ?? []).filter((r) => r.task_id === other).length;
    await dispatch(other);
    expect((db.tables.outreach_decisions ?? []).filter((r) => r.task_id === other).length).toBe(n + 1);
  });
});

// ── N2: who resubmitted, in the existing audit_logs trail ────────────────────

describe('N2 — the resubmission requester audit', () => {
  const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
  const audits = (id?: string) => (db.tables.audit_logs ?? [])
    .filter((r) => r.action === RESUBMISSION_AUDIT_ACTION && (id === undefined || (r.metadata as Row).task_id === id));
  async function staleJourney(): Promise<string> {
    const id = await journey();
    await approveWithPasskey(ORG, id, APPROVER);
    mockEmail.subject = 'Edited after approval';
    return id;
  }

  it('authorised requester: one row with the server-side requester, tenant, task, approval, verdict and both hashes', async () => {
    const id = await staleJourney();
    const [approval] = approvalsOf(id);
    const r = await resubmitTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: APPROVER, reason: 'subject corrected' });
    expect(r).toEqual({ ok: true, status: 'awaiting_approval' });
    const rows = audits(id);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ actor_user_id: APPROVER, company_id: ORG, action: 'OUTREACH_APPROVAL_RESUBMITTED' });
    const meta = row.metadata as Row;
    expect(meta).toMatchObject({
      schema: 'outreach.approval.resubmission.v1', task_id: id, requester_user_id: APPROVER, tier: 'tenant',
      approval_id: approval.id, approval_decision: 'approved', previous_status: 'approved', new_status: 'awaiting_approval',
      previous_verdict: 'stale', reason: 'subject corrected', authorises_execution: false,
    });
    expect(meta.previous_verdict_reason).toMatch(/changed after it was approved/);
    expect(meta.correlation_id).toEqual(expect.any(String));
    expect(Date.parse(String(meta.requested_at))).not.toBeNaN();
    // Content revision changed: the recorded current binding is not the approved one.
    expect(meta.previous_content_hash).toBe(approval.approved_content_hash);
    expect(meta.current_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.current_content_hash).not.toBe(meta.previous_content_hash);
    const current = await computeApprovalBinding(ORG, (await getOutreachTaskById(ORG, id))!);
    expect(meta.current_content_hash).toBe(current.hash);
    // Nothing personal: no address, no subject, no body.
    expect(JSON.stringify(row)).not.toMatch(/cto@bigcorp|Edited after approval|A short intro/);
  });

  it('a resubmission authorises nothing: the approval log is unchanged and dispatch still refuses', async () => {
    const id = await staleJourney();
    const before = JSON.stringify(approvalsOf(id));
    await resubmitTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: APPROVER });
    expect(JSON.stringify(approvalsOf(id))).toBe(before);
    const again = await dispatch(id);
    expect(again.ok).toBe(false);
    expect(again.governance?.blockingCondition).toBe('eligibility.not_approved');
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['no requester', undefined],
    ['an empty id', { userId: '' }],
    ['a non-uuid id', { userId: 'u-admin' }],
  ])('missing requester context (%s): refused, the task stays approved, nothing recorded', async (_label, requester) => {
    const id = await staleJourney();
    db.statusWrites = [];
    const r = await requestFreshApproval(ORG, id, undefined, requester as never);
    expect(r).toMatchObject({ ok: false, status: 'approved', reason: expect.stringMatching(/no attributable requester/) });
    expect(await status(id)).toBe('approved');
    expect(db.statusWrites).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it('cross-tenant: another tenant cannot resubmit (or see) the task; nothing recorded', async () => {
    const id = await staleJourney();
    expect(await resubmitTenantJourneyTask({ organizationId: OTHER_ORG, taskId: id, approverUserId: APPROVER }))
      .toMatchObject({ ok: false, code: 'task_not_found' });
    expect(await requestFreshApproval(OTHER_ORG, id, undefined, { userId: APPROVER }))
      .toMatchObject({ ok: false, status: null });
    expect(await status(id)).toBe('approved');
    expect(audits()).toHaveLength(0);
  });

  it('duplicate resubmission: the second is the existing already-awaiting no-op and records nothing', async () => {
    const id = await staleJourney();
    expect((await resubmitTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: APPROVER })).ok).toBe(true);
    const second = await requestFreshApproval(ORG, id, undefined, { userId: PUBLISHER });
    expect(second).toEqual({ ok: true, status: 'awaiting_approval', reason: 'already awaiting approval' });
    expect(audits(id)).toHaveLength(1);
    expect(audits(id)[0].actor_user_id).toBe(APPROVER);
  });

  it('interleaved resubmissions: one transition, one row (the loser is told, records nothing)', async () => {
    const id = await staleJourney();
    db.statusWrites = [];
    const results = await Promise.all([
      requestFreshApproval(ORG, id, undefined, { userId: APPROVER }),
      requestFreshApproval(ORG, id, undefined, { userId: PUBLISHER }),
    ]);
    expect(results.filter((r) => r.ok && r.reason !== 'already awaiting approval')).toHaveLength(1);
    expect(db.statusWrites.filter((w) => w.to === 'awaiting_approval' && w.changed > 0)).toHaveLength(1);
    expect(audits(id)).toHaveLength(1);
  });

  it('after rejection, expiry and revocation the lifecycle refuses a resubmit; nothing recorded', async () => {
    const rejected = await awaiting();
    expect((await rejectOutreachTask(ORG, rejected, { approverUserId: APPROVER, reason: 'no' })).ok).toBe(true);
    expect(await requestFreshApproval(ORG, rejected, undefined, { userId: APPROVER }))
      .toMatchObject({ ok: false, status: 'rejected', reason: expect.stringMatching(/no approval to resubmit/) });

    const lapsed = await awaiting();
    await approveOutreachTask(ORG, lapsed, { approverUserId: APPROVER, decidedAt: new Date(Date.now() - 8 * DAY).toISOString() });
    taskRow(lapsed).action = 'changed too';
    expect(await requestFreshApproval(ORG, lapsed, undefined, { userId: APPROVER }))
      .toMatchObject({ ok: false, status: 'approved', reason: expect.stringMatching(/is expired, not stale/) });
    // ... and once the gate ends it in `expired`, it is terminal.
    expect(await dispatch(lapsed)).toMatchObject({ status: 'expired' });
    expect(await requestFreshApproval(ORG, lapsed, undefined, { userId: APPROVER })).toMatchObject({ ok: false, status: 'expired' });

    const revoked = await awaiting();
    await approveOutreachTask(ORG, revoked, { approverUserId: APPROVER });
    await revokeOutreachApproval(ORG, revoked, { approverUserId: APPROVER });
    expect(await requestFreshApproval(ORG, revoked, undefined, { userId: APPROVER })).toMatchObject({ ok: false, status: 'cancelled' });
    expect(audits()).toHaveLength(0);
  });

  it('a failed audit write is reported (auditFailed), never swallowed; the transition stands', async () => {
    const id = await staleJourney();
    const spy = jest.spyOn(auditActorService, 'insertAuditLogStrict').mockResolvedValueOnce({ ok: false, error: 'down' });
    try {
      expect(await resubmitTenantJourneyTask({ organizationId: ORG, taskId: id, approverUserId: APPROVER }))
        .toEqual({ ok: true, status: 'awaiting_approval', auditFailed: true });
      expect(await status(id)).toBe('awaiting_approval');
    } finally {
      spy.mockRestore();
    }
  });
});
