/**
 * C3 security follow-up (SEC3 F1, F3; Outreach release conditions), on REAL
 * PostgreSQL. The executor runs for real; the connector, the token, the
 * playbook lookup, usage, notifications and the L-3 recheck are replaced.
 *
 *   F1  A caller that holds the claim and is then refused by a PRE-DISPATCH
 *       gate (policy unreadable, the app clock past 7 days) gives the claim
 *       back (executing -> approved, CAS on 'executing' + the claim's
 *       correlation id): never terminal, never burned, one refusal record.
 *       (a) the released row can be claimed exactly once more;
 *       (b) an outcome that may have acted never returns to 'approved';
 *       (c) a release with another correlation id is a no-op.
 *   F3  No external dispatch without the atomic claim: persist omitted, or
 *       expected_from ['executing'] on a row that was never claimed.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { db, inRollback, ORG_A } from './setup';
import { openTenant, approvedAction, claimRpc, refusalsOf, statusOf } from './helpers/c3ClaimFixtures';

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
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
const PLAYBOOK = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Playbook', status: 'active', execution_modes: { api: true, browser: true } };
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => PLAYBOOK), listPlaybooks: jest.fn(async () => [PLAYBOOK]) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn(), rpaResultMayHaveActed: () => true }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: jest.fn(async () => ({ ok: true, basis: 'recipient_allowed', recipient: null })),
}));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({ executeAction: (...a: any[]) => mockConnector(...a) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const runtime = require('../../services/communityAiActionExecutorRuntime');
const policyService = require('../../services/communityAiPlatformPolicyService');
/* eslint-enable @typescript-eslint/no-var-requires */
const DAY = 24 * 3600 * 1000;
const url = process.env.W6_DB_URL as string;

beforeEach(() => {
  mockConnector.mockReset();
  mockConnector.mockResolvedValue({ success: true, platform_id: 'urn:li:comment:1' });
  policyService.__resetCommunityAiPlatformPolicyCacheForTests();
});
afterEach(() => jest.restoreAllMocks());

const rowOf = async (id: string) => (await db.query(`SELECT * FROM public.community_ai_actions WHERE id = $1`, [id])).rows[0];
const asAction = (r: any) => ({
  id: r.id, tenant_id: r.tenant_id, organization_id: r.organization_id, platform: r.platform, action_type: r.action_type,
  target_id: r.target_id, suggested_text: r.suggested_text, playbook_id: r.playbook_id, execution_mode: 'api',
  requires_human_approval: true, risk_level: 'low', approved_at: r.approved_at?.toISOString?.() ?? r.approved_at,
});
const held = (source: string, correlationId?: string) => ({
  source, persist: true, expected_from_statuses: ['executing'], notify: false, webhook: false,
  ...(correlationId ? { correlation_id: correlationId } : {}),
});

/** Claim through the RPC with a correlation id, as a caller that holds the claim does. */
async function claimHeld(id: string, point = 'scheduler'): Promise<string> {
  const corr = randomUUID();
  const { rows: [r] } = await db.query(
    `SELECT * FROM public.claim_community_ai_action_for_execution($1, $2, $2, $3, 'api', $4)`, [id, ORG_A, point, corr]);
  expect(r).toMatchObject({ claimed: true });
  return corr;
}

describe('SEC3-F1: a pre-dispatch refusal after the claim gives the claim back', () => {
  it.each(['scheduler', 'manual', 'orchestration'])('%s holds the claim, policy unreadable: row back to approved, no connector, one refusal record', async (source) => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const corr = await claimHeld(a.id);
      jest.spyOn(policyService, 'getCommunityExecutionPolicy').mockResolvedValue({ ok: false, code: 'POLICY_UNREADABLE' });
      const r = await runtime.executeAction(asAction(await rowOf(a.id)), true, held(source, corr));
      expect(r).toMatchObject({ ok: false, status: 'skipped', may_have_acted: false });
      expect(r.response).toMatchObject({ pre_claim_refusal: true, claim_released: true });
      expect(mockConnector).not.toHaveBeenCalled();
      const row = await rowOf(a.id);
      expect(row.status).toBe('approved');
      expect(row.execution_result).toBeNull(); // nothing terminal written
      expect(await refusalsOf(db, a.id)).toHaveLength(1);
    });
  });

  it('the app clock past 7 days while the DB claim passed: APPROVAL_EXPIRED, row back to approved', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const corr = await claimHeld(a.id);
      const realNow = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(realNow + 7 * DAY + 60_000);
      const r = await runtime.executeAction(asAction(await rowOf(a.id)), true, held('scheduler', corr));
      expect(r.error).toBe('APPROVAL_EXPIRED');
      expect(r.response).toMatchObject({ pre_claim_refusal: true, claim_released: true });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await statusOf(db, a.id)).toBe('approved');
    });
  });

  it('(c) a release with another correlation id is a no-op: the row stays executing, nothing terminal', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      await claimHeld(a.id);
      jest.spyOn(policyService, 'getCommunityExecutionPolicy').mockResolvedValue({ ok: false, code: 'POLICY_UNREADABLE' });
      const r = await runtime.executeAction(asAction(await rowOf(a.id)), true, held('scheduler', randomUUID()));
      expect(r.response).toMatchObject({ pre_claim_refusal: true, claim_released: false });
      const row = await rowOf(a.id);
      expect(row.status).toBe('executing');
      expect(row.execution_result).toBeNull();
      // and without any correlation id: no release either
      expect(await runtime.releaseCommunityActionClaim({ actionId: a.id, tenantId: ORG_A, organizationId: ORG_A, correlationId: null })).toBe(false);
      expect(await runtime.releaseCommunityActionClaim({ actionId: a.id, tenantId: ORG_A, organizationId: ORG_A, correlationId: randomUUID() })).toBe(false);
      expect(await statusOf(db, a.id)).toBe('executing');
    });
  });

  it.each([
    ['the connector throws', () => mockConnector.mockRejectedValue(new Error('socket hang up'))],
    ['the connector times out', () => mockConnector.mockRejectedValue(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }))],
    ['the connector result is ambiguous', () => mockConnector.mockResolvedValue({ success: false, error: 'unknown', may_have_acted: true })],
  ])('(b) %s: the row never returns to approved', async (_l, arrange) => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const corr = await claimHeld(a.id);
      arrange();
      const r = await runtime.executeAction(asAction(await rowOf(a.id)), true, held('scheduler', corr));
      expect(mockConnector).toHaveBeenCalledTimes(1);
      expect(r.response?.claim_released).toBeUndefined();
      const status = await statusOf(db, a.id);
      expect(status).not.toBe('approved');
      expect(['uncertain', 'failed', 'executing', 'sent_unverified']).toContain(status);
      expect((await claimRpc(db, a.id, ORG_A)).claimed).toBe(false); // never claimable again
    });
  });
});

describe('SEC3-F1 on the RPA retry path: one correlation id per attempt, claim and executeAction', () => {
  /* eslint-disable-next-line @typescript-eslint/no-var-requires */
  const retryQueue = require('../../services/rpaWorker/rpaRetryQueue');
  const seedRetry = (id: string) => db.query(
    `INSERT INTO public.rpa_retry_queue (action_id, organization_id, platform, action_type, target_url, text, next_retry_at)
     VALUES ($1, $2, 'linkedin', 'reply', 'https://www.linkedin.com/x', 't', now() - interval '1 minute')`, [id, ORG_A]);
  const retryRows = async (id: string) => (await db.query(
    `SELECT attempts, claim_token FROM public.rpa_retry_queue WHERE action_id = $1`, [id])).rows;

  it('a post-claim pre-dispatch refusal: action back to approved, retry row released (not deleted), no connector', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      await seedRetry(a.id);
      const before = await retryRows(a.id);
      jest.spyOn(policyService, 'getCommunityExecutionPolicy').mockResolvedValue({ ok: false, code: 'POLICY_UNREADABLE' });
      const seen: string[] = [];
      const out = await retryQueue.flushRpaRetryQueueForOrg({
        organization_id: ORG_A,
        runAction: async (row: any, ctx: { correlationId: string }) => {
          seen.push(ctx.correlationId);
          expect(row.execution_correlation_id).toBe(ctx.correlationId);
          return runtime.executeAction(asAction(row), true, held('scheduler', ctx.correlationId));
        },
      });
      expect(seen).toHaveLength(1);
      expect(out).toMatchObject({ claimed: 1, refused: 1, obsolete: 0, errors: 0 });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await statusOf(db, a.id)).toBe('approved');
      expect(await retryRows(a.id)).toEqual(before); // released: attempts unchanged, unclaimed
      expect(await refusalsOf(db, a.id)).toHaveLength(1);
    });
  });

  it('a runner that drops the correlation id cannot release: action stays executing, retry claim retained for review', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      await seedRetry(a.id);
      jest.spyOn(policyService, 'getCommunityExecutionPolicy').mockResolvedValue({ ok: false, code: 'POLICY_UNREADABLE' });
      const out = await retryQueue.flushRpaRetryQueueForOrg({
        organization_id: ORG_A,
        runAction: async (row: any) => runtime.executeAction(asAction(row), true, held('scheduler')),
      });
      expect(out).toMatchObject({ claimed: 1, refused: 0, errors: 1 });
      expect(await statusOf(db, a.id)).toBe('executing');
      const rows = await retryRows(a.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].claim_token).not.toBeNull();
    });
  });
});

describe('SEC3-F1 (a): a released row is claimable exactly once more (committed, two sessions)', () => {
  let id = '';
  let hadPlatform = false;
  let hadTenant = false;
  afterAll(async () => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      await c.query(`DELETE FROM public.community_ai_action_logs WHERE action_id = $1`, [id]);
      await c.query(`DELETE FROM public.community_ai_actions WHERE id = $1`, [id]);
      if (!hadTenant) await c.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
      if (!hadPlatform) await c.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id IS NULL`);
    } finally { await c.end(); }
  });

  it('release, then two concurrent re-claims: exactly one winner', async () => {
    hadPlatform = (await db.query(`SELECT 1 FROM public.community_ai_platform_policy WHERE organization_id IS NULL`)).rows.length > 0;
    hadTenant = (await db.query(`SELECT 1 FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A])).rows.length > 0;
    await db.query('BEGIN');
    try {
      await openTenant(db, ORG_A);
      id = (await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id })).id;
      const corr = await claimHeld(id);
      jest.spyOn(policyService, 'getCommunityExecutionPolicy').mockResolvedValue({ ok: false, code: 'POLICY_UNREADABLE' });
      const r = await runtime.executeAction(asAction(await rowOf(id)), true, held('scheduler', corr));
      expect(r.response).toMatchObject({ claim_released: true });
      await db.query('COMMIT');
    } catch (e) { await db.query('ROLLBACK'); throw e; }
    const [s1, s2] = [new Client({ connectionString: url }), new Client({ connectionString: url })];
    await Promise.all([s1.connect(), s2.connect()]);
    try {
      const res = await Promise.all([claimRpc(s1, id, ORG_A, 'scheduler'), claimRpc(s2, id, ORG_A, 'manual')]);
      expect(res.filter((x) => x.claimed)).toHaveLength(1);
      expect(res.filter((x) => !x.claimed)[0]).toMatchObject({ code: 'CLAIM_CONFLICT', current_status: 'executing' });
    } finally { await Promise.all([s1.end(), s2.end()]); }
  });
});

describe('SEC3-F3: no external dispatch without the atomic claim', () => {
  it('persist omitted, api mode: refused CLAIM_REQUIRED, no connector, row untouched', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const before = await rowOf(a.id);
      const r = await runtime.executeAction(asAction(before), true, { source: 'manual', notify: false, webhook: false });
      expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'CLAIM_REQUIRED', may_have_acted: false });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await rowOf(a.id)).toEqual(before);
    });
  });

  it("expected_from ['executing'] on a row that was never claimed: refused CLAIM_NOT_HELD, no connector, row untouched", async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const before = await rowOf(a.id);
      const r = await runtime.executeAction(asAction(before), true, held('manual'));
      expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'CLAIM_NOT_HELD', may_have_acted: false });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await rowOf(a.id)).toEqual(before);
    });
  });

  it("NEW-1: a row 'executing' under another worker's claim, caller passes NO correlation id: CLAIM_NOT_HELD, no connector", async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const other = await claimHeld(a.id); // another worker's claim
      const r = await runtime.executeAction(asAction(await rowOf(a.id)), true, held('scheduler'));
      expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'CLAIM_NOT_HELD', may_have_acted: false });
      expect(mockConnector).not.toHaveBeenCalled();
      const row = await rowOf(a.id);
      expect(row).toMatchObject({ status: 'executing', execution_correlation_id: other });
      expect(row.execution_result).toBeNull();
      // a non-UUID id is not an id either
      expect(await runtime.communityActionClaimIsHeld({ actionId: a.id, tenantId: ORG_A, organizationId: ORG_A, correlationId: 'not-a-uuid' })).toBe(false);
      expect(await runtime.communityActionClaimIsHeld({ actionId: a.id, tenantId: ORG_A, organizationId: ORG_A, correlationId: other })).toBe(true);
    });
  });

  it("expected_from ['executing'] with another caller's correlation id: refused CLAIM_NOT_HELD", async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      await claimHeld(a.id);
      const r = await runtime.executeAction(asAction(await rowOf(a.id)), true, held('manual', randomUUID()));
      expect(r).toMatchObject({ reason: 'CLAIM_NOT_HELD' });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await statusOf(db, a.id)).toBe('executing');
    });
  });

  it('a held claim (same correlation id) dispatches exactly once', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const corr = await claimHeld(a.id);
      const r = await runtime.executeAction(asAction(await rowOf(a.id)), true, held('scheduler', corr));
      expect(r.ok).toBe(true);
      expect(mockConnector).toHaveBeenCalledTimes(1);
      expect(await statusOf(db, a.id)).toBe('executed');
    });
  });

  it('persist omitted, manual mode (a recorded simulation, no connector) still runs', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, playbookId: PLAYBOOK.id });
      const r = await runtime.executeAction({ ...asAction(await rowOf(a.id)), execution_mode: 'manual' }, true, { source: 'manual', notify: false, webhook: false });
      expect(r.reason).not.toBe('CLAIM_REQUIRED');
      expect(mockConnector).not.toHaveBeenCalled();
    });
  });
});
