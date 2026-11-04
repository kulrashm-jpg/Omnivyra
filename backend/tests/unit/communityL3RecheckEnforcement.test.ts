/**
 * L-3 — enforcement point 1: the recipient recheck in runExecution, immediately
 * before the platform call. An opt-out recorded AFTER approval stops the action
 * on every entry point that executes through executeAction (manual execute
 * route, scheduler, retry flush, auto-rule, orchestration adapter).
 *
 * The recheck module is replaced by a controllable stub here; its own logic is
 * proven in communityL3RecipientRecheck.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));
// auto_rules_enabled: a tenant that allows automation, so that for source=auto
// the L-3 recheck (not round 3's auto-rules policy gate, CR-X-01) is the
// refusal under test.
const mockPolicy = { execution_enabled: true, auto_rules_enabled: true, require_human_approval: true };
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({ ...mockPolicy })),
}));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
const mockLog = jest.fn(async (_e: any) => undefined);
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: (e: any) => mockLog(e) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => ({ id: 'pb1' })) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
const mockRpa = jest.fn();
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: (...a: any[]) => mockRpa(...a),
  rpaResultMayHaveActed: (r: any) => !r || (r.success !== true && r.may_have_acted !== false && r.deferred !== true),
}));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({ executeAction: (...a: any[]) => mockConnector(...a) }));

const mockRecheck = jest.fn();
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: (...a: any[]) => mockRecheck(...a),
}));

import { executeAction } from '../../services/communityAiActionExecutor';
import { runCommunityAiScheduler } from '../../services/communityAiScheduler';

const ACTION_ID = '00000000-0000-0000-0000-0000000000c3';
const row = (over: Record<string, any> = {}) => ({
  id: ACTION_ID, tenant_id: 'o1', organization_id: 'o1', platform: 'linkedin', action_type: 'reply',
  target_id: 'urn:li:comment:(urn:li:activity:1,2)', suggested_text: 'Thanks!', playbook_id: 'pb1',
  execution_mode: 'api', status: 'approved', approved_at: '2026-11-01T00:00:00Z', scheduled_at: '2026-11-01T00:00:00Z',
  requires_human_approval: true, risk_level: 'low', cancel_requested_at: null, ...over,
});
const action = (over: Record<string, any> = {}) => row(over) as any;

const OPTED_OUT = { ok: false, code: 'RECIPIENT_RESTRICTED', reason: 'do not engage (linkedin)', governance: { decision: 'blocked', governanceType: 'dnc_channel', recordId: 'gov-1' } };
const ALLOWED = { ok: true, basis: 'recipient_allowed', recipient: { platform: 'linkedin', platformUserId: 'li-1', personId: null } };

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [row()] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockPolicy.execution_enabled = true;
  mockConnector.mockReset().mockResolvedValue({ success: true, confirmed: true, platform_id: 'urn:li:comment:new' });
  mockRpa.mockReset();
  mockRecheck.mockReset();
  mockLog.mockClear();
});

describe('opt-out recorded after approval → no platform call, on every executeAction source', () => {
  it.each(['manual', 'scheduler', 'auto', 'bulk'] as const)('source=%s', async (source) => {
    mockRecheck.mockResolvedValue(OPTED_OUT);
    const r = await executeAction(action(), true, { source, notify: false, webhook: false });
    expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'RECIPIENT_RESTRICTED', may_have_acted: false });
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockRpa).not.toHaveBeenCalled();
    expect(mockRecheck).toHaveBeenCalledTimes(1);
    expect(mockRecheck.mock.calls[0][0]).toMatchObject({ id: ACTION_ID, organization_id: 'o1', platform: 'linkedin' });
    const logged = mockLog.mock.calls.map((c) => c[0]).find((e) => e.event_payload?.policy_flag === 'recipient_recheck');
    expect(logged).toMatchObject({ event_type: 'skipped', event_payload: { code: 'RECIPIENT_RESTRICTED' } });
  });

  it.each(['RECIPIENT_UNRESOLVED', 'RECIPIENT_AMBIGUOUS', 'RECIPIENT_NOT_ELIGIBLE', 'RECIPIENT_STATE_UNREADABLE'])('%s also refuses with no platform call', async (code) => {
    mockRecheck.mockResolvedValue({ ok: false, code, reason: code });
    const r = await executeAction(action(), true, { source: 'manual', notify: false, webhook: false });
    expect(r).toMatchObject({ status: 'skipped', reason: code, may_have_acted: false });
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('the RPA mode is gated too', async () => {
    mockRecheck.mockResolvedValue(OPTED_OUT);
    const r = await executeAction(action({ execution_mode: 'rpa' }), true, { source: 'scheduler', notify: false, webhook: false });
    expect(r).toMatchObject({ status: 'skipped', reason: 'RECIPIENT_RESTRICTED' });
    expect(mockRpa).not.toHaveBeenCalled();
  });

  it('the scheduler claims an approved row, the recheck refuses, and nothing reaches the platform', async () => {
    mockRecheck.mockResolvedValue(OPTED_OUT);
    await runCommunityAiScheduler();
    expect(mockRecheck).toHaveBeenCalled();
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockRpa).not.toHaveBeenCalled();
  });
});

describe('positive controls and ordering', () => {
  it('an allowed recipient proceeds to the platform exactly once', async () => {
    mockRecheck.mockResolvedValue(ALLOWED);
    await executeAction(action(), true, { source: 'manual', notify: false, webhook: false });
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('D-01 still refuses an unapproved action FIRST — the recheck is never consulted', async () => {
    mockRecheck.mockResolvedValue(ALLOWED);
    const r = await executeAction(action({ approved_at: null }), true, { source: 'manual', notify: false, webhook: false });
    expect(r).toMatchObject({ status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' });
    expect(mockRecheck).not.toHaveBeenCalled();
  });

  it('the kill switch still refuses first', async () => {
    mockPolicy.execution_enabled = false;
    mockRecheck.mockResolvedValue(ALLOWED);
    const r = await executeAction(action(), true, { source: 'scheduler', notify: false, webhook: false });
    expect(r).toMatchObject({ status: 'skipped', reason: 'PLATFORM_POLICY' });
    expect(mockRecheck).not.toHaveBeenCalled();
  });

  it('the manual simulation mode contacts no one and is not gated', async () => {
    mockRecheck.mockResolvedValue(OPTED_OUT);
    await executeAction(action({ execution_mode: 'manual' }), true, { source: 'manual', notify: false, webhook: false });
    expect(mockRecheck).not.toHaveBeenCalled();
    expect(mockConnector).not.toHaveBeenCalled();
  });
});

describe('structure: every entry point reaches the gate; the gate is the last one before dispatch', () => {
  const root = path.resolve(__dirname, '../../..');
  const src = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('runExecution: recheck sits after the plan-limit gate and before switch (executionMode)', () => {
    const s = src('backend/services/communityAiActionExecutorRuntime.ts');
    const start = s.indexOf('const runExecution = async');
    const plan = s.indexOf('PLAN_LIMIT_EXCEEDED', start);
    const gate = s.indexOf('recheckCommunityRecipient(action)', start);
    const sw = s.indexOf('switch (executionMode)', start);
    expect(start).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(plan);
    expect(sw).toBeGreaterThan(gate);
    expect(s.split('recheckCommunityRecipient(action)').length - 1).toBe(1);
  });

  it.each([
    ['manual execute route', 'pages/api/community-ai/actions/execute.ts'],
    ['scheduler', 'backend/services/communityAiScheduler.ts'],
    ['RPA retry flush', 'backend/services/rpaWorker/rpaWorkerService.ts'],
    ['auto-rule', 'backend/services/communityAiAutoRuleService.ts'],
    ['orchestration adapter', 'backend/services/orchestration/communityEngineAdapter.ts'],
  ])('%s executes through executeAction', (_name, rel) => {
    expect(src(rel)).toMatch(/\bexecuteAction\(/);
  });

  it('no code outside the executor contracts calls a platform connector directly', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'tests', '__tests__', '.next'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && /platformConnectors\/(linkedin|x|facebook|instagram)Connector/.test(fs.readFileSync(p, 'utf8'))) {
          offenders.push(path.relative(root, p).replace(/\\/g, '/'));
        }
      }
    };
    walk(path.join(root, 'backend'));
    walk(path.join(root, 'pages'));
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.filter((f) => !f.startsWith('backend/services/platformConnectors/') && f !== 'backend/services/communityAiActionExecutorContracts.ts')).toEqual([]);
  });
});
