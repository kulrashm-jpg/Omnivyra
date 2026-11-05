/**
 * Prompt 3 / Agent C — the execution routes over the REAL claim, on real PostgreSQL
 * (template w3_c3: 20270126000000..03).
 *
 * Real: POST /api/community-ai/actions/execute, runCommunityAiScheduler,
 * GET /api/extension/commands, the tenant policy decision, the approval evidence and
 * server-stamp functions, claim_community_ai_action_for_execution,
 * claim_community_ai_browser_command, record_community_execution_refusal, the
 * executor (runExecution) and its persist. Stubbed: the platform connector (a spy),
 * the L-3 recipient lookup (allowed; proven in communityL3* and egress suites),
 * usage metering, notifications/webhooks, auth/role gates, telemetry.
 * Every case runs inside a rollback.
 *
 *   manual execute: 200 once; kill switch → 423 and expired → 403 APPROVAL_EXPIRED,
 *     each leaving the row 'approved' with exactly ONE refusal record (also when
 *     retried); executing → 409 ACTION_IN_PROGRESS; leased → 409 ACTION_DISPATCHED;
 *     an unleased queued browser row → 202 with a live extension session, 503
 *     without one (never 409); concurrent executes → one 200, the other 409, one send.
 *   scheduler: executes an approved row once; the kill switch leaves it 'approved'
 *     with one refusal; an approved row without approved_at is never loaded.
 *   extension commands: an approved browser row is claimed under a lease; the kill
 *     switch and an expired approval hand out nothing and leave the row unclaimed.
 */
import { db, inRollback, ORG_A, seedTenants } from './setup';
import { randomUUID } from 'crypto';
import { openTenant, openPolicy, approvedAction, refusalsOf, statusOf, ensureUser, bindingHashOf, C3_APPROVER } from './helpers/c3ClaimFixtures';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: async (req: any) => ({ tenantId: req.body.tenant_id, organizationId: req.body.organization_id }),
  enforceActionRole: async () => ({ userId: '00000000-0000-4000-8000-0000000000c3', role: 'COMPANY_ADMIN' }),
}));
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: async () => ({ allowed: true }) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: async () => undefined }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: async () => undefined }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: async () => undefined }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: async () => undefined }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../services/platformTokenService', () => ({ getToken: async () => ({ access_token: 'tok' }) }));
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: async () => ({ id: 'pb' }) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: () => ({ allowed: true }) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: async () => ({ allowed: true }) }));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn(), rpaResultMayHaveActed: () => true }));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({ executeAction: (...a: any[]) => mockConnector(...a) }));
// Extension route plumbing (auth, capability map, schema): not under test.
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => ({ session: { userId: '00000000-0000-4000-8000-0000000000c3', orgId: '00000000-0000-4000-8000-00000000000a', hmacNonce: 'nonce' } }),
}));
jest.mock('@/backend/services/engagementCapabilityMap', () => ({
  CAPABILITY_MAP_VERSION: 'cap-test', resolveEngagementCapability: () => ({ status: 'api_verified' }),
}));
jest.mock('@/backend/services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false }));
jest.mock('@/backend/services/extensionCommandSchema', () => ({
  COMMAND_SCHEMA_VERSION: 'schema-test', validateCommandPayload: (_p: string, _a: string, payload: any) => ({ ok: true, payload }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const executeRoute = require('../../../pages/api/community-ai/actions/execute').default;
const commandsRoute = require('../../../pages/api/extension/commands').default;
const { runCommunityAiScheduler } = require('../../services/communityAiScheduler');
const policyService = require('../../services/communityAiPlatformPolicyService');
const { __resetCommunityAiPlatformPolicyCacheForTests } = policyService;

/**
 * The policy becomes unreadable AFTER the caller's pre-check and the claim: the
 * caller's own read (call 1) is real, the executor's gate (call 2) is unreadable.
 * A post-claim, pre-dispatch refusal: nothing acted, so the claim must be given
 * back (F1) by the attempt's correlation id, never left 'executing'.
 */
const unreadableAfterClaim = () => {
  const real = jest.requireActual('../../services/communityAiPlatformPolicyService').getCommunityExecutionPolicy;
  let calls = 0;
  return jest.spyOn(policyService, 'getCommunityExecutionPolicy').mockImplementation(async (...a: any[]) => {
    calls += 1;
    return calls === 1 ? real(...a) : { ok: false, code: 'POLICY_UNREADABLE' };
  });
};
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error('c3c_execution_routes refuses a non-loopback W6_DB_URL');
}

const call = async (route: any, req: Record<string, any>) => {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await route({ headers: {}, query: {}, ...req }, res);
  return res as { statusCode: number; body: any };
};
const execute = (id: string) => call(executeRoute, {
  method: 'POST', body: { tenant_id: ORG_A, organization_id: ORG_A, action_id: id, approved: true },
});
const poll = () => call(commandsRoute, { method: 'GET', headers: { 'x-omnivyra-capability-version': 'cap-test' } });
const killSwitch = () => db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id IS NULL`);
const liveSession = () => db.query(
  `INSERT INTO public.extension_sessions (user_id, org_id, session_token, last_seen, expires_at)
   VALUES ($1, $2, 'c3c-session', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC') + interval '1 day')`, [C3_APPROVER, ORG_A]);

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  __resetCommunityAiPlatformPolicyCacheForTests();
  mockConnector.mockReset();
  mockConnector.mockResolvedValue({ success: true, platform_id: 'urn:li:comment:c3c' });
});

const setup = async () => {
  await seedTenants();
  await ensureUser(db, C3_APPROVER);
  await openTenant(db, ORG_A);
};

describe('manual execute over the real claim', () => {
  it('approved + open policy: 200, executed once', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A });
      const r = await execute(id);
      expect(r.statusCode).toBe(200);
      expect(await statusOf(db, id)).toBe('executed');
      expect(mockConnector).toHaveBeenCalledTimes(1);
      expect(await refusalsOf(db, id)).toEqual([]);
    });
  });

  it('kill switch: 423, row stays approved, exactly one refusal record (also when retried)', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A });
      await killSwitch();
      __resetCommunityAiPlatformPolicyCacheForTests();
      const r1 = await execute(id);
      const r2 = await execute(id);
      expect([r1.statusCode, r1.body.error, r1.body.code]).toEqual([423, 'COMMUNITY_EXECUTION_DISABLED', 'PLATFORM_KILL_SWITCH']);
      expect(r2.statusCode).toBe(423);
      expect(await statusOf(db, id)).toBe('approved');
      expect(await refusalsOf(db, id)).toEqual([expect.objectContaining({ code: 'PLATFORM_KILL_SWITCH', claim_point: 'manual' })]);
      expect(mockConnector).not.toHaveBeenCalled();
    });
  });

  it('an approval older than 7 days: 403 APPROVAL_EXPIRED, row stays approved, one refusal record', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A, ageMs: 8 * 24 * 3600_000 });
      const r1 = await execute(id);
      await execute(id);
      expect([r1.statusCode, r1.body.error]).toEqual([403, 'APPROVAL_EXPIRED']);
      expect(await statusOf(db, id)).toBe('approved');
      expect(await refusalsOf(db, id)).toEqual([expect.objectContaining({ code: 'APPROVAL_EXPIRED', claim_point: 'manual' })]);
      expect(mockConnector).not.toHaveBeenCalled();
    });
  });

  it('F1: one correlation id per attempt — a post-claim pre-dispatch refusal gives the claim back (approved, re-claimable)', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A });
      unreadableAfterClaim();
      const r = await execute(id);
      expect([r.statusCode, r.body.error, r.body.code]).toEqual([423, 'COMMUNITY_EXECUTION_DISABLED', 'POLICY_UNREADABLE']);
      expect(await statusOf(db, id)).toBe('approved');
      expect(mockConnector).not.toHaveBeenCalled();
      jest.restoreAllMocks();
      __resetCommunityAiPlatformPolicyCacheForTests();
      const again = await execute(id);
      expect(again.statusCode).toBe(200);
      expect(await statusOf(db, id)).toBe('executed');
      expect(mockConnector).toHaveBeenCalledTimes(1);
    });
  });

  it('executing: 409 ACTION_IN_PROGRESS', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A });
      await db.query(`SELECT * FROM public.claim_community_ai_action_for_execution($1, $2, $2, 'scheduler', NULL, NULL)`, [id, ORG_A]);
      const r = await execute(id);
      expect([r.statusCode, r.body.error]).toEqual([409, 'ACTION_IN_PROGRESS']);
      expect(mockConnector).not.toHaveBeenCalled();
    });
  });

  it('browser rows: unleased + live extension → 202; no live session → 503; leased → 409 ACTION_DISPATCHED', async () => {
    await inRollback(async () => {
      await setup();
      const queued = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser' });
      const noSession = await execute(queued.id);
      expect([noSession.statusCode, noSession.body.error]).toEqual([503, 'EXTENSION_NOT_READY']);
      await liveSession();
      const awaiting = await execute(queued.id);
      expect([awaiting.statusCode, awaiting.body.code]).toEqual([202, 'AWAITING_EXTENSION']);
      expect(await db.query(`SELECT * FROM public.claim_community_ai_browser_command($1, $2, 'lease-c3c', 'holder-1', 60)`, [queued.id, ORG_A])
        .then((q) => q.rows.length)).toBe(1);
      const leased = await execute(queued.id);
      expect([leased.statusCode, leased.body.error]).toEqual([409, 'ACTION_DISPATCHED']);
      expect(await statusOf(db, queued.id)).toBe('pending');
      expect(mockConnector).not.toHaveBeenCalled();
    });
  });

  it('two concurrent executes: one 200, the other a 409 conflict; one send', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A });
      const [a, b] = await Promise.all([execute(id), execute(id)]);
      const codes = [a.statusCode, b.statusCode].sort();
      expect(codes).toEqual([200, 409]);
      const loser = a.statusCode === 409 ? a : b;
      expect(['ACTION_CLAIM_CONFLICT', 'ACTION_IN_PROGRESS']).toContain(loser.body.error);
      expect(mockConnector).toHaveBeenCalledTimes(1);
      expect(await statusOf(db, id)).toBe('executed');
    });
  });
});

describe('scheduler over the real claim', () => {
  /**
   * A due, human-approved, scheduled action WITH a playbook (the scheduler requires
   * one). approvedAction() binds no playbook, so this inserts the same evidence
   * shape itself: approver, the approve route's 'approved' log, the real binding
   * hash over the stored content (playbook included), passkey within the window.
   * approved_at is the server stamp. scheduled_at is timestamp WITHOUT time zone,
   * compared with the scheduler's UTC cutoff: the UTC wall-clock time is stored.
   */
  const approvedScheduled = async (): Promise<string> => {
    const pb = randomUUID();
    await db.query(
      `INSERT INTO public.community_ai_playbooks (id, tenant_id, organization_id, name, status) VALUES ($1, $2, $2, 'c3c', 'active')`, [pb, ORG_A]);
    const id = randomUUID();
    const target = `https://www.linkedin.com/feed/update/urn:li:activity:c3c-${id}/`;
    const hash = bindingHashOf({ id, tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin', action_type: 'reply',
      target_id: target, suggested_text: 'Thanks for sharing', playbook_id: pb });
    const { rows } = await db.query(
      `WITH t AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS at)
       INSERT INTO public.community_ai_actions
         (id, tenant_id, organization_id, platform, action_type, target_id, suggested_text, playbook_id, status, execution_mode,
          requires_human_approval, risk_level, approved_at, approved_by, approved_content_hash,
          passkey_credential_id, passkey_verified_at, scheduled_at)
       SELECT $1, $2, $2, 'linkedin', 'reply', $3, 'Thanks for sharing', $4, 'approved', 'api', true, 'low', t.at, $5, $6,
              'cred-c3c', t.at - interval '30 seconds', (now() AT TIME ZONE 'UTC') - interval '1 minute'
         FROM t
       RETURNING to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`,
      [id, ORG_A, target, pb, C3_APPROVER, hash]);
    await db.query(
      `INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
       VALUES ($1, $2, $2, 'approved', $3::jsonb)`,
      [id, ORG_A, JSON.stringify({ approved: true, playbook_id: pb, intent: null, user_id: C3_APPROVER, timestamp: rows[0].at })]);
    return id;
  };

  it('executes a due, approved row exactly once', async () => {
    await inRollback(async () => {
      await setup();
      const id = await approvedScheduled();
      await runCommunityAiScheduler(new Date(Date.now() + 1000));
      await runCommunityAiScheduler(new Date(Date.now() + 1000));
      expect(await statusOf(db, id)).toBe('executed');
      expect(mockConnector).toHaveBeenCalledTimes(1);
    });
  });

  it('F1: a post-claim pre-dispatch refusal gives the claim back; the next run executes it', async () => {
    await inRollback(async () => {
      await setup();
      const id = await approvedScheduled();
      unreadableAfterClaim();
      await runCommunityAiScheduler(new Date(Date.now() + 1000));
      expect(await statusOf(db, id)).toBe('approved');
      expect(mockConnector).not.toHaveBeenCalled();
      jest.restoreAllMocks();
      __resetCommunityAiPlatformPolicyCacheForTests();
      await runCommunityAiScheduler(new Date(Date.now() + 1000));
      expect(await statusOf(db, id)).toBe('executed');
      expect(mockConnector).toHaveBeenCalledTimes(1);
    });
  });

  it('kill switch: the row stays approved with exactly one refusal record across runs', async () => {
    await inRollback(async () => {
      await setup();
      const id = await approvedScheduled();
      await killSwitch();
      __resetCommunityAiPlatformPolicyCacheForTests();
      await runCommunityAiScheduler(new Date(Date.now() + 1000));
      await runCommunityAiScheduler(new Date(Date.now() + 1000));
      expect(await statusOf(db, id)).toBe('approved');
      expect(await refusalsOf(db, id)).toEqual([expect.objectContaining({ code: 'PLATFORM_KILL_SWITCH', claim_point: 'scheduler' })]);
      expect(mockConnector).not.toHaveBeenCalled();
    });
  });
});

describe('scheduler: a legacy approved row with no approval of record', () => {
  it('is never loaded: no refusal record, no claim, no write, every run', async () => {
    await inRollback(async () => {
      await setup();
      const id = randomUUID();
      await db.query(
        `INSERT INTO public.community_ai_actions
           (id, tenant_id, organization_id, platform, action_type, target_id, suggested_text, status, execution_mode,
            requires_human_approval, risk_level, scheduled_at)
         VALUES ($1, $2, $2, 'linkedin', 'reply', 'https://www.linkedin.com/feed/update/urn:li:activity:c3c-legacy/', 'Hi',
                 'approved', 'api', false, 'low', (now() AT TIME ZONE 'UTC') - interval '1 minute')`, [id, ORG_A]);
      const before = (await db.query(`SELECT * FROM public.community_ai_actions WHERE id = $1`, [id])).rows[0];
      const out = await runCommunityAiScheduler(new Date(Date.now() + 1000));
      await runCommunityAiScheduler(new Date(Date.now() + 1000));
      expect(out.processed).toBe(0);
      expect((await db.query(`SELECT * FROM public.community_ai_actions WHERE id = $1`, [id])).rows[0]).toEqual(before);
      expect(await refusalsOf(db, id)).toEqual([]);
      expect(mockConnector).not.toHaveBeenCalled();
    });
  });
});

describe('extension commands over the real browser claim', () => {
  const leaseOf = async (id: string) =>
    (await db.query(`SELECT dispatch_lease_id FROM public.community_ai_actions WHERE id = $1`, [id])).rows[0]?.dispatch_lease_id ?? null;

  it('an approved, queued browser reply is handed out once under a lease', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser' });
      const first = await poll();
      expect(first.statusCode).toBe(200);
      expect(first.body.commands.map((c: any) => c.id)).toEqual([id]);
      expect(await leaseOf(id)).not.toBeNull();
      const second = await poll();
      expect(second.body.commands).toEqual([]);
    });
  });

  it('kill switch: nothing handed out, row unclaimed, one refusal record across polls', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser' });
      await killSwitch();
      __resetCommunityAiPlatformPolicyCacheForTests();
      expect((await poll()).body.commands).toEqual([]);
      expect((await poll()).body.commands).toEqual([]);
      expect(await leaseOf(id)).toBeNull();
      expect(await statusOf(db, id)).toBe('pending');
      expect(await refusalsOf(db, id)).toEqual([expect.objectContaining({ code: 'PLATFORM_KILL_SWITCH', claim_point: 'browser' })]);
    });
  });

  it('an expired approval: the claim refuses; nothing handed out, row unclaimed', async () => {
    await inRollback(async () => {
      await setup();
      const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', ageMs: 8 * 24 * 3600_000 });
      expect((await poll()).body.commands).toEqual([]);
      expect(await leaseOf(id)).toBeNull();
      expect(await statusOf(db, id)).toBe('pending');
    });
  });

  it('a tenant with no policy row (fails closed): nothing handed out', async () => {
    await inRollback(async () => {
      await seedTenants();
      await openPolicy(db, null, { auto: true });
      const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser' });
      expect((await poll()).body.commands).toEqual([]);
      expect(await leaseOf(id)).toBeNull();
      expect(await refusalsOf(db, id)).toEqual([expect.objectContaining({ code: 'POLICY_MISSING', claim_point: 'browser' })]);
    });
  });
});
