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

// C3: the policy decision and the claim are table-returning RPCs; the
// translator's rpc() is scalar-only, so rpc goes through pgTransport (rows, as
// PostgREST returns them). Table access is unchanged.
jest.mock('../../db/supabaseClient', () => {
  const mod = require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'r3comm');
  const { pgRpc } = require('./helpers/pgTransport');
  return { ...mod, supabase: { ...mod.supabase, rpc: pgRpc(() => require('./setup').db) } };
});
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
import { bindingHashOf } from './helpers/c3ClaimFixtures';
import { randomUUID } from 'crypto';

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  getCommunityExecutionPolicy,
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

/**
 * C3: execution is open only through the tenant policy (platform row + this
 * tenant's row), opened the supported way: inserted closed, requested by one
 * operator, confirmed by another (20270126000003).
 */
const R3_REQUESTER = '0eda0896-0000-4000-8000-0000000000e1';
const R3_CONFIRMER = '0eda0896-0000-4000-8000-0000000000e2';
async function openPolicy(): Promise<void> {
  for (const org of [null, ORG]) {
    const where = org === null ? 'organization_id IS NULL' : 'organization_id = $1';
    const p = org === null ? [] : [org];
    await q(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, false, false)`, [org]);
    await q(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = true, requested_auto_rules_enabled = true, requested_by = $${p.length + 1} WHERE ${where}`, [...p, R3_REQUESTER]);
    await q(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, auto_rules_enabled = true, updated_by = $${p.length + 1} WHERE ${where}`, [...p, R3_CONFIRMER]);
  }
}

const R3_APPROVER = '0eda0896-0000-4000-8000-0000000000e3';

// scheduled_at is timestamp WITHOUT time zone and the scheduler compares it
// with a UTC ISO cutoff, so the fixture writes UTC wall-clock time.
// An approved_at is the complete approval of record (C3): approver, content
// hash, passkey evidence and the approve route's 'approved' log. The fixed
// time is kept through the test-only back-date seam (superuser + GUC).
async function seedScheduledApproved(playbookId: string, approvedAt: string | null): Promise<string> {
  if (approvedAt) {
    await q(`INSERT INTO public.users (id, email, name) VALUES ($1, 'r3-approver@example.invalid', 'r3') ON CONFLICT (id) DO NOTHING`, [R3_APPROVER]);
    await q(`SET LOCAL omnivyra.community_action_test_backdate = 'i-am-a-test-fixture'`);
  }
  const newId = randomUUID();
  const hash = approvedAt ? bindingHashOf({ id: newId, tenant_id: ORG, organization_id: ORG, platform: 'linkedin',
    action_type: 'reply', target_id: 'comment-r3', suggested_text: 'Thanks!', playbook_id: playbookId }) : null;
  const r = await q(
    `INSERT INTO public.community_ai_actions
       (tenant_id, organization_id, platform, action_type, target_id, suggested_text, risk_level,
        requires_human_approval, status, scheduled_at, approved_at, execution_mode, playbook_id, playbook_name,
        approved_by, approved_content_hash, passkey_credential_id, passkey_verified_at, id)
     VALUES ($1, $1, 'linkedin', 'reply', 'comment-r3', 'Thanks!', 'low',
             false, 'approved', (now() AT TIME ZONE 'UTC') - interval '1 minute', $2, 'api', $3, 'R3 playbook',
             $4, $5::text,
             CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE 'cred-r3' END, $2::timestamptz - interval '30 seconds', $6)
     RETURNING id, to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`,
    [ORG, approvedAt, playbookId, approvedAt ? R3_APPROVER : null, hash, newId],
  );
  if (approvedAt) {
    await q(`INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
             VALUES ($1, $2, $2, 'approved', $3::jsonb)`,
      [r.rows[0].id, ORG, JSON.stringify({ approved: true, user_id: R3_APPROVER, timestamp: r.rows[0].at })]);
  }
  return r.rows[0].id;
}

const rowStatus = async (id: string) =>
  (await q(`SELECT status, approved_at, execution_result FROM public.community_ai_actions WHERE id=$1`, [id])).rows[0];

beforeEach(() => {
  jest.clearAllMocks();
  __resetCommunityAiPlatformPolicyCacheForTests();
});

describe('community_ai_platform_policy default (real table)', () => {
  it('no row: nothing executes, auto rules included (W1 D-01, CR-X-01; C3 closed default: POLICY_MISSING)', async () => {
    await inRollback(async () => {
      await q(`DELETE FROM public.community_ai_platform_policy`);
      const policy = await getCommunityExecutionPolicy({ organizationId: ORG, tenantId: ORG });
      expect(policy).toEqual({ ok: false, code: 'POLICY_MISSING' });
    });
  });

  it('rows inserted with column defaults are CLOSED (C3 LD-5 replaces the D-B3 remedy: opening needs request + a second operator)', async () => {
    await inRollback(async () => {
      await q(`DELETE FROM public.community_ai_platform_policy`);
      await q(`INSERT INTO public.community_ai_platform_policy DEFAULT VALUES`);
      await q(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id) VALUES ($1, $1)`, [ORG]);
      expect(await getCommunityExecutionPolicy({ organizationId: ORG, tenantId: ORG })).toEqual({ ok: false, code: 'PLATFORM_KILL_SWITCH' });
      __resetCommunityAiPlatformPolicyCacheForTests();
      await q(`DELETE FROM public.community_ai_platform_policy`);
      await openPolicy();
      expect(await getCommunityExecutionPolicy({ organizationId: ORG, tenantId: ORG }))
        .toMatchObject({ ok: true, policy: { execution_enabled: true, auto_rules_enabled: true } });
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
      await openPolicy();
      const playbookId = await seedPlaybook();
      const id = await seedScheduledApproved(playbookId, null);

      const run = await runCommunityAiScheduler(new Date());

      // C3: the scheduler no longer loads a row without approved_at at all
      // (communityAiScheduler filters it in the query, and the single claim
      // refuses it anyway). Not vacuous: the positive control below runs the
      // same fixture WITH an approval of record and it is dispatched once.
      expect(run.processed).toBe(0);
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
      await openPolicy();
      const playbookId = await seedPlaybook();
      const id = await seedScheduledApproved(playbookId, new Date(Date.now() - 3600_000).toISOString());

      const run = await runCommunityAiScheduler(new Date());

      expect(JSON.stringify(await rowStatus(id))).toContain('"status":"executed"');
      expect(run).toMatchObject({ executed: 1, failed: 0 });

      expect(contracts.runApiExecution).toHaveBeenCalledTimes(1);
      expect((await rowStatus(id)).status).toBe('executed');
    });
  });
});
