/**
 * D-02 — approval binding, lifetime, revocation, self-approval and the per-approval
 * passkey, on REAL PostgreSQL, through the real journey → WS-3 path.
 *
 * Replaced: PostgREST (the pg transport), the email provider (recording), the Redis quota
 * counter, and ONLY the signature check inside the WebAuthn ceremony
 * (`verifyAuthenticationResponse` — a test cannot hold a real authenticator's private key).
 * The challenge is issued into and claimed from the real `webauthn_challenges` table, the
 * credential is a real `webauthn_credentials` row, and both are what make the
 * verification single-use, short-lived and user-bound here.
 *
 * Security-review fixes (D02-SECURITY-REVIEW-r2): service-level approvals of an email task
 * go through the same passkey ceremony (`serviceApprove`), and the CLAIM boundary is
 * proven in the database itself: the migration's trigger refuses `-> dispatching` for an
 * external task without a current, content-bound, passkey-verified approval, whatever the
 * application does.
 */

import * as fs from 'fs';
import * as path from 'path';
import { attempt, db, inRollback, seedTenants, ORG_A } from './setup';
import {
  enableOutreach, enrol, emailStep, handoffTasks, newProspect, newUser, one, rows,
} from './helpers/journeyFixtures';

// Test-only placeholders for the WebAuthn relying party; validated on import.
process.env.WEBAUTHN_RP_ID = 'localhost';
process.env.WEBAUTHN_RP_ORIGIN = 'http://localhost:3000';
process.env.SESSION_COOKIE_SECRET = 'd02-realschema-placeholder-secret-0123456789';

/** Every send the activation route's default provider (the edge seam) receives. */
const mockInvoked: string[] = [];
/** The full edge-seam request bodies, for the content and unsubscribe checks. */
const mockInvokedBodies: Array<Record<string, unknown>> = [];

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return {
    __esModule: true,
    supabase: {
      from: (t: string) => pgTable(client, t),
      rpc: pgRpc(client),
      // The activation route's default provider is the edge seam: recorded, never sent.
      functions: {
        invoke: async (_fn: string, opts: { body: Record<string, unknown> }) => {
          mockInvoked.push(String(opts.body.recipientEmail ?? ''));
          mockInvokedBodies.push(opts.body);
          return { data: { messageId: `edge-${String(opts.body.idempotencyKey)}` }, error: null };
        },
      },
    },
  };
});
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const mockRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) + by; this.store.set(k, n); return n; },
  async decrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) - by; this.store.set(k, n); return n; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => mockRedis }));
const mockSignatures = { calls: 0 };
jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual('@simplewebauthn/server'),
  verifyAuthenticationResponse: async (opts: { response: { response: { signature: string } } }) => {
    mockSignatures.calls += 1;
    return { verified: opts.response.response.signature === 'valid', authenticationInfo: { newCounter: 0 } };
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const { dispatchApprovedOutreachForLead } = require('../../services/leadOutreachActivation');
const ws3 = require('../../services/leadOutreachExecution');
const { revokeOutreachApproval } = require('../../services/leadOutreachExecution/approvalRevocation');
const journeyApproval = require('../../services/orchestration/journeyApproval');
const approvalPasskey = require('../../services/leadOutreachExecution/approvalPasskey');
const approvalBinding = require('../../services/leadOutreachExecution/approvalBinding');
const storage = require('../../services/leadOutreachExecution/storage');
/* eslint-enable @typescript-eslint/no-var-requires */

const ADDRESS = 'person@example.test';
const DAY = 24 * 3_600_000;
const sentDirect: string[] = [];
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; idempotencyKey: string }) { sentDirect.push(r.to); return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} }; },
};
const adapter = () => createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
});
/** Every provider call through either composition. */
const sentAll = () => [...sentDirect, ...mockInvoked];
const sweep = () => advanceAndDispatchWorkflowExecution(ORG_A, { now: new Date().toISOString(), deps: { adapters: [adapter()] } });
const status = async (taskId: string) => String((await one('SELECT status FROM public.outreach_tasks WHERE id = $1', [taskId])).status);
const countOf = async (table: string, taskId: string) => Number((await one(`SELECT count(*)::int n FROM public.${table} WHERE task_id = $1`, [taskId])).n);
const activate = async (prospectId: string, taskId: string, now?: string) =>
  (await dispatchApprovedOutreachForLead(ORG_A, prospectId, { channels: ['email'], taskIds: [taskId], recipient: ADDRESS, ...(now ? { now } : {}) }))[0];
const setRun = (id: string, state: string) => db.query('UPDATE public.execution_instances SET lifecycle_state = $2 WHERE id = $1', [id, state]);

/** A journey whose email step is bridged and awaiting approval; `publisher` published it. */
async function handedOff() {
  await seedTenants();
  await enableOutreach(ORG_A, ['email', 'internal']);
  const publisher = await newUser();
  const approver = await newUser();
  const { prospectId, personId } = await newProspect(ORG_A, { email: ADDRESS });
  const { instanceId } = await enrol(ORG_A, publisher, prospectId, { steps: [emailStep('intro')] });
  await sweep();
  const [task] = await handoffTasks(instanceId);
  expect(task.status).toBe('awaiting_approval');
  // A real passkey for the approver (the public key is never used: the signature check is the one replaced step).
  for (const u of [publisher, approver]) {
    await db.query(
      `INSERT INTO public.webauthn_credentials (user_id, credential_id, public_key) VALUES ($1, $2, '\\x00')`, [u, `cred-${u}`],
    );
  }
  return { publisher, approver, prospectId, personId: String(personId ?? ''), instanceId, taskId: String(task.id) };
}

const assertion = (user: string, challenge: string, signature = 'valid') => ({
  id: `cred-${user}`, rawId: `cred-${user}`, type: 'public-key', clientExtensionResults: {},
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost:3000' })).toString('base64url'), signature, authenticatorData: 'AA', userHandle: null },
});

/**
 * A service-level approval (the one writer) of an email task: it needs the same fresh
 * passkey proof as the tenant surface (S-02), so the ceremony runs against the real store.
 */
async function serviceApprove(org: string, taskId: string, user: string, extra: Record<string, unknown> = {}) {
  const task = await ws3.getOutreachTaskById(org, taskId);
  const binding = await approvalBinding.computeApprovalBinding(org, task);
  const ceremony = { userId: user, organizationId: org, taskId, action: 'approve', bindingHash: binding.hash };
  const opts = await approvalPasskey.beginApprovalPasskey(ceremony);
  const verified = await approvalPasskey.verifyApprovalPasskey(ceremony, assertion(user, String(opts.challenge)));
  if (verified.ok !== true) throw new Error(`passkey ceremony refused: ${verified.code}`);
  return ws3.approveOutreachTask(org, taskId, { approverUserId: user, ...extra, passkeyProof: verified.proof });
}

/** begin → approve as `user`, through the tenant service. */
async function tenantApprove(org: string, taskId: string, user: string) {
  const b = await journeyApproval.beginTenantJourneyApproval({ organizationId: org, taskId, approverUserId: user });
  if (b.ok !== true) return b;
  return journeyApproval.approveTenantJourneyTask({
    organizationId: org, taskId, approverUserId: user, expectedContentHash: b.contentHash,
    passkey: assertion(user, String(b.passkeyOptions.challenge)),
  });
}

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sentDirect.length = 0; mockInvoked.length = 0; mockInvokedBodies.length = 0; mockRedis.store.clear(); mockSignatures.calls = 0; });

describe('D-02 migration', () => {
  it('forward: the columns, the widened CHECK and the default are present', async () => {
    await inRollback(async () => {
      const cols = await rows(
        `SELECT table_name, column_name, is_nullable, data_type, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND ((table_name = 'outreach_approvals' AND column_name IN ('approved_content_hash', 'tier', 'passkey_credential_id', 'passkey_verified_at', 'approved_recipient'))
             OR (table_name = 'outreach_governance_config' AND column_name = 'self_approval_allowed')) ORDER BY 1, 2`);
      expect(cols.map((c) => [c.table_name, c.column_name, c.is_nullable, c.data_type])).toEqual([
        ['outreach_approvals', 'approved_content_hash', 'YES', 'text'],
        ['outreach_approvals', 'approved_recipient', 'YES', 'text'],
        ['outreach_approvals', 'passkey_credential_id', 'YES', 'text'],
        ['outreach_approvals', 'passkey_verified_at', 'YES', 'timestamp with time zone'],
        ['outreach_approvals', 'tier', 'YES', 'text'],
        ['outreach_governance_config', 'self_approval_allowed', 'NO', 'boolean'],
      ]);
      expect(String(cols[5].column_default)).toBe('false');
      const def = await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'outreach_approvals_decision_valid'`);
      expect(String(def.d)).toMatch(/revoked/);
      // No table, type, enum, index or store: two guard triggers, and nothing callable by a client.
      const ddl = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20270120000011_outreach_approval_binding.sql'), 'utf8')
        .split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(ddl).not.toMatch(/CREATE\s+(TABLE|TYPE|INDEX|SCHEMA)/i);
      expect(ddl.match(/CREATE\s+TRIGGER/gi)).toHaveLength(2);
      const triggers = await rows(`SELECT tgname, tgrelid::regclass::text rel FROM pg_trigger
        WHERE tgname IN ('outreach_approvals_server_decided_at', 'outreach_tasks_claim_requires_approval') ORDER BY 1`);
      expect(triggers.map((t) => [t.tgname, t.rel])).toEqual([
        ['outreach_approvals_server_decided_at', 'outreach_approvals'],
        ['outreach_tasks_claim_requires_approval', 'outreach_tasks'],
      ]);
      for (const role of ['anon', 'authenticated']) {
        const can = await rows(`SELECT p.proname FROM pg_proc p WHERE p.proname IN ('outreach_approvals_server_decided_at', 'outreach_tasks_claim_requires_approval')
          AND has_function_privilege($1, p.oid, 'EXECUTE')`, [role]);
        expect(can).toEqual([]);
      }
    });
  });

  it('forward: a malformed hash or tier is refused; a revoked row is append-only like the rest', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      const ins = (decision: string, hash: string | null, tier: string | null) => db.query('SAVEPOINT x').then(() => db.query(
        `INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at, approved_content_hash, tier)
         VALUES ($1, $2, $3, $4, now(), $5, $6)`, [ORG_A, s.taskId, decision, s.approver, hash, tier],
      ).then(() => 'ok', (e: { code?: string }) => e.code ?? 'err')).then(async (r) => { await db.query('ROLLBACK TO SAVEPOINT x'); return r; });
      expect(await ins('approved', 'NOT-A-HASH', 'tenant')).toBe('23514');
      expect(await ins('approved', 'a'.repeat(64), 'superuser')).toBe('23514');
      expect(await ins('withdrawn', null, null)).toBe('23514');
      expect(await ins('revoked', null, 'tenant')).toBe('ok');
      // T1 - the server clock: a future decided_at is refused, an omitted one is stamped.
      expect(await attempt(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at)
        VALUES ($1, $2, 'approved', $3, now() + interval '1 day')`, [ORG_A, s.taskId, s.approver])).toBe('23514');
      await db.query('SAVEPOINT t1');
      const stamped = await one(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id)
        VALUES ($1, $2, 'rejected', $3) RETURNING clock_timestamp() - decided_at < interval '1 minute' AS fresh`, [ORG_A, s.taskId, s.approver]);
      await db.query('ROLLBACK TO SAVEPOINT t1');
      expect(stamped.fresh).toBe(true);
      // Passkey evidence comes as a pair, and only on an approval.
      expect(await attempt(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at, passkey_credential_id)
        VALUES ($1, $2, 'approved', $3, now(), 'cred')`, [ORG_A, s.taskId, s.approver])).toBe('23514');
      expect(await attempt(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at, passkey_credential_id, passkey_verified_at)
        VALUES ($1, $2, 'revoked', $3, now(), 'cred', now())`, [ORG_A, s.taskId, s.approver])).toBe('23514');
      await db.query(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at, tier) VALUES ($1, $2, 'revoked', $3, now(), 'tenant')`, [ORG_A, s.taskId, s.approver]);
      await db.query('SAVEPOINT y');
      await expect(db.query(`UPDATE public.outreach_approvals SET decision = 'approved' WHERE task_id = $1`, [s.taskId])).rejects.toThrow(/append-only/);
      await db.query('ROLLBACK TO SAVEPOINT y');
    });
  });

  it('rollback: restores the prior schema, and refuses while a revoked row exists', async () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/rollbacks/outreach_approval_binding_rollback.sql'), 'utf8')
      // The suite owns the transaction; the file's own BEGIN/COMMIT would end it.
      .replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
    await inRollback(async () => {
      const s = await handedOff();
      await db.query(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at) VALUES ($1, $2, 'revoked', $3, now())`, [ORG_A, s.taskId, s.approver]);
      await db.query('SAVEPOINT r');
      await expect(db.query(sql)).rejects.toThrow(/revoked decision row/);
      await db.query('ROLLBACK TO SAVEPOINT r');
    });
    await inRollback(async () => {
      await db.query(sql);
      const left = await rows(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
        AND column_name IN ('approved_content_hash', 'tier', 'passkey_credential_id', 'passkey_verified_at', 'approved_recipient', 'self_approval_allowed')
        AND table_name IN ('outreach_approvals', 'outreach_governance_config')`);
      expect(left).toHaveLength(0);
      expect(await rows(`SELECT 1 FROM pg_trigger WHERE tgname IN ('outreach_approvals_server_decided_at', 'outreach_tasks_claim_requires_approval')`)).toHaveLength(0);
      expect(await rows(`SELECT 1 FROM pg_proc WHERE proname IN ('outreach_approvals_server_decided_at', 'outreach_tasks_claim_requires_approval')`)).toHaveLength(0);
      const def = await one(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'outreach_approvals_decision_valid'`);
      expect(String(def.d)).not.toMatch(/revoked/);
      // and forward again over the rolled-back schema
      await db.query(fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20270120000011_outreach_approval_binding.sql'), 'utf8'));
      const back = await rows(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
        AND column_name IN ('approved_content_hash', 'tier', 'passkey_credential_id', 'passkey_verified_at', 'approved_recipient', 'self_approval_allowed')`);
      expect(back).toHaveLength(6);
      expect(await rows(`SELECT 1 FROM pg_trigger WHERE tgname IN ('outreach_approvals_server_decided_at', 'outreach_tasks_claim_requires_approval')`)).toHaveLength(2);
    });
  });
});

describe('D-02 — a tenant approval bound to the content sends exactly once', () => {
  it('begin → passkey → approve; the row is tenant-tier with the hash; activation sends once', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true, status: 'approved' });
      const row = await one('SELECT decision, tier, approved_content_hash, approver_user_id FROM public.outreach_approvals WHERE task_id = $1', [s.taskId]);
      expect(row).toMatchObject({ decision: 'approved', tier: 'tenant', approver_user_id: s.approver });
      expect(String(row.approved_content_hash)).toMatch(/^[0-9a-f]{64}$/);
      // The passkey challenge was issued into and consumed in the real store.
      expect(await rows('SELECT 1 FROM public.webauthn_challenges WHERE user_id = $1 AND consumed_at IS NOT NULL', [s.approver])).toHaveLength(1);

      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ action: 'terminal' });
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(sentAll()).toEqual([ADDRESS]);
      // F2 — the render is deterministic and the per-attempt unsubscribe link is outside the
      // hash: the approval made BEFORE the send still matched AT the send, and what was sent
      // is the personalized render of the authored step, with its own unsubscribe link.
      const [sentBody] = mockInvokedBodies;
      expect(String(sentBody.body)).toContain('Hello Ana');
      expect(String(sentBody.unsubscribeUrl)).toMatch(/^https:\/\/app\.example\.test\/.+/);
      expect(String(sentBody.body)).not.toContain(String(sentBody.unsubscribeUrl));
    });
  });

  it('the same passkey verification cannot be replayed', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      const b = await journeyApproval.beginTenantJourneyApproval({ organizationId: ORG_A, taskId: s.taskId, approverUserId: s.approver });
      const passkey = assertion(s.approver, String(b.passkeyOptions.challenge));
      const args = { organizationId: ORG_A, taskId: s.taskId, approverUserId: s.approver, expectedContentHash: b.contentHash, passkey };
      expect(await journeyApproval.approveTenantJourneyTask(args)).toMatchObject({ ok: true });
      await db.query(`UPDATE public.outreach_tasks SET status = 'awaiting_approval' WHERE id = $1`, [s.taskId]);
      expect(await journeyApproval.approveTenantJourneyTask(args)).toMatchObject({ ok: false, code: 'passkey_replayed' });
    });
  });

  it('a stale passkey challenge is refused by the real store', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      const b = await journeyApproval.beginTenantJourneyApproval({ organizationId: ORG_A, taskId: s.taskId, approverUserId: s.approver });
      await db.query(`UPDATE public.webauthn_challenges SET created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second' WHERE challenge = $1`, [String(b.passkeyOptions.challenge)]);
      expect(await journeyApproval.approveTenantJourneyTask({
        organizationId: ORG_A, taskId: s.taskId, approverUserId: s.approver, expectedContentHash: b.contentHash,
        passkey: assertion(s.approver, String(b.passkeyOptions.challenge)),
      })).toMatchObject({ ok: false, code: 'passkey_stale' });
      expect(await rows('SELECT 1 FROM public.outreach_approvals WHERE task_id = $1', [s.taskId])).toHaveLength(0);
    });
  });
});

describe('D-02 — edited after approval → approval_stale, no attempt, no provider call', () => {
  const edits: Array<[string, (s: Awaited<ReturnType<typeof handedOff>>) => Promise<unknown>]> = [
    ['the person\'s address', (s) => db.query(`UPDATE public.unified_persons SET primary_email = 'moved@example.test' WHERE id = (SELECT person_id FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1)`, [s.taskId])],
    ['the person\'s name (changes the rendered body)', (s) => db.query(`UPDATE public.unified_persons SET first_name = 'Renamed' WHERE id = (SELECT person_id FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1)`, [s.taskId])],
    ['the action', (s) => db.query(`UPDATE public.outreach_tasks SET action = action || ' (edited)' WHERE id = $1`, [s.taskId])],
  ];
  it.each(edits)('%s', async (_n, edit) => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      await edit(s);
      const task = await ws3.getOutreachTaskById(ORG_A, s.taskId);
      const r = await ws3.dispatchInternalOutreachTask(ORG_A, s.taskId, { recipient: ADDRESS });
      expect(r.outcome).toBe('blocked_governance');
      expect(r.governance.blockingCondition).toBe('eligibility.approval_stale');
      expect(task.status).toBe('approved');
      // F1 — back to review for a fresh approval, not stuck and not cancelled.
      expect(await status(s.taskId)).toBe('awaiting_approval');
      expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
      expect(await countOf('outreach_delivery_evidence', s.taskId)).toBe(0);
      expect(sentAll()).toHaveLength(0);
      const decision = await one(`SELECT gate, decision, reason FROM public.outreach_decisions WHERE task_id = $1 ORDER BY decided_at DESC LIMIT 1`, [s.taskId]);
      expect(decision).toMatchObject({ gate: 'approval', decision: 'denied' });
      expect(String(decision.reason)).toMatch(/^eligibility\.approval_stale/);
    });
  });
});

describe('D-02 — seven days, enforced where the send happens', () => {
  const approvedAt = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
  it('8 days old: refused and the task is expired', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await serviceApprove(ORG_A, s.taskId, s.approver, { decidedAt: approvedAt(8) })).ok).toBe(true);
      const r = await activate(s.prospectId, s.taskId);
      expect(r.outcome).toBe('blocked_governance');
      expect(await status(s.taskId)).toBe('expired');
      expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
      expect(sentAll()).toHaveLength(0);
      // The approval row still says approved; it is the boundary that refuses.
      expect((await one('SELECT decision FROM public.outreach_approvals WHERE task_id = $1', [s.taskId])).decision).toBe('approved');
    });
  });
  it('6 days old: sends', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await serviceApprove(ORG_A, s.taskId, s.approver, { decidedAt: approvedAt(6) })).ok).toBe(true);
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(sentAll()).toEqual([ADDRESS]);
    });
  });
});

describe('D-02 — revoked, legacy', () => {
  it('revoked: an appended row, the task cancelled, nothing sent', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      expect(await journeyApproval.revokeTenantJourneyApproval({ organizationId: ORG_A, taskId: s.taskId, approverUserId: s.approver }))
        .toMatchObject({ ok: true, status: 'cancelled' });
      expect((await rows('SELECT decision FROM public.outreach_approvals WHERE task_id = $1 ORDER BY decided_at', [s.taskId])).map((r) => r.decision))
        .toEqual(['approved', 'revoked']);
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ action: 'terminal' });
      expect(await ws3.dispatchInternalOutreachTask(ORG_A, s.taskId, { recipient: ADDRESS })).toMatchObject({ outcome: 'blocked_governance' });
      expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
      expect(sentAll()).toHaveLength(0);
      // A second revocation has nothing to revoke.
      expect((await revokeOutreachApproval(ORG_A, s.taskId, { approverUserId: s.approver })).ok).toBe(false);
    });
  });

  it('a legacy approval row with no hash never authorises, and is kept as it is', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      await db.query(`UPDATE public.outreach_tasks SET status = 'approved' WHERE id = $1`, [s.taskId]);
      await db.query(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at) VALUES ($1, $2, 'approved', $3, now())`, [ORG_A, s.taskId, s.approver]);
      const r = await activate(s.prospectId, s.taskId);
      expect(r.outcome).toBe('blocked_governance');
      expect(r.reason).toMatch(/approval_stale/);
      expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
      expect(sentAll()).toHaveLength(0);
      expect(await rows('SELECT approved_content_hash FROM public.outreach_approvals WHERE task_id = $1', [s.taskId])).toEqual([{ approved_content_hash: null }]);
    });
  });
});

describe('D-02 — self-approval', () => {
  it('the workflow version\'s publisher is refused by default, allowed once the tenant enables it', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.publisher)).toMatchObject({ ok: false, code: 'self_approval_not_permitted' });
      expect(await rows('SELECT 1 FROM public.outreach_approvals WHERE task_id = $1', [s.taskId])).toHaveLength(0);
      await db.query('UPDATE public.outreach_governance_config SET self_approval_allowed = true WHERE company_id = $1', [ORG_A]);
      expect(await tenantApprove(ORG_A, s.taskId, s.publisher)).toMatchObject({ ok: true });
    });
  });
});

describe('D-02 — D-03 still holds an approved, bound task', () => {
  it('paused: held, nothing written; resumed: sent once', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      await setRun(s.instanceId, 'paused');
      const decisions = await countOf('outreach_decisions', s.taskId);
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'deferred_journey' });
      expect(await countOf('outreach_decisions', s.taskId)).toBe(decisions);
      expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
      expect(await status(s.taskId)).toBe('approved');
      await setRun(s.instanceId, 'active');
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(sentAll()).toEqual([ADDRESS]);
    });
  });
});

describe('D-02 F1 — a stale approval returns the task to review (real PostgreSQL)', () => {
  const footprint = async (taskId: string) => ({
    decisions: await countOf('outreach_decisions', taskId),
    attempts: await countOf('outreach_attempts', taskId),
    evidence: await countOf('outreach_delivery_evidence', taskId),
    workItems: await countOf('outreach_internal_work_items', taskId),
    quota: JSON.stringify([...mockRedis.store.entries()].sort()),
    providerCalls: sentAll().length,
  });
  const approvalRows = async (taskId: string) => JSON.stringify(await rows(
    'SELECT id, decision, approver_user_id, approved_content_hash, tier, decided_at, created_at, reason, notes FROM public.outreach_approvals WHERE task_id = $1 ORDER BY decided_at, created_at', [taskId]));

  async function refusedStaleOnce(prospectId: string, taskId: string) {
    const before = await footprint(taskId);
    const first = await approvalRows(taskId);
    const r = await activate(prospectId, taskId);
    expect(r.outcome).toBe('blocked_governance');
    expect(r.reason).toMatch(/approval_stale/);
    expect(await status(taskId)).toBe('awaiting_approval');
    // Only the status moved, plus the one refusal decision row the gate always writes.
    expect(await footprint(taskId)).toEqual({ ...before, decisions: before.decisions + 1 });
    const decision = await one('SELECT gate, decision, reason FROM public.outreach_decisions WHERE task_id = $1 ORDER BY decided_at DESC LIMIT 1', [taskId]);
    expect(decision).toMatchObject({ gate: 'approval', decision: 'denied' });
    // Nothing approves it on the way back.
    expect((await activate(prospectId, taskId)).outcome).not.toBe('sent');
    expect(sentAll()).toHaveLength(0);
    expect(await approvalRows(taskId)).toBe(first);
    return first;
  }

  it('journey email: approve → person renamed → stale → awaiting_approval → fresh tenant approval → sent once', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      await db.query(`UPDATE public.unified_persons SET first_name = 'Renamed' WHERE id = (SELECT person_id FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1)`, [s.taskId]);
      const first = await refusedStaleOnce(s.prospectId, s.taskId);
      // The fresh approval is the full path: the publisher is still refused, the approver needs a new passkey.
      expect(await tenantApprove(ORG_A, s.taskId, s.publisher)).toMatchObject({ ok: false, code: 'self_approval_not_permitted' });
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true, status: 'approved' });
      const all = JSON.parse(await approvalRows(s.taskId));
      expect(all).toHaveLength(2);
      expect(JSON.stringify(all.slice(0, 1))).toBe(first);
      expect(all[1].approved_content_hash).not.toBe(all[0].approved_content_hash);
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ action: 'terminal' });
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(sentAll()).toEqual([ADDRESS]);
      expect(String(mockInvokedBodies[0].body)).toContain('Hello Renamed');
    });
  });

  it('a legacy approval with no hash → awaiting_approval → fresh approval → sent once; the legacy row is kept', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      await db.query(`UPDATE public.outreach_tasks SET status = 'approved' WHERE id = $1`, [s.taskId]);
      await db.query(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at) VALUES ($1, $2, 'approved', $3, now() - interval '1 minute')`, [ORG_A, s.taskId, s.approver]);
      const first = await refusedStaleOnce(s.prospectId, s.taskId);
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      const all = JSON.parse(await approvalRows(s.taskId));
      expect(JSON.stringify(all.slice(0, 1))).toBe(first);
      expect(all[0].approved_content_hash).toBeNull();
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(sentAll()).toEqual([ADDRESS]);
    });
  });

  it('a person anchored after approval (non-journey task) → awaiting_approval → fresh approval → sent once', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['internal']);
      const approver = await newUser();
      const { prospectId, personId } = await newProspect(ORG_A, { email: ADDRESS });
      const ins = await ws3.insertOutreachTask({
        companyId: ORG_A, leadId: prospectId, personId: null, planTaskId: `anchor-${Date.now()}`, taskOrder: 1,
        kind: 'outreach', action: 'Look at this account', channel: 'internal', dependsOnPlanTaskId: null, estimatedDelayHours: 0,
        confidence: null, explanation: null, requiresApproval: true,
        plannerVersion: 'lie-2.1.0', translationVersion: ws3.TRANSLATION_VERSION,
        governanceVersion: ws3.GOVERNANCE_VERSION, executionRuntimeVersion: ws3.EXECUTION_RUNTIME_VERSION,
        materializedAt: new Date().toISOString(),
      });
      const taskId = String(ins.data.id);
      expect((await ws3.submitForApproval(ORG_A, taskId)).ok).toBe(true);
      expect((await ws3.approveOutreachTask(ORG_A, taskId, { approverUserId: approver })).ok).toBe(true);
      await db.query('UPDATE public.outreach_tasks SET person_id = $2 WHERE id = $1', [taskId, personId]);
      ws3.__clearTransportsForTests();
      ws3.registerDefaultTransports({ emailProvider: provider });
      const before = await footprint(taskId);
      const r = await ws3.dispatchInternalOutreachTask(ORG_A, taskId, {});
      expect(r).toMatchObject({ outcome: 'blocked_governance', status: 'awaiting_approval' });
      expect(r.governance.blockingCondition).toBe('eligibility.approval_stale');
      expect(await footprint(taskId)).toEqual({ ...before, decisions: before.decisions + 1 });
      expect((await ws3.approveOutreachTask(ORG_A, taskId, { approverUserId: approver })).ok).toBe(true);
      expect(await ws3.dispatchInternalOutreachTask(ORG_A, taskId, {})).toMatchObject({ outcome: 'sent' });
      expect(await countOf('outreach_internal_work_items', taskId)).toBe(1);
      expect(await rows('SELECT 1 FROM public.outreach_approvals WHERE task_id = $1', [taskId])).toHaveLength(2);
    });
  });

  it('two stale refusals of the same task: one transition, the second finds it already in review', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      await db.query(`UPDATE public.outreach_tasks SET action = action || ' (edited)' WHERE id = $1`, [s.taskId]);
      const [a, b] = await Promise.all([
        ws3.dispatchInternalOutreachTask(ORG_A, s.taskId, { recipient: ADDRESS }),
        ws3.dispatchInternalOutreachTask(ORG_A, s.taskId, { recipient: ADDRESS }),
      ]);
      expect([a.governance.blockingCondition, b.governance.blockingCondition]).toEqual(['eligibility.approval_stale', 'eligibility.approval_stale']);
      expect([a.status, b.status].filter((x: string) => x === 'awaiting_approval')).toHaveLength(1);
      expect(await status(s.taskId)).toBe('awaiting_approval');
      expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
      expect(sentAll()).toHaveLength(0);
    });
  });

  it('an expired approval still ends expired, and a stale one is never cancelled', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await serviceApprove(ORG_A, s.taskId, s.approver, { decidedAt: new Date(Date.now() - 8 * DAY).toISOString() })).ok).toBe(true);
      await db.query(`UPDATE public.outreach_tasks SET action = action || ' (edited)' WHERE id = $1`, [s.taskId]);
      await activate(s.prospectId, s.taskId);
      expect(await status(s.taskId)).toBe('expired');
    });
  });
});

describe('D-02 verification set (real PostgreSQL)', () => {
  it('VS-5 positive journey email: real personalization and unsubscribe link; the approved and the sent render hash identically', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      const { prepareEmailSend } = require('../../services/emailEngine/emailSendPath');
      const { approvalPreviewHash, computeApprovalBinding } = require('../../services/leadOutreachExecution/approvalBinding');

      // What the approver saw, and the hash recorded with their approval.
      const shown = await prepareEmailSend(ORG_A, s.taskId);
      expect(shown.rendered.body).toContain('Hello Ana');
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      const recorded = String((await one('SELECT approved_content_hash h FROM public.outreach_approvals WHERE task_id = $1', [s.taskId])).h);

      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(mockInvokedBodies).toHaveLength(1);
      const sentBody = mockInvokedBodies[0];
      expect(String(sentBody.unsubscribeUrl)).toMatch(/^https:\/\/app\.example\.test\/.+/);

      // The bytes the provider received are the bytes that were approved…
      const shownPreview = approvalPreviewHash({
        organizationId: ORG_A, outreachTaskId: s.taskId, subject: shown.rendered.subject, body: shown.rendered.body,
        channel: 'email', email: shown.recipient.email, workflowVersionId: shown.context.workflowVersionId,
      });
      const sentPreview = approvalPreviewHash({
        organizationId: ORG_A, outreachTaskId: s.taskId, subject: String(sentBody.subject), body: String(sentBody.body),
        channel: 'email', email: String(sentBody.recipientEmail), workflowVersionId: shown.context.workflowVersionId,
      });
      expect(sentPreview).toBe(shownPreview);
      // …and recomputing the binding now (after the send, from the stored task) gives the recorded hash.
      const now = await computeApprovalBinding(ORG_A, await ws3.getOutreachTaskById(ORG_A, s.taskId));
      expect(now).toMatchObject({ ok: true, hash: recorded });
      // The per-attempt unsubscribe link is outside the hashed content.
      expect(String(sentBody.body)).not.toContain(String(sentBody.unsubscribeUrl));
    });
  });
});

// ── Security-review fixes: the claim boundary, in the database ───────────────

describe('D-02 security review — the database refuses the claim without a valid approval', () => {
  /** The claim as the application's CAS writes it, probed (rolled back to a savepoint). */
  const claim = (taskId: string) => attempt(`UPDATE public.outreach_tasks SET status = 'dispatching' WHERE id = $1 AND status = 'queued'`, [taskId]);
  const toQueued = (taskId: string) => db.query(`UPDATE public.outreach_tasks SET status = 'queued' WHERE id = $1`, [taskId]);
  /** An approval row written straight to the table (as a bug, a script or a direct writer would). */
  const rawApproval = (s: { taskId: string; approver: string }, decision: string, opts: { hash?: string | null; cred?: boolean; at?: string } = {}) =>
    db.query(
      `INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at, approved_content_hash, passkey_credential_id, passkey_verified_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, clock_timestamp()), $6, $7, $8)`,
      [ORG_A, s.taskId, decision, s.approver, opts.at ?? null, opts.hash === undefined ? 'a'.repeat(64) : opts.hash,
        opts.cred ? `cred-${s.approver}` : null, opts.cred ? new Date().toISOString() : null],
    );

  it('control: a current, bound, passkey-verified approval is claimable', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      await toQueued(s.taskId);
      expect(await claim(s.taskId)).toBe('ok');
    });
  });

  it('expired (8 days): the claim is refused even when the application skips the gate', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await serviceApprove(ORG_A, s.taskId, s.approver, { decidedAt: new Date(Date.now() - 8 * DAY).toISOString() })).ok).toBe(true);
      await toQueued(s.taskId);
      expect(await claim(s.taskId)).toBe('23514');
      // The application's own claim (no gate before it) is refused too, and nothing moved.
      expect(await storage.transitionOutreachTaskState(ORG_A, s.taskId, 'queued', 'dispatching')).toMatchObject({ ok: false, changed: false });
      expect(await status(s.taskId)).toBe('queued');
    });
  });

  it('missing passkey evidence: refused', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      await rawApproval(s, 'approved', { cred: false });
      await toQueued(s.taskId);
      expect(await claim(s.taskId)).toBe('23514');
      await rawApproval(s, 'approved', { cred: true });
      expect(await claim(s.taskId)).toBe('ok');
    });
  });

  it('revoked (a later revocation row): refused', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      await toQueued(s.taskId);
      await rawApproval(s, 'revoked', { hash: null });
      expect(await claim(s.taskId)).toBe('23514');
    });
  });

  it('legacy (no content hash): refused', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      await rawApproval(s, 'approved', { hash: null, cred: false });
      await toQueued(s.taskId);
      expect(await claim(s.taskId)).toBe('23514');
    });
  });

  it('decided_at in the future: refused at insert, and refused at the claim if it got in anyway', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      const future = new Date(Date.now() + DAY).toISOString();
      expect(await attempt(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, decided_at) VALUES ($1, $2, 'approved', $3, $4)`,
        [ORG_A, s.taskId, s.approver, future])).toBe('23514');
      await db.query('ALTER TABLE public.outreach_approvals DISABLE TRIGGER outreach_approvals_server_decided_at');
      await rawApproval(s, 'approved', { cred: true, at: future });
      await db.query('ALTER TABLE public.outreach_approvals ENABLE TRIGGER outreach_approvals_server_decided_at');
      await toQueued(s.taskId);
      expect(await claim(s.taskId)).toBe('23514');
    });
  });

  it('the internal channel needs no passkey evidence to be claimed', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['internal']);
      const approver = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
      const ins = await ws3.insertOutreachTask({
        companyId: ORG_A, leadId: prospectId, personId: null, planTaskId: `claim-int-${Date.now()}`, taskOrder: 1,
        kind: 'outreach', action: 'Look at this account', channel: 'internal', dependsOnPlanTaskId: null, estimatedDelayHours: 0,
        confidence: null, explanation: null, requiresApproval: true,
        plannerVersion: 'lie-2.1.0', translationVersion: ws3.TRANSLATION_VERSION,
        governanceVersion: ws3.GOVERNANCE_VERSION, executionRuntimeVersion: ws3.EXECUTION_RUNTIME_VERSION,
        materializedAt: new Date().toISOString(),
      });
      const taskId = String(ins.data.id);
      expect((await ws3.submitForApproval(ORG_A, taskId)).ok).toBe(true);
      expect((await ws3.approveOutreachTask(ORG_A, taskId, { approverUserId: approver })).ok).toBe(true);
      expect((await one('SELECT passkey_credential_id FROM public.outreach_approvals WHERE task_id = $1', [taskId])).passkey_credential_id).toBeNull();
      await toQueued(taskId);
      expect(await claim(taskId)).toBe('ok');
    });
  });

  it('two workers claiming the same task: exactly one wins, one attempt, one provider call', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      const reports = await Promise.all([activate(s.prospectId, s.taskId), activate(s.prospectId, s.taskId)]);
      expect(reports.filter((r: { outcome?: string }) => r.outcome === 'sent')).toHaveLength(1);
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(sentAll()).toEqual([ADDRESS]);
    });
  });

  it('two concurrent claim CASes on one queued task: exactly one changes the row', async () => {
    await inRollback(async () => {
      const t = await handedOff();
      expect(await tenantApprove(ORG_A, t.taskId, t.approver)).toMatchObject({ ok: true });
      await toQueued(t.taskId);
      const claims = await Promise.all([
        storage.transitionOutreachTaskState(ORG_A, t.taskId, 'queued', 'dispatching'),
        storage.transitionOutreachTaskState(ORG_A, t.taskId, 'queued', 'dispatching'),
      ]);
      expect(claims.map((c: { changed: boolean }) => c.changed).sort()).toEqual([false, true]);
    });
  });

  it('revocation racing the claim: either the revocation or the send wins, never both, never a send after a revocation', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      const [revoked, dispatched] = await Promise.all([
        journeyApproval.revokeTenantJourneyApproval({ organizationId: ORG_A, taskId: s.taskId, approverUserId: s.approver }),
        activate(s.prospectId, s.taskId),
      ]);
      const sentOnce = dispatched.outcome === 'sent';
      expect(revoked.ok !== sentOnce).toBe(true);
      if (revoked.ok) {
        expect(await status(s.taskId)).toBe('cancelled');
        expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
        expect(sentAll()).toHaveLength(0);
      } else {
        expect(sentAll()).toEqual([ADDRESS]);
      }
    });
  });

  it('a revocation that lands after the gate moved the task to `queued` wins the CAS; the claim then changes nothing', async () => {
    await inRollback(async () => {
      const t = await handedOff();
      expect(await tenantApprove(ORG_A, t.taskId, t.approver)).toMatchObject({ ok: true });
      await toQueued(t.taskId);
      expect(await revokeOutreachApproval(ORG_A, t.taskId, { approverUserId: t.approver })).toMatchObject({ ok: true, status: 'cancelled' });
      expect(await storage.transitionOutreachTaskState(ORG_A, t.taskId, 'queued', 'dispatching')).toMatchObject({ ok: true, changed: false });
    });
  });

  it('content edited between the gate and the render: the provider is never called (S-03)', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      const original = storage.appendAttempt;
      const spy = jest.spyOn(storage, 'appendAttempt').mockImplementation(async (...a: unknown[]) => {
        const r = await original(...a);
        // Lands after the gate and the claim, before the transport renders.
        await db.query(`UPDATE public.unified_persons SET first_name = 'Raced' WHERE id = (SELECT person_id FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1)`, [s.taskId]);
        return r;
      });
      try {
        const r = await activate(s.prospectId, s.taskId);
        expect(r.outcome).toBe('rejected');
        expect(String(r.reason)).toMatch(/differs from what was approved/);
      } finally {
        spy.mockRestore();
      }
      expect(sentAll()).toHaveLength(0);
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      // The next run refuses at the gate and sends the task back for a fresh approval.
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'blocked_governance' });
      expect(await status(s.taskId)).toBe('awaiting_approval');
      expect(sentAll()).toHaveLength(0);
    });
  });

  it('a send to an address the approval does not bind is refused with no attempt (S-04)', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      const r = await ws3.dispatchInternalOutreachTask(ORG_A, s.taskId, { recipient: 'attacker@evil.example' });
      expect(r).toMatchObject({ outcome: 'blocked_governance', status: 'approved' });
      expect(r.governance.blockingCondition).toBe('eligibility.approval_recipient_mismatch');
      expect(await countOf('outreach_attempts', s.taskId)).toBe(0);
      expect(sentAll()).toHaveLength(0);
    });
  });

  it('a service-level approval of an email task without the passkey proof is refused and writes nothing (S-02)', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await ws3.approveOutreachTask(ORG_A, s.taskId, { approverUserId: s.approver })).toMatchObject({ ok: false, refusal: 'passkey_required' });
      expect(await rows('SELECT 1 FROM public.outreach_approvals WHERE task_id = $1', [s.taskId])).toHaveLength(0);
      expect(await status(s.taskId)).toBe('awaiting_approval');
      // The recorded tenant approval carries the credential that was verified.
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      const row = await one('SELECT passkey_credential_id, passkey_verified_at FROM public.outreach_approvals WHERE task_id = $1', [s.taskId]);
      expect(row.passkey_credential_id).toBe(`cred-${s.approver}`);
      expect(row.passkey_verified_at).not.toBeNull();
    });
  });
});

// ── r3 (D02-SECURITY-REVIEW-r3) Low findings, in the database ────────────────

describe('D-02 r3 — passkey freshness, channel freeze and the stored recipient', () => {
  const claim = (taskId: string) => attempt(`UPDATE public.outreach_tasks SET status = 'dispatching' WHERE id = $1 AND status = 'queued'`, [taskId]);
  const toQueued = (taskId: string) => db.query(`UPDATE public.outreach_tasks SET status = 'queued' WHERE id = $1`, [taskId]);
  const rawApproval = (s: { taskId: string; approver: string }, verifiedAt: string) => db.query(
    `INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, approved_content_hash, passkey_credential_id, passkey_verified_at)
     VALUES ($1, $2, 'approved', $3, $4, $5, $6)`, [ORG_A, s.taskId, s.approver, 'a'.repeat(64), `cred-${s.approver}`, verifiedAt]);

  it('L-2 / T-d: an approved or queued email task cannot be relabelled internal, so it cannot escape the claim check', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      // In review the channel may still change; the change is then part of what gets approved.
      expect(await attempt(`UPDATE public.outreach_tasks SET channel = 'internal' WHERE id = $1`, [s.taskId])).toBe('ok');
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      expect(await attempt(`UPDATE public.outreach_tasks SET channel = 'internal' WHERE id = $1`, [s.taskId])).toBe('23514');
      await toQueued(s.taskId);
      expect(await attempt(`UPDATE public.outreach_tasks SET channel = 'internal' WHERE id = $1`, [s.taskId])).toBe('23514');
      // The reviewer's sequence: separate channel flip, then claim — the flip is refused, the row stays email.
      expect(String((await one('SELECT channel FROM public.outreach_tasks WHERE id = $1', [s.taskId])).channel)).toBe('email');
    });
  });

  it('L-1 / T-g: a verification 3 days before the decision cannot be claimed', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      await rawApproval(s, new Date(Date.now() - 3 * DAY).toISOString());
      await toQueued(s.taskId);
      expect(await claim(s.taskId)).toBe('23514');
    });
  });

  it('L-1: a verification recorded after the decision cannot be claimed; one just before it can', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      await rawApproval(s, new Date(Date.now() + 10 * 60_000).toISOString());
      await toQueued(s.taskId);
      expect(await claim(s.taskId)).toBe('23514');
      await rawApproval(s, new Date(Date.now() - 60_000).toISOString());
      expect(await claim(s.taskId)).toBe('ok');
    });
  });

  it('L-3 / L-4: a non-journey email approval stores its address; a wrong one refuses and the task stays approved', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email', 'internal']);
      const approver = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
      const ins = await ws3.insertOutreachTask({
        companyId: ORG_A, leadId: prospectId, personId: null, planTaskId: `nj-${Date.now()}`, taskOrder: 1,
        kind: 'outreach', action: 'Hello', channel: 'email', dependsOnPlanTaskId: null, estimatedDelayHours: 0,
        confidence: null, explanation: null, requiresApproval: true,
        plannerVersion: 'lie-2.1.0', translationVersion: ws3.TRANSLATION_VERSION,
        governanceVersion: ws3.GOVERNANCE_VERSION, executionRuntimeVersion: ws3.EXECUTION_RUNTIME_VERSION,
        materializedAt: new Date().toISOString(),
      });
      const taskId = String(ins.data.id);
      await db.query(`INSERT INTO public.webauthn_credentials (user_id, credential_id, public_key) VALUES ($1, $2, '\\x00')`, [approver, `cred-${approver}`]);
      expect((await ws3.submitForApproval(ORG_A, taskId)).ok).toBe(true);
      const task = await ws3.getOutreachTaskById(ORG_A, taskId);
      const binding = await approvalBinding.computeApprovalBinding(ORG_A, task, { recipient: ADDRESS });
      const ceremony = { userId: approver, organizationId: ORG_A, taskId, action: 'approve', bindingHash: binding.hash };
      const opts = await approvalPasskey.beginApprovalPasskey(ceremony);
      const v = await approvalPasskey.verifyApprovalPasskey(ceremony, assertion(approver, String(opts.challenge)));
      expect((await ws3.approveOutreachTask(ORG_A, taskId, { approverUserId: approver, recipient: ADDRESS, passkeyProof: v.proof })).ok).toBe(true);
      expect((await one('SELECT approved_recipient FROM public.outreach_approvals WHERE task_id = $1', [taskId])).approved_recipient).toBe(ADDRESS);
      ws3.__clearTransportsForTests();
      ws3.registerDefaultTransports({ emailProvider: provider });
      const wrong = await ws3.dispatchInternalOutreachTask(ORG_A, taskId, { recipient: 'attacker@evil.example' });
      expect(wrong.governance.blockingCondition).toBe('eligibility.approval_recipient_mismatch');
      expect(await status(taskId)).toBe('approved');
      expect(await ws3.requestFreshApproval(ORG_A, taskId)).toMatchObject({ ok: false, status: 'approved' });
      expect(await ws3.dispatchInternalOutreachTask(ORG_A, taskId, { recipient: ADDRESS })).toMatchObject({ outcome: 'sent' });
      expect(sentAll()).toEqual([ADDRESS]);
      // Only on an approval.
      expect(await attempt(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, approved_recipient)
        VALUES ($1, $2, 'revoked', $3, 'x@y.z')`, [ORG_A, taskId, approver])).toBe('23514');
    });
  });
});

// ── Outreach review of 9bbbacd2: F-1, a prior attempt that may have sent ─────

describe('D-02 F-1 — re-review never reopens a task whose earlier attempt may have sent (real PostgreSQL)', () => {
  /** What a provider timeout leaves: one attempt, its evidence, the task back in `queued`. */
  async function timedOut(s: { taskId: string }) {
    const { rows: [a] } = await db.query(
      `INSERT INTO public.outreach_attempts (company_id, task_id, attempt_number, channel, transport, started_at)
       VALUES ($1, $2, 1, 'email', 'supabase_edge_ses', now()) RETURNING id`, [ORG_A, s.taskId]);
    await db.query(
      `INSERT INTO public.outreach_delivery_evidence (company_id, task_id, attempt_id, delivery_status, transport_response, observed_at)
       VALUES ($1, $2, $3, 'failed', '{"outcome":"timeout"}'::jsonb, now())`, [ORG_A, s.taskId, a.id]);
    await db.query(`UPDATE public.outreach_tasks SET status = 'queued' WHERE id = $1`, [s.taskId]);
  }

  it('a stale refusal keeps it queued, the resubmit is refused, and a forced fresh approval is still blocked_prior_attempt', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      await timedOut(s);
      // Control (G-1): unchanged, it is refused as a possible duplicate.
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'blocked_prior_attempt' });
      // The content changes: stale, but NOT back to review (fix b).
      await db.query(`UPDATE public.unified_persons SET first_name = 'Renamed' WHERE id = (SELECT person_id FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1)`, [s.taskId]);
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'blocked_governance' });
      expect(await status(s.taskId)).toBe('queued');
      expect(await ws3.requestFreshApproval(ORG_A, s.taskId)).toMatchObject({ ok: false, status: 'queued' });
      // Even if it reaches review and a fresh approval some other way, dispatch refuses (fix a).
      await db.query(`UPDATE public.outreach_tasks SET status = 'awaiting_approval' WHERE id = $1`, [s.taskId]);
      expect(await tenantApprove(ORG_A, s.taskId, s.approver)).toMatchObject({ ok: true });
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'blocked_prior_attempt' });
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(sentAll()).toHaveLength(0);
    });
  });
});
