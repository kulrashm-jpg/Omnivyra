/**
 * C3: the TS contracts over the claim, on REAL PostgreSQL (transport replaced
 * by SQL on the harness connection; everything below it is real).
 *   - claimCommunityActionForExecution (runtime.ts): the wrapper over
 *     claim_community_ai_action_for_execution, its codes and its stamp.
 *   - recordCommunityExecutionRefusal (communityExecutionRefusal.ts).
 *   - the RPA retry flush claims through the same wrapper ('rpa_retry');
 *     claimRetryActionRow no longer exists.
 */
import { db, inRollback, ORG_A, ORG_B } from './setup';
import { openTenant, openPolicy, approvedAction, refusalsOf, logTypesOf, statusOf } from './helpers/c3ClaimFixtures';

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
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn(), rpaResultMayHaveActed: () => true }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { claimCommunityActionForExecution } = require('../../services/communityAiActionExecutorRuntime');
const { recordCommunityExecutionRefusal } = require('../../services/communityExecutionRefusal');
const retryQueue = require('../../services/rpaWorker/rpaRetryQueue');
/* eslint-enable @typescript-eslint/no-var-requires */

const claim = (id: string, o: Record<string, unknown> = {}) => claimCommunityActionForExecution({
  actionId: id, tenantId: ORG_A, organizationId: ORG_A, claimPoint: 'manual', ...o,
});

describe('claimCommunityActionForExecution (the single claim wrapper)', () => {
  it('claims once and returns { claimed, code, currentStatus }; the loser gets CLAIM_CONFLICT', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await claim(id, { executionMode: 'api', correlationId: '6f1c1f7e-2f4c-4a51-9a1e-111111111111' }))
        .toEqual({ claimed: true, code: null, currentStatus: 'executing' });
      const { rows: [r] } = await db.query(`SELECT execution_mode, execution_correlation_id::text AS c FROM public.community_ai_actions WHERE id = $1`, [id]);
      expect(r).toEqual({ execution_mode: 'api', c: '6f1c1f7e-2f4c-4a51-9a1e-111111111111' });
      expect(await claim(id)).toEqual({ claimed: false, code: 'CLAIM_CONFLICT', currentStatus: 'executing' });
    });
  });

  it('passes refusal codes through and leaves the row approved', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A, { auto: false });
      const expired = await approvedAction(db, { org: ORG_A, ageMs: 8 * 24 * 3600 * 1000 });
      expect(await claim(expired.id)).toMatchObject({ claimed: false, code: 'APPROVAL_EXPIRED', currentStatus: 'approved' });
      const fresh = await approvedAction(db, { org: ORG_A });
      expect(await claim(fresh.id, { claimPoint: 'auto' })).toMatchObject({ claimed: false, code: 'POLICY_AUTO_RULES_DISABLED' });
      expect(await claimCommunityActionForExecution({ actionId: fresh.id, tenantId: ORG_B, organizationId: ORG_B, claimPoint: 'manual' }))
        .toMatchObject({ claimed: false, code: 'TENANT_SCOPE_VIOLATION' });
      expect(await statusOf(db, fresh.id)).toBe('approved');
    });
  });

  it('wrapper-level codes: missing scope, unsupported from-status, transport error', async () => {
    await inRollback(async () => {
      expect(await claimCommunityActionForExecution({ actionId: '', tenantId: ORG_A, organizationId: ORG_A, claimPoint: 'manual' }))
        .toMatchObject({ claimed: false, code: 'CLAIM_SCOPE_MISSING' });
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await claim(id, { fromStatuses: ['pending'] })).toMatchObject({ claimed: false, code: 'CLAIM_STATUS_UNSUPPORTED' });
      expect(await claim(id, { claimPoint: 'browser' })).toMatchObject({ claimed: false, code: 'CLAIM_RPC_ERROR' });
    });
  });

  it('stamps final_text + idempotency_key with the claim; a taken key releases the claim (IDEMPOTENCY_KEY_CONFLICT)', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A });
      expect((await claim(a.id, { stamp: { final_text: 'Thanks for sharing', idempotency_key: 'k-1' } })).claimed).toBe(true);
      const { rows: [r] } = await db.query(`SELECT final_text, idempotency_key FROM public.community_ai_actions WHERE id = $1`, [a.id]);
      expect(r).toEqual({ final_text: 'Thanks for sharing', idempotency_key: 'k-1' });
      const b = await approvedAction(db, { org: ORG_A });
      expect(await claim(b.id, { stamp: { idempotency_key: 'k-1' } })).toMatchObject({ claimed: false, code: 'IDEMPOTENCY_KEY_CONFLICT', currentStatus: 'approved' });
      expect(await statusOf(db, b.id)).toBe('approved');
    });
  });
});

describe('LD-7: a pre-claim refusal on the self-claim path never burns the approval', () => {
  it.each([
    ['tenant execution disabled', async () => {
      await openTenant(db, ORG_A);
      await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id = $1`, [ORG_A]);
    }, 'POLICY_EXECUTION_DISABLED'],
    ['global (platform) row missing', async () => {
      await openTenant(db, ORG_A);
      await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id IS NULL`);
    }, 'POLICY_MISSING'],
  ])('auto-rule executeAction(persist:true), %s: row stays approved, exactly one refusal record, nothing claimed', async (_l, arrange, code) => {
    await inRollback(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../services/communityAiPlatformPolicyService').__resetCommunityAiPlatformPolicyCacheForTests();
      await arrange();
      const a = await approvedAction(db, { org: ORG_A });
      const { rows: [before] } = await db.query(`SELECT * FROM public.community_ai_actions WHERE id = $1`, [a.id]);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { executeAction } = require('../../services/communityAiActionExecutorRuntime');
      const run = () => executeAction({
        id: a.id, tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin', action_type: 'reply',
        target_id: before.target_id, suggested_text: before.suggested_text, execution_mode: 'api',
        requires_human_approval: true, risk_level: 'low', approved_at: a.approvedAt,
      }, true, { source: 'auto', persist: true, notify: false, webhook: false });
      const r1 = await run();
      const r2 = await run();
      for (const r of [r1, r2]) expect(r).toMatchObject({ ok: false, status: 'skipped', may_have_acted: false, error: code });
      const { rows: [after] } = await db.query(`SELECT * FROM public.community_ai_actions WHERE id = $1`, [a.id]);
      expect(after).toEqual(before);
      expect(await refusalsOf(db, a.id)).toEqual([{ event_type: 'skipped_due_to_platform_policy', code, claim_point: 'auto' }]);
    });
  });
});

describe('SEC3-F4: the claim stamp cannot set divergent text', () => {
  it('a stamp with final_text other than the approved text fails and gives the claim back', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A });
      expect(await claim(a.id, { correlationId: '6f1c1f7e-2f4c-4a51-9a1e-222222222222', stamp: { final_text: 'NOT APPROVED' } }))
        .toMatchObject({ claimed: false, code: 'CLAIM_STAMP_FAILED', currentStatus: 'approved' });
      expect(await statusOf(db, a.id)).toBe('approved');
      expect((await claim(a.id, { stamp: { final_text: 'Thanks for sharing' } })).claimed).toBe(true); // the approved text
    });
  });
});

describe('recordCommunityExecutionRefusal', () => {
  it('records once, returns false on repeat, never throws', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      const rec = () => recordCommunityExecutionRefusal({ actionId: id, organizationId: ORG_A, tenantId: ORG_A, claimPoint: 'scheduler', code: 'POLICY_MISSING', payload: { x: 1 } });
      expect(await rec()).toBe(true);
      expect(await rec()).toBe(false);
      expect(await refusalsOf(db, id)).toEqual([{ event_type: 'skipped_due_to_platform_policy', code: 'POLICY_MISSING', claim_point: 'scheduler' }]);
      expect(await recordCommunityExecutionRefusal({ actionId: id, organizationId: ORG_A, tenantId: ORG_A, claimPoint: 'scheduler', code: '' })).toBe(false);
    });
  });
});

describe('RPA retry flush uses the single claim', () => {
  it('claimRetryActionRow is gone', () => {
    expect(retryQueue.claimRetryActionRow).toBeUndefined();
  });

  const seedRetry = (id: string) => db.query(
    `INSERT INTO public.rpa_retry_queue (action_id, organization_id, platform, action_type, target_url, text, next_retry_at)
     VALUES ($1, $2, 'linkedin', 'reply', 'https://www.linkedin.com/x', 't', now() - interval '1 minute')`, [id, ORG_A]);

  it('a claimable row runs once through runAction; a refused row (expired) never runs and is recorded once', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const ok = await approvedAction(db, { org: ORG_A, executionMode: 'rpa' });
      const old = await approvedAction(db, { org: ORG_A, executionMode: 'rpa', ageMs: 8 * 24 * 3600 * 1000 });
      await seedRetry(ok.id);
      await seedRetry(old.id);
      const ran: string[] = [];
      const out = await retryQueue.flushRpaRetryQueueForOrg({
        organization_id: ORG_A,
        runAction: async (row: any) => { ran.push(row.id); return { status: 'executed' }; },
      });
      expect(ran).toEqual([ok.id]);
      expect(out).toMatchObject({ claimed: 2, succeeded: 1, obsolete: 0, refused: 1 });
      expect(await statusOf(db, ok.id)).toBe('executing'); // runAction (mocked) writes no terminal status
      expect(await statusOf(db, old.id)).toBe('approved');
      expect(await refusalsOf(db, old.id)).toEqual([{ event_type: 'skipped', code: 'APPROVAL_EXPIRED', claim_point: 'rpa_retry' }]);
      expect((await logTypesOf(db, ok.id)).filter((t) => t !== 'approved')).toEqual([]);
      const retryRows = async (id: string) => (await db.query(
        `SELECT attempts, claim_token FROM public.rpa_retry_queue WHERE action_id = $1`, [id])).rows;
      expect(await retryRows(ok.id)).toEqual([]); // ran: served its purpose
      expect(await retryRows(old.id)).toEqual([{ attempts: 0, claim_token: null }]); // refused: kept, released, no attempt
    });
  });

  const retryState = async (id: string) => (await db.query(
    `SELECT attempts, claim_token, next_retry_at FROM public.rpa_retry_queue WHERE action_id = $1`, [id])).rows;

  it('a policy refusal at the claim never deletes the retry row (no gate)', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, executionMode: 'rpa' });
      await seedRetry(a.id);
      const before = await retryState(a.id);
      await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id = $1`, [ORG_A]);
      const ran: string[] = [];
      const out = await retryQueue.flushRpaRetryQueueForOrg({ organization_id: ORG_A, runAction: async (r: any) => { ran.push(r.id); return { status: 'executed' }; } });
      expect(ran).toEqual([]);
      expect(out).toMatchObject({ refused: 1, obsolete: 0 });
      expect(await retryState(a.id)).toEqual(before);
      expect(await statusOf(db, a.id)).toBe('approved');
      expect(await refusalsOf(db, a.id)).toEqual([{ event_type: 'skipped_due_to_platform_policy', code: 'POLICY_EXECUTION_DISABLED', claim_point: 'rpa_retry' }]);
    });
  });

  it.each([
    ['returns false', async () => false],
    ['throws (fail closed)', async () => { throw new Error('policy unreadable'); }],
  ])('orgGate %s: no retry row of the org is claimed, deleted or attempted; no refusal record', async (_l, gate) => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, executionMode: 'rpa' });
      await seedRetry(a.id);
      const before = await retryState(a.id);
      const calls: string[] = [];
      const ran: string[] = [];
      const out = await retryQueue.flushRpaRetryQueueForOrg({
        organization_id: ORG_A,
        orgGate: async (org: string) => { calls.push(org); return gate(); },
        runAction: async (r: any) => { ran.push(r.id); return { status: 'executed' }; },
      });
      expect(calls).toEqual([ORG_A]);
      expect(out).toMatchObject({ gated: true, claimed: 0 });
      expect(ran).toEqual([]);
      expect(await retryState(a.id)).toEqual(before);
      expect(await refusalsOf(db, a.id)).toEqual([]);
      expect(await statusOf(db, a.id)).toBe('approved');
    });
  });

  it('round-robin passes the gate per org, once, before any claim; a permitted org runs', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      await openPolicy(db, ORG_B);
      const a = await approvedAction(db, { org: ORG_A, executionMode: 'rpa' });
      const b = await approvedAction(db, { org: ORG_B, executionMode: 'rpa' });
      await seedRetry(a.id);
      await db.query(`INSERT INTO public.rpa_retry_queue (action_id, organization_id, platform, action_type, target_url, text, next_retry_at)
        VALUES ($1, $2, 'linkedin', 'reply', 'https://www.linkedin.com/x', 't', now() - interval '1 minute')`, [b.id, ORG_B]);
      const calls: string[] = [];
      const ran: string[] = [];
      await retryQueue.flushRpaRetryQueueRoundRobin({
        orgGate: async (org: string) => { calls.push(org); return org === ORG_A; },
        runAction: async (r: any) => { ran.push(r.id); return { status: 'executed' }; },
      });
      expect(calls.filter((c) => c === ORG_A || c === ORG_B).sort()).toEqual([ORG_A, ORG_B].sort());
      expect(ran).toEqual([a.id]);
      expect((await retryState(b.id)).length).toBe(1);
      expect((await retryState(b.id))[0].claim_token).toBeNull();
    });
  });
});
