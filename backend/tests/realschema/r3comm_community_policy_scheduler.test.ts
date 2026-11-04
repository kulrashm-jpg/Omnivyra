/**
 * Round 3 (2026-11-03) — community AI policy default and scheduled-dispatch
 * approval of record, on real PostgreSQL.
 *
 * Real: community_ai_platform_policy, community_ai_playbooks,
 * community_ai_actions and the executor's row write, through the supabase
 * client translated to SQL. Stubbed: platform dispatch (spies), guardrails,
 * usage enforcement, notifications, webhooks and action-log events.
 * Throwaway DB only; every case runs inside a rollback.
 */

jest.mock('../../db/supabaseClient', () =>
  require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'r3comm'));
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => require('../../db/supabaseClient').supabase.from(table),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => require('../../db/supabaseClient').supabase.rpc(fn, args),
}));
jest.mock('../../services/communityAiActionExecutorContracts', () => {
  const actual = jest.requireActual('../../services/communityAiActionExecutorContracts');
  return {
    ...actual,
    recordExecutionMetric: jest.fn(async () => undefined),
    loadHistoryMetrics: jest.fn(async () => null),
    resolveExecutionMode: jest.fn(async () => 'api'),
    runApiExecution: jest.fn(async () => ({ ok: true, status: 'executed' })),
    runRpaExecution: jest.fn(async () => ({ ok: true, status: 'executed' })),
    prepareBrowserDispatch: jest.fn(() => ({ ok: true, status: 'dispatched' })),
  };
});
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
// Not under test, and its import graph reaches '@/config', which
// jest.realschema.config.js does not map.
// The scheduler requires a connected platform before an API dispatch.
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'test-token' })) }));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn(async () => ({ success: true })) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
// CR-X-01: W1's L-3 recipient recheck runs before dispatch; this fixture has no
// resolvable recipient, so it is allowed here (refusals are covered by the
// communityL3Recheck* suites). requireActual keeps isRecipientRecheckRefusal.
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: jest.fn(async () => ({ ok: true, basis: 'recipient_allowed', recipient: null })),
}));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(async (url: string) => { throw new Error(`unexpected egress: ${url}`); }),
}));

import { db, inRollback } from './setup';

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  getCommunityAiPlatformPolicy,
  __resetCommunityAiPlatformPolicyCacheForTests,
} = require('../../services/communityAiPlatformPolicyService');
const { runCommunityAiScheduler } = require('../../services/communityAiScheduler');
const { executeAction } = require('../../services/communityAiActionExecutorRuntime');
const contracts = require('../../services/communityAiActionExecutorContracts');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error('r3comm_community_policy_scheduler refuses a non-loopback W6_DB_URL');
}

/** Synthetic tenant for a disposable DB. Never a production identifier. */
const ORG = '0eda0896-0000-4000-8000-0000000000c3';
const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

const dispatches = () =>
  (contracts.runApiExecution as jest.Mock).mock.calls.length +
  (contracts.runRpaExecution as jest.Mock).mock.calls.length +
  (contracts.prepareBrowserDispatch as jest.Mock).mock.calls.length;

async function seedPlaybook(): Promise<string> {
  await q(`INSERT INTO public.companies (id, name) VALUES ($1, 'R3 community tenant') ON CONFLICT (id) DO NOTHING`, [ORG]);
  const r = await q(
    `INSERT INTO public.community_ai_playbooks (tenant_id, organization_id, name, status, execution_modes)
     VALUES ($1, $1, 'R3 playbook', 'active', '{"api_allowed": true}'::jsonb) RETURNING id`,
    [ORG],
  );
  return r.rows[0].id;
}

// scheduled_at is timestamp WITHOUT time zone and the scheduler compares it
// with a UTC ISO cutoff, so the fixture writes UTC wall-clock time.
async function seedScheduledApproved(playbookId: string, approvedAt: string | null): Promise<string> {
  const r = await q(
    `INSERT INTO public.community_ai_actions
       (tenant_id, organization_id, platform, action_type, target_id, suggested_text, risk_level,
        requires_human_approval, status, scheduled_at, approved_at, execution_mode, playbook_id, playbook_name)
     VALUES ($1, $1, 'linkedin', 'reply', 'comment-r3', 'Thanks!', 'low',
             false, 'approved', (now() AT TIME ZONE 'UTC') - interval '1 minute', $2, 'api', $3, 'R3 playbook')
     RETURNING id`,
    [ORG, approvedAt, playbookId],
  );
  return r.rows[0].id;
}

const rowStatus = async (id: string) =>
  (await q(`SELECT status, approved_at, execution_result FROM public.community_ai_actions WHERE id=$1`, [id])).rows[0];

beforeEach(() => {
  jest.clearAllMocks();
  __resetCommunityAiPlatformPolicyCacheForTests();
});

describe('community_ai_platform_policy default (real table)', () => {
  it('no row: auto rules off, human approval required (W1 D-01, CR-X-01)', async () => {
    await inRollback(async () => {
      await q(`DELETE FROM public.community_ai_platform_policy`);
      const policy = await getCommunityAiPlatformPolicy();
      expect(policy).toMatchObject({ execution_enabled: true, auto_rules_enabled: false, require_human_approval: true });
    });
  });

  it('a row inserted with column defaults re-enables auto rules (the operator remedy, D-B3)', async () => {
    await inRollback(async () => {
      await q(`DELETE FROM public.community_ai_platform_policy`);
      await q(`INSERT INTO public.community_ai_platform_policy DEFAULT VALUES`);
      const policy = await getCommunityAiPlatformPolicy();
      expect(policy).toMatchObject({ execution_enabled: true, auto_rules_enabled: true, require_human_approval: false });
    });
  });

  it('an automated invocation with no policy row is refused before any dispatch', async () => {
    await inRollback(async () => {
      await q(`DELETE FROM public.community_ai_platform_policy`);
      const playbookId = await seedPlaybook();
      const result = await executeAction(
        { id: '0eda0896-0000-4000-8000-00000000c301', tenant_id: ORG, organization_id: ORG, platform: 'linkedin',
          action_type: 'reply', target_id: 'comment-r3', suggested_text: 'Thanks!', playbook_id: playbookId,
          execution_mode: 'api', requires_human_approval: false, risk_level: 'low' },
        true,
        { source: 'auto' },
      );
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' });
      expect(dispatches()).toBe(0);
    });
  });
});

describe('scheduled dispatch needs an approval of record (real rows)', () => {
  it('an approved, due row with no approved_at is not dispatched', async () => {
    await inRollback(async () => {
      await q(`DELETE FROM public.community_ai_platform_policy`);
      await q(`INSERT INTO public.community_ai_platform_policy DEFAULT VALUES`);
      const playbookId = await seedPlaybook();
      const id = await seedScheduledApproved(playbookId, null);

      const run = await runCommunityAiScheduler(new Date());

      // The row was picked up (so the refusal is not vacuous) and not dispatched.
      expect(run.processed).toBeGreaterThanOrEqual(1);
      expect(dispatches()).toBe(0);
      const row = await rowStatus(id);
      expect(row.status).not.toBe('executed');
      expect(row.approved_at).toBeNull();
      // CR-X-01 (W1): the claim itself requires approved_at, so the row is never
      // claimed and stays 'approved' rather than ending 'skipped'. A second tick
      // still dispatches nothing.
      expect(row.status).toBe('approved');
      await runCommunityAiScheduler(new Date());
      expect(dispatches()).toBe(0);
      expect((await rowStatus(id)).status).toBe('approved');
    });
  });

  it('positive control: the same row with approved_at is dispatched once and recorded executed', async () => {
    await inRollback(async () => {
      await q(`DELETE FROM public.community_ai_platform_policy`);
      await q(`INSERT INTO public.community_ai_platform_policy DEFAULT VALUES`);
      const playbookId = await seedPlaybook();
      const id = await seedScheduledApproved(playbookId, '2026-11-03T09:00:00Z');

      const run = await runCommunityAiScheduler(new Date());

      expect(JSON.stringify(await rowStatus(id))).toContain('"status":"executed"');
      expect(run).toMatchObject({ executed: 1, failed: 0 });

      expect(contracts.runApiExecution).toHaveBeenCalledTimes(1);
      expect((await rowStatus(id)).status).toBe('executed');
    });
  });
});
