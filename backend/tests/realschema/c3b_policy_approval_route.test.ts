/**
 * Prompt 3 / Agent B — tenant policy, two-person override and the passkey approve route,
 * on real PostgreSQL (template w3_c3: 20270126000000..03).
 *
 * Real: community_ai_platform_policy + its two-person trigger, community_execution_policy_decision,
 * community_ai_actions + the server-stamp / evidence functions, community_ai_action_logs,
 * claim_community_ai_action_for_execution. Stubbed: the WebAuthn ceremony store (the
 * challenge bytes and the D-02 binding check are real), capability gate, rate limits,
 * telemetry. Throwaway DB only; every case runs inside a rollback.
 *
 * The harness translator renders rpc() as `SELECT fn(...)`, which yields one composite
 * for a RETURNS TABLE function; PostgREST returns rows. rpc() here is therefore
 * `SELECT * FROM fn(...)` (rows), as PostgREST does.
 */

jest.mock('../../db/supabaseClient', () => {
  const base = require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'c3b');
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { db } = require('./setup');
    const keys = Object.keys(args);
    const params = keys.map((k) => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    await db.query('SAVEPOINT c3b_rpc');
    try {
      const r = await db.query(`SELECT * FROM public."${fn}"(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, params);
      await db.query('RELEASE SAVEPOINT c3b_rpc');
      const rows = r.rows.map((row: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
        return out;
      });
      return { data: rows, error: null };
    } catch (e: any) {
      await db.query('ROLLBACK TO SAVEPOINT c3b_rpc');
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };
  return { ...base, supabase: { ...base.supabase, rpc } };
});
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => require('../../db/supabaseClient').supabase.from(table),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => require('../../db/supabaseClient').supabase.rpc(fn, args),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
let mockOperator = '';
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async () => ({ ok: true, principal: { userId: mockOperator, email: 'op@example.test' } }),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: null }) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => false }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
jest.mock('../../../lib/security/clientIp', () => ({ getTrustedClientIpOrNull: () => null }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIpOrNull: () => null }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
let mockApprover = '';
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: async (req: any) => ({ tenantId: req.body.tenant_id, organizationId: req.body.organization_id }),
  enforceActionRole: async () => ({ userId: mockApprover, role: 'COMPANY_ADMIN' }),
}));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({ COMMUNITY_AI_CAPABILITIES: { APPROVE_ACTIONS: ['COMPANY_ADMIN'] } }));
const mockChallenges = new Map<string, { userId: string | null; consumed: boolean }>();
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => ({
  beginAuthentication: async (input: { userId: string | null; challenge?: Uint8Array }) => {
    const challenge = Buffer.from(input.challenge as Uint8Array).toString('base64url');
    mockChallenges.set(challenge, { userId: input.userId, consumed: false });
    return { options: { challenge, rpId: 'test' } };
  },
  verifyAuthentication: async (input: { userId: string; response: { response: { clientDataJSON: string } } }) => {
    const challenge = JSON.parse(Buffer.from(input.response.response.clientDataJSON, 'base64url').toString('utf8')).challenge;
    const stored = mockChallenges.get(challenge);
    if (!stored || stored.consumed) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'ALREADY_CONSUMED' };
    if (stored.userId !== input.userId) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'WRONG_USER_BINDING' };
    stored.consumed = true;
    return { ok: true, result: { userId: input.userId, credentialId: 'cred-c3b', verifiedAt: new Date() } };
  },
}));

import { db, inRollback } from './setup';

/* eslint-disable @typescript-eslint/no-var-requires */
const policySvc = require('../../services/communityAiPlatformPolicyService');
const policyRoute = require('../../../pages/api/super-admin/community-ai-policy').default;
const approveRoute = require('../../../pages/api/community-ai/actions/approve').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error('c3b_policy_approval_route refuses a non-loopback W6_DB_URL');
}

/** Synthetic identities for a disposable DB. Never production identifiers. */
const ORG = '0c3b0000-0000-4000-8000-0000000000c3';
const OP_A = '0c3b0000-0000-4000-8000-0000000000a1';
const OP_B = '0c3b0000-0000-4000-8000-0000000000a2';
const APPROVER = '0c3b0000-0000-4000-8000-0000000000a3';
const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

const mockRes = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
};
const policyPost = async (operator: string, body: Record<string, unknown>) => {
  mockOperator = operator;
  const res = mockRes();
  await policyRoute({ method: 'POST', body, headers: {}, query: {} }, res);
  return res;
};
const approvePost = async (body: Record<string, unknown>) => {
  const res = mockRes();
  await approveRoute({ method: 'POST', body: { tenant_id: ORG, organization_id: ORG, ...body }, headers: {}, query: {} }, res);
  return res;
};
const assertion = (challenge: string) => ({
  id: 'cred-c3b', rawId: 'cred-c3b', type: 'public-key',
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge })).toString('base64url'), signature: 'valid', authenticatorData: 'x' },
  clientExtensionResults: {},
});
const decision = async () => {
  policySvc.__resetCommunityAiPlatformPolicyCacheForTests();
  return policySvc.getCommunityExecutionPolicy({ organizationId: ORG, tenantId: ORG });
};

async function seedIdentities() {
  await q(`INSERT INTO public.companies (id, name) VALUES ($1, 'C3B tenant') ON CONFLICT (id) DO NOTHING`, [ORG]);
  for (const [id, email] of [[OP_A, 'c3b-a@example.test'], [OP_B, 'c3b-b@example.test'], [APPROVER, 'c3b-approver@example.test']]) {
    await q(`INSERT INTO public.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, email]);
  }
  await q(`DELETE FROM public.community_ai_platform_policy`);
}

/** Open one row (platform when org is null) by request + an independent confirmation. */
async function openRow(org: string | null) {
  const scope = org ? { organization_id: org } : {};
  const req = await policyPost(OP_A, { ...scope, execution_enabled: true });
  expect(req.statusCode).toBe(202);
  const conf = await policyPost(OP_B, { ...scope, action: 'confirm', request_id: req.body.request_id });
  expect(conf.statusCode).toBe(200);
}

/** A tenant executes only when BOTH the platform row and its own row are open. */
async function enableTenant() {
  await openRow(null);
  await openRow(ORG);
}

beforeEach(() => {
  mockChallenges.clear();
  policySvc.__resetCommunityAiPlatformPolicyCacheForTests();
  mockApprover = APPROVER;
});

describe('tenant policy + two-person override (real trigger, real decision function)', () => {
  it('no tenant row: POLICY_MISSING; a request alone loosens nothing; a second operator opens it', async () => {
    await inRollback(async () => {
      await seedIdentities();
      expect(await decision()).toEqual({ ok: false, code: 'POLICY_MISSING' });
      // The platform row alone opens nothing for a tenant without its own row.
      await openRow(null);
      expect(await decision()).toEqual({ ok: false, code: 'POLICY_MISSING' });

      const req = await policyPost(OP_A, { organization_id: ORG, execution_enabled: true });
      expect(req.statusCode).toBe(202);
      const row = (await q(`SELECT * FROM public.community_ai_platform_policy WHERE organization_id=$1`, [ORG])).rows[0];
      expect(row).toMatchObject({ execution_enabled: false, auto_rules_enabled: false, requested_by: OP_A, requested_execution_enabled: true, tenant_id: ORG });
      expect(row.requested_at).not.toBeNull();
      expect(await decision()).toEqual({ ok: false, code: 'POLICY_EXECUTION_DISABLED' });

      const self = await policyPost(OP_A, { organization_id: ORG, action: 'confirm', request_id: req.body.request_id });
      expect(self.statusCode).toBe(403);
      expect(await decision()).toEqual({ ok: false, code: 'POLICY_EXECUTION_DISABLED' });

      const conf = await policyPost(OP_B, { organization_id: ORG, action: 'confirm', request_id: req.body.request_id });
      expect(conf.statusCode).toBe(200);
      const after = (await q(`SELECT * FROM public.community_ai_platform_policy WHERE organization_id=$1`, [ORG])).rows[0];
      expect(after).toMatchObject({ execution_enabled: true, updated_by: OP_B, requested_by: null, requested_at: null });
      expect(await decision()).toMatchObject({ ok: true, policy: { execution_enabled: true, auto_rules_enabled: false } });
    });
  });

  it('the route\'s confirmation is what the trigger accepts: a self-confirm written directly is refused by the DB', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await policyPost(OP_A, { organization_id: ORG, execution_enabled: true });
      await q('SAVEPOINT s');
      let code = 'ok';
      try {
        await q(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, updated_by = $2 WHERE organization_id = $1`, [ORG, OP_A]);
      } catch (e: any) { code = e.code; }
      await q('ROLLBACK TO SAVEPOINT s');
      expect(code).toBe('23514');
    });
  });

  it('tightening is single-operator; the platform kill switch refuses every tenant', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await enableTenant();
      expect((await decision()).ok).toBe(true);
      // Platform kill switch, one operator, immediate.
      const kill = await policyPost(OP_A, { execution_enabled: false });
      expect(kill.statusCode).toBe(200);
      expect(await decision()).toEqual({ ok: false, code: 'PLATFORM_KILL_SWITCH' });
      // Re-opening the platform is a loosening: two operators again.
      expect((await policyPost(OP_A, { execution_enabled: true })).statusCode).toBe(202);
      expect(await decision()).toEqual({ ok: false, code: 'PLATFORM_KILL_SWITCH' });
      const pending = (await q(`SELECT requested_at FROM public.community_ai_platform_policy WHERE organization_id IS NULL`)).rows[0];
      expect((await policyPost(OP_B, { action: 'confirm', request_id: pending.requested_at.toISOString() })).statusCode).toBe(200);
      expect((await decision()).ok).toBe(true);
      // Tenant disable, one operator, immediate.
      expect((await policyPost(OP_B, { organization_id: ORG, execution_enabled: false })).statusCode).toBe(200);
      expect(await decision()).toEqual({ ok: false, code: 'POLICY_EXECUTION_DISABLED' });
    });
  });

  it('another tenant\'s row never answers for this tenant', async () => {
    await inRollback(async () => {
      await seedIdentities();
      const other = '0c3b0000-0000-4000-8000-0000000000c9';
      await q(`INSERT INTO public.companies (id, name) VALUES ($1, 'C3B other') ON CONFLICT (id) DO NOTHING`, [other]);
      await openRow(null);
      await openRow(other);
      expect(await decision()).toEqual({ ok: false, code: 'POLICY_MISSING' });
      expect((await policySvc.getCommunityExecutionPolicy({ organizationId: other, tenantId: other })).ok).toBe(true);
    });
  });

  it('F2: a request made before a kill switch can never re-open it (route + trigger)', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await enableTenant();
      const OP_C = '0c3b0000-0000-4000-8000-0000000000a4';
      await q(`INSERT INTO public.users (id, email) VALUES ($1, 'c3b-c@example.test') ON CONFLICT (id) DO NOTHING`, [OP_C]);
      // A requests auto rules on the (open) platform row; the base is recorded.
      const req = await policyPost(OP_A, { auto_rules_enabled: true });
      expect(req.statusCode).toBe(202);
      const pending = (await q(`SELECT * FROM public.community_ai_platform_policy WHERE organization_id IS NULL`)).rows[0];
      expect(pending).toMatchObject({ requested_by: OP_A, requested_base_execution_enabled: true, requested_base_auto_rules_enabled: false });
      // C throws the kill switch: the pending request is cleared (all six columns).
      expect((await policyPost(OP_C, { execution_enabled: false })).statusCode).toBe(200);
      const after = (await q(`SELECT * FROM public.community_ai_platform_policy WHERE organization_id IS NULL`)).rows[0];
      expect(after).toMatchObject({
        execution_enabled: false, requested_by: null, requested_at: null,
        requested_execution_enabled: null, requested_auto_rules_enabled: null,
        requested_base_execution_enabled: null, requested_base_auto_rules_enabled: null,
      });
      // B's confirmation of the old request is refused; the kill switch holds.
      expect((await policyPost(OP_B, { action: 'confirm', request_id: req.body.request_id })).statusCode).toBe(409);
      expect(await decision()).toEqual({ ok: false, code: 'PLATFORM_KILL_SWITCH' });
    });
  });

  it('a request that asks for nothing is a withdrawal (trigger) and the route does not offer it for confirmation', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await enableTenant();
      await q(`UPDATE public.community_ai_platform_policy SET requested_by = $1 WHERE organization_id = $2`, [OP_A, ORG]);
      const row = (await q(`SELECT requested_by, requested_at FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG])).rows[0];
      expect(row).toMatchObject({ requested_by: null, requested_at: null });
      // Nothing pending, so a confirmation finds no request (the GET view is unit-tested;
      // its read guard is not stubbed in this suite).
      const conf = await policyPost(OP_B, { organization_id: ORG, action: 'confirm', request_id: new Date().toISOString() });
      expect(conf.statusCode).toBe(409);
      expect(conf.body.error).toBe('NO_MATCHING_OVERRIDE_REQUEST');
    });
  });
});

describe('approve route: passkey evidence, server approved_at, real claim', () => {
  async function seedAction(over: Record<string, unknown> = {}): Promise<string> {
    const r = await q(
      `INSERT INTO public.community_ai_actions
         (tenant_id, organization_id, platform, action_type, target_id, suggested_text, risk_level,
          requires_human_approval, status, execution_mode)
       VALUES ($1, $1, 'linkedin', 'like', 'urn:li:share:c3b', NULL, 'low', $2, 'pending', 'api')
       RETURNING id`,
      [ORG, over.requires_human_approval ?? true],
    );
    return r.rows[0].id;
  }
  const claim = async (id: string) =>
    (await q(`SELECT * FROM public.claim_community_ai_action_for_execution($1, $2, $2, 'manual', 'api', 'c3b-corr')`, [id, ORG])).rows[0];

  it('begin → approve: one UPDATE with all evidence, approved_at is the DB clock, the log matches, the claim succeeds', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await enableTenant();
      const id = await seedAction();
      const begin = await approvePost({ action_id: id, phase: 'begin' });
      expect(begin.statusCode).toBe(200);
      const before = Date.now();
      const res = await approvePost({ action_id: id, passkey: assertion(String(begin.body.passkey_options.challenge)), expected_content_hash: begin.body.content_hash });
      expect(res.statusCode).toBe(200);

      const row = (await q(`SELECT * FROM public.community_ai_actions WHERE id=$1`, [id])).rows[0];
      expect(row).toMatchObject({ status: 'approved', approved_by: APPROVER, approved_content_hash: begin.body.content_hash, passkey_credential_id: 'cred-c3b' });
      const trunc = (await q(`SELECT approved_at = date_trunc('milliseconds', approved_at) AS ms FROM public.community_ai_actions WHERE id=$1`, [id])).rows[0];
      expect(trunc.ms).toBe(true);
      expect(Math.abs(row.approved_at.getTime() - before)).toBeLessThan(60_000);
      const evidence = (await q(`SELECT public.community_action_approval_evidence_code(a, clock_timestamp()) AS code FROM public.community_ai_actions a WHERE a.id=$1`, [id])).rows[0];
      expect(evidence.code).toBeNull();
      const log = (await q(`SELECT event_payload FROM public.community_ai_action_logs WHERE action_id=$1 AND event_type='approved'`, [id])).rows;
      expect(log).toHaveLength(1);
      expect(log[0].event_payload.timestamp).toBe(row.approved_at.toISOString());

      expect(await claim(id)).toMatchObject({ claimed: true });
    });
  });

  it('no passkey: 401, nothing written, the claim refuses', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await enableTenant();
      const id = await seedAction();
      expect((await approvePost({ action_id: id })).statusCode).toBe(401);
      const row = (await q(`SELECT status, approved_at FROM public.community_ai_actions WHERE id=$1`, [id])).rows[0];
      expect(row).toMatchObject({ status: 'pending', approved_at: null });
    });
  });

  it('LD-8: requires_human_approval=false is approvable; a legacy approval without evidence is re-approvable', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await enableTenant();
      const id = await seedAction({ requires_human_approval: false });
      // Legacy shape: approved with approver and time, but no evidence (pre-Prompt-3 rows).
      await q(`UPDATE public.community_ai_actions SET status='approved', approved_at = clock_timestamp() - interval '1 day', approved_by=$2 WHERE id=$1`, [id, OP_A]);
      expect((await claim(id)).claimed).toBe(false);
      const begin = await approvePost({ action_id: id, phase: 'begin' });
      expect(begin.statusCode).toBe(200);
      const res = await approvePost({ action_id: id, passkey: assertion(String(begin.body.passkey_options.challenge)) });
      expect(res.statusCode).toBe(200);
      expect(await claim(id)).toMatchObject({ claimed: true });
    });
  });

  it('a current evidenced approval is idempotent and its evidence is never rewritten', async () => {
    await inRollback(async () => {
      await seedIdentities();
      await enableTenant();
      const id = await seedAction();
      const begin = await approvePost({ action_id: id, phase: 'begin' });
      await approvePost({ action_id: id, passkey: assertion(String(begin.body.passkey_options.challenge)) });
      const first = (await q(`SELECT approved_at, passkey_credential_id FROM public.community_ai_actions WHERE id=$1`, [id])).rows[0];
      mockApprover = OP_B;
      const again = await approvePost({ action_id: id });
      expect(again.statusCode).toBe(200);
      expect(again.body.idempotent).toBe(true);
      const second = (await q(`SELECT approved_at, approved_by FROM public.community_ai_actions WHERE id=$1`, [id])).rows[0];
      expect(second.approved_at.getTime()).toBe(first.approved_at.getTime());
      expect(second.approved_by).toBe(APPROVER);
    });
  });
});
