/**
 * D-01 — community human approval, on REAL PostgreSQL.
 *
 *   - The real policy service, reading the real (empty) policy table, resolves
 *     auto-rules OFF and human approval REQUIRED.
 *   - The real executor refuses an ad-hoc (auto_insert) action before writing
 *     any action row (skipped, no connector call); only the event is logged.
 *   - The real auto-rule service, for a matching AI-cleared suggestion, does not
 *     execute the existing unapproved row for the target; the row is unchanged
 *     and the extension claim cannot take it.
 *
 * Replaced: playbook lookup/evaluation (no playbook rows needed), the usage
 * gate, notifications/webhooks, the RPA worker (it pulls in the Redis client)
 * and the LinkedIn connector (asserted never called).
 */

import { db, inRollback, seedTenants, ORG_A } from './setup';

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
jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })),
}));
const PLAYBOOK = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Playbook', status: 'active', execution_modes: { browser: true } };
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => PLAYBOOK),
  listPlaybooks: jest.fn(async () => [PLAYBOOK]),
}));
jest.mock('../../services/playbooks/playbookEvaluator', () => ({
  evaluatePlaybookForEvent: jest.fn(() => ({
    primary_playbook: PLAYBOOK,
    decision: { execution_mode: 'browser', tone: { style: 'friendly' } },
  })),
}));
jest.mock('../../services/playbooks/playbookValidator', () => ({
  validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })),
}));
jest.mock('../../services/executionGuardrailService', () => ({
  canExecuteAction: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(),
  rpaResultMayHaveActed: () => true,
}));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { getCommunityAiPlatformPolicy } = require('../../services/communityAiPlatformPolicyService');
const { executeAction } = require('../../services/communityAiActionExecutor');
const { evaluateAutoRules } = require('../../services/communityAiAutoRuleService');
/* eslint-enable @typescript-eslint/no-var-requires */

const ADHOC_ID = '00000000-0000-4000-8000-0000000000d1';
const TARGET = 'https://www.linkedin.com/feed/update/urn:li:activity:1/';

// The policy service caches for 60 s; step the clock it reads past the TTL so
// each test resolves the policy rows it set up.
const realNow = Date.now();
let clockStep = 0;
let nowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  mockConnector.mockReset();
  clockStep += 1;
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + clockStep * 120_000);
});
afterEach(() => { nowSpy?.mockRestore(); nowSpy = null; });

describe('D-01 on the real schema', () => {
  it('no policy row: the real service resolves auto-rules off and approval required', async () => {
    await inRollback(async () => {
      await db.query('DELETE FROM public.community_ai_platform_policy');
      const policy = await getCommunityAiPlatformPolicy();
      expect(policy).toMatchObject({ auto_rules_enabled: false, require_human_approval: true });
    });
  });

  it('ad-hoc auto_insert: refused before any row is written, skipped, no connector', async () => {
    await inRollback(async () => {
      await seedTenants();
      const r = await executeAction(
        {
          id: ADHOC_ID, tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin',
          action_type: 'like', target_id: TARGET, suggested_text: null, execution_mode: 'api',
          approved_at: '2026-11-01T00:00:00Z',
        },
        true,
        { source: 'manual', persist: true, auto_insert: true, notify: false, webhook: false },
      );
      expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED', may_have_acted: false });
      expect(mockConnector).not.toHaveBeenCalled();
      const { rows } = await db.query('SELECT id FROM public.community_ai_actions WHERE id = $1', [ADHOC_ID]);
      expect(rows).toEqual([]);
      const logs = await db.query(
        "SELECT event_type, event_payload->>'reason' AS reason FROM public.community_ai_action_logs WHERE action_id = $1", [ADHOC_ID]);
      expect(logs.rows).toEqual([{ event_type: 'skipped', reason: 'ad_hoc_action_has_no_human_approval' }]);
    });
  });

  // On this schema resolveActionRecord's INSERT fails (it writes
  // execution_modes_config, which no migration creates) and returns null, so a
  // rule only ever acts on a row that already exists for the target — e.g. a
  // pending row stored by communityAiOmnivyraService. That is the path proven.
  it('a matching auto-rule does not execute an existing unapproved row; the row is unchanged and unclaimable', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(`INSERT INTO public.community_ai_platform_policy (execution_enabled, auto_rules_enabled, require_human_approval)
        VALUES (true, true, false)`);
      await db.query(`INSERT INTO public.community_ai_auto_rules (tenant_id, organization_id, rule_name, condition, action_type, max_risk_level, is_active)
        VALUES ($1, $1, 'auto-reply', '{}'::jsonb, 'reply', 'medium', true)`, [ORG_A]);
      const seeded = await db.query(`INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, suggested_text, status, execution_mode, requires_human_approval, risk_level, playbook_id)
        VALUES ($1,$1,'linkedin','reply',$2,'Thanks for sharing','pending','browser',true,'low',$3) RETURNING *`, [ORG_A, TARGET, PLAYBOOK.id]);
      // CR-X-01: the ingestion worker path; round 3's read path would defer
      // before the D-01 gate this case exercises.
      const out = await evaluateAutoRules({
        autoExecute: true,
        tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin',
        suggested_actions: [{
          platform: 'linkedin', action_type: 'reply', target_id: TARGET, suggested_text: 'Thanks for sharing',
          risk_level: 'low', requires_human_approval: false, intent_scores: { question: 0.9 },
        }],
        context: { intent_scores: { question: 0.9 } },
      });
      expect(out.autoExecuted).toBe(0);
      expect(mockConnector).not.toHaveBeenCalled();
      expect(out.actions[0]).toMatchObject({ blocked_reason: 'Human approval required' });
      const { rows } = await db.query(
        `SELECT * FROM public.community_ai_actions WHERE organization_id = $1 AND target_id = $2`, [ORG_A, TARGET]);
      expect(rows).toEqual(seeded.rows);
      const claim = await db.query(
        `SELECT * FROM public.claim_community_ai_browser_command($1, $2, 'lease-1', 'holder-1', 60)`, [rows[0].id, ORG_A]);
      expect(claim.rows).toEqual([]);
    });
  });
});
