/**
 * D-01 — no external community action without a persisted human approval.
 *
 *   - An AI-suggested requires_human_approval=false, or a low risk_level, never
 *     waives approval; the platform policy's require_human_approval=false does
 *     not either. Only approved_at (stamped by the human approve route) does.
 *   - A matching auto-rule records the action as 'pending' requiring human
 *     approval and does not execute it; once a human approval exists it runs.
 *   - An ad-hoc (auto_insert) engagement action is never inserted approved and
 *     never reaches a connector.
 *   - The execute route refuses an unapproved row before claiming it, and a
 *     final_text that differs from the approved text (the row's suggested_text).
 *
 * Every test also asserts the DB approval-integrity CHECK
 * (20260522_community_ai_execution_integrity.sql) holds on every row.
 *
 * In-memory fake DB (helpers/communityExecutionFakeDb); no network.
 */

import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
// L-3: these tests exercise other mechanics with fixtures that carry no
// resolvable recipient; the recipient recheck itself is proven in
// communityL3RecipientRecheck / communityL3RecheckEnforcement /
// communityL3RecheckBrowserClaim. Here every recipient is treated as allowed.
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));
jest.mock('../../db/communityAiActionStore', () => ({
  getCommunityAiActionById: jest.fn(async (id: string) => {
    const r = mockDb.tables.community_ai_actions.find((x) => x.id === id);
    return { data: r ? { ...r } : null, error: null };
  }),
}));

// The most permissive stored policy: auto-rules on, no global approval
// requirement. D-01 must hold even here.
const mockPolicy = { execution_enabled: true, auto_rules_enabled: true, require_human_approval: false };
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({ ...mockPolicy })),
}));
jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
const PLAYBOOK = {
  id: 'pb1',
  name: 'Playbook',
  status: 'active',
  execution_modes: { api: true },
};
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => PLAYBOOK),
  listPlaybooks: jest.fn(async () => [PLAYBOOK]),
}));
jest.mock('../../services/playbooks/playbookEvaluator', () => ({
  evaluatePlaybookForEvent: jest.fn(() => ({
    primary_playbook: PLAYBOOK,
    decision: { execution_mode: 'api', tone: { style: 'friendly' } },
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
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: jest.fn(async () => ({ tenantId: 't1', organizationId: 'o1' })),
  enforceActionRole: jest.fn(async () => ({ userId: 'human-1' })),
}));

import { executeAction, requiresApproval } from '../../services/communityAiActionExecutor';
import { evaluateAutoRules } from '../../services/communityAiAutoRuleService';
import executeHandler from '../../../pages/api/community-ai/actions/execute';

const ACTION_ID = '00000000-0000-0000-0000-0000000000d1';
const TARGET = 'https://www.linkedin.com/feed/update/urn:li:activity:1/';

const row = (over: Record<string, any> = {}) => ({
  id: ACTION_ID,
  tenant_id: 't1',
  organization_id: 'o1',
  platform: 'linkedin',
  action_type: 'reply',
  target_id: TARGET,
  suggested_text: 'Thanks for sharing',
  playbook_id: 'pb1',
  execution_mode: 'api',
  status: 'approved',
  approved_at: null,
  requires_human_approval: false,
  risk_level: 'low',
  cancel_requested_at: null,
  ...over,
});

const action = (over: Record<string, any> = {}) => row(over) as any;

const actionRows = () => mockDb.tables.community_ai_actions || [];

// community_ai_actions_approval_integrity_check, applied to every row.
const assertApprovalIntegrity = () => {
  for (const r of actionRows()) {
    const ok =
      r.requires_human_approval !== true ||
      r.status === 'pending' ||
      r.status === 'skipped' ||
      (r.approved_at !== null && r.approved_at !== undefined);
    expect({ id: r.id, ok }).toEqual({ id: r.id, ok: true });
  }
};

const mockRes = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
};

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockPolicy.execution_enabled = true;
  mockPolicy.auto_rules_enabled = true;
  mockPolicy.require_human_approval = false;
  mockConnector.mockReset();
  mockConnector.mockResolvedValue({ success: true, platform_id: 'urn:li:comment:1' });
});

afterEach(() => {
  assertApprovalIntegrity();
});

describe('D-01 approval contract', () => {
  it('requires_human_approval=false and low risk do not waive approval', () => {
    expect(requiresApproval(action({ requires_human_approval: false, risk_level: 'low' }), true)).toBe(true);
    expect(requiresApproval(action({ requires_human_approval: null, risk_level: null }), true)).toBe(true);
  });

  it('only the caller flag AND a persisted approved_at satisfy it', () => {
    const approvedAt = '2026-11-01T00:00:00Z';
    expect(requiresApproval(action({ approved_at: approvedAt }), true)).toBe(false);
    expect(requiresApproval(action({ approved_at: approvedAt }), false)).toBe(true);
    expect(requiresApproval(action({ approved_at: approvedAt, risk_level: 'high' }), true)).toBe(false);
  });
});

describe('D-01 executor', () => {
  it('an AI-cleared row (requires_human_approval=false, low risk) with no approved_at never reaches the connector', async () => {
    mockDb.tables.community_ai_actions.push(row());
    const r = await executeAction(action(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED', may_have_acted: false });
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('the same row executes once a human approval (approved_at) exists', async () => {
    mockDb.tables.community_ai_actions.push(row({ approved_at: '2026-11-01T00:00:00Z' }));
    const r = await executeAction(action({ approved_at: '2026-11-01T00:00:00Z' }), true, {
      source: 'scheduler', persist: true, notify: false, webhook: false,
    });
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  it('ad-hoc auto_insert: refused before any row is written; only the event is logged; no connector', async () => {
    const { logCommunityAiActionEvent } = jest.requireMock('../../services/communityAiActionLogService');
    logCommunityAiActionEvent.mockClear();
    const r = await executeAction(action({ action_type: 'like', suggested_text: null }), true, {
      source: 'manual', persist: true, auto_insert: true, notify: false, webhook: false,
    });
    expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED', may_have_acted: false });
    expect(actionRows()).toEqual([]);
    expect(mockDb.ops.filter((o) => o.table === 'community_ai_actions')).toEqual([]);
    expect(logCommunityAiActionEvent).toHaveBeenCalledWith(expect.objectContaining({
      action_id: ACTION_ID, event_type: 'skipped',
      event_payload: expect.objectContaining({ reason: 'ad_hoc_action_has_no_human_approval' }),
    }));
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('ad-hoc auto_insert: the id stays usable (no dedup on a retry; a later approved row under it executes)', async () => {
    await executeAction(action({ action_type: 'like', suggested_text: null }), true, {
      source: 'manual', persist: true, auto_insert: true, notify: false, webhook: false,
    });
    const again = await executeAction(action({ action_type: 'like', suggested_text: null }), true, {
      source: 'manual', persist: true, auto_insert: true, notify: false, webhook: false,
    });
    expect(again).toMatchObject({ status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' });
    expect(again.deduplicated).toBeUndefined();
    expect(mockConnector).not.toHaveBeenCalled();
    mockDb.tables.community_ai_actions.push(row({ action_type: 'like', suggested_text: null, approved_at: '2026-11-01T00:00:00Z' }));
    const r = await executeAction(action({ action_type: 'like', suggested_text: null, approved_at: '2026-11-01T00:00:00Z' }), true, {
      source: 'scheduler', persist: true, notify: false, webhook: false,
    });
    expect(r.ok).toBe(true);
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('ad-hoc auto_insert: a caller-supplied approved_at on the synthesized action is not an approval', async () => {
    const r = await executeAction(action({ action_type: 'like', suggested_text: null, approved_at: '2026-11-01T00:00:00Z' }), true, {
      source: 'manual', persist: true, auto_insert: true, notify: false, webhook: false,
    });
    expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED', may_have_acted: false });
    expect(mockConnector).not.toHaveBeenCalled();
    expect(actionRows()).toEqual([]);
  });
});

describe('D-01 auto-rules', () => {
  const RULE = {
    id: 'rule-1',
    tenant_id: 't1',
    organization_id: 'o1',
    rule_name: 'auto-reply',
    condition: {},
    action_type: 'reply',
    max_risk_level: 'medium',
    is_active: true,
  };
  // An AI suggestion that classifies itself as needing no human, low risk.
  const SUGGESTION = {
    platform: 'linkedin',
    action_type: 'reply',
    target_id: TARGET,
    suggested_text: 'Thanks for sharing',
    risk_level: 'low',
    requires_human_approval: false,
    intent_scores: { question: 0.9 },
  };
  const input = () => ({
    tenant_id: 't1',
    organization_id: 'o1',
    platform: 'linkedin',
    suggested_actions: [{ ...SUGGESTION }],
    context: { intent_scores: { question: 0.9 } },
  });

  beforeEach(() => {
    mockDb.tables.community_ai_auto_rules = [{ ...RULE }];
  });

  it('a matching rule records a pending action requiring human approval and executes nothing', async () => {
    const out = await evaluateAutoRules(input());
    expect(out.autoExecuted).toBe(0);
    expect(out.actions[0]).toMatchObject({ blocked_reason: 'Human approval required' });
    expect(mockConnector).not.toHaveBeenCalled();
    const rows = actionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', requires_human_approval: true });
    expect(rows[0].approved_at ?? null).toBeNull();
  });

  it('an existing unapproved row for the target (stored elsewhere, requires_human_approval=true) is not executed', async () => {
    const existing = row({ status: 'pending', requires_human_approval: true, approved_at: null });
    mockDb.tables.community_ai_actions.push({ ...existing });
    const out = await evaluateAutoRules(input());
    expect(out.autoExecuted).toBe(0);
    expect(mockConnector).not.toHaveBeenCalled();
    expect(actionRows()).toEqual([existing]);
  });

  it.each(['executed', 'uncertain', 'failed', 'executing', 'sent_unverified', 'skipped'])(
    'an existing %s row WITH approved_at is never acted on again (0 connector calls, row unchanged)',
    async (status) => {
      const existing = row({ status, requires_human_approval: true, approved_at: '2026-11-01T00:00:00Z' });
      mockDb.tables.community_ai_actions.push({ ...existing });
      const out = await evaluateAutoRules(input());
      expect(out.autoExecuted).toBe(0);
      expect(out.actions[0]).toMatchObject({ blocked_reason: 'Action is not awaiting execution' });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(actionRows()).toEqual([existing]);
    },
  );

  it('after a human approval (approved_at) the rule executes the approved row', async () => {
    await evaluateAutoRules(input());
    // What pages/api/community-ai/actions/approve.ts writes.
    Object.assign(actionRows()[0], { status: 'approved', approved_at: '2026-11-01T00:00:00Z', approved_by: 'human-1' });
    const out = await evaluateAutoRules(input());
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(out.autoExecuted).toBe(1);
  });

  it('a non-matching suggestion is also stored requiring approval, whatever the AI said', async () => {
    mockDb.tables.community_ai_auto_rules = [];
    await evaluateAutoRules(input());
    expect(actionRows()[0]).toMatchObject({ status: 'pending', requires_human_approval: true });
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('existing rules and history are left untouched', async () => {
    const historic = row({ id: '00000000-0000-0000-0000-0000000000d9', status: 'executed', approved_at: null, target_id: 'other' });
    mockDb.tables.community_ai_actions.push({ ...historic });
    await evaluateAutoRules(input());
    expect(mockDb.tables.community_ai_auto_rules).toEqual([RULE]);
    expect(actionRows().find((r) => r.id === historic.id)).toEqual(historic);
    expect(mockDb.ops.filter((o) => o.op === 'update' || o.op === 'delete')).toEqual([]);
  });
});

describe('D-01 execute route', () => {
  const call = async (body: Record<string, any>) => {
    const res = mockRes();
    await (executeHandler as any)({ method: 'POST', headers: {}, body: { action_id: ACTION_ID, approved: true, ...body } }, res);
    return res;
  };

  it('refuses an AI-cleared row with no approved_at before claiming it (row untouched)', async () => {
    mockDb.tables.community_ai_actions.push(row({ status: 'pending' }));
    const before = { ...actionRows()[0] };
    const res = await call({ execution_mode: 'api' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'APPROVAL_REQUIRED' });
    expect(actionRows()[0]).toEqual(before);
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('reply: refuses a final_text that differs from the approved text', async () => {
    mockDb.tables.community_ai_actions.push(row({ approved_at: '2026-11-01T00:00:00Z' }));
    const before = { ...actionRows()[0] };
    const res = await call({ execution_mode: 'api', final_text: 'Click my link instead' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: 'FINAL_TEXT_NOT_APPROVED' });
    expect(actionRows()[0]).toEqual(before);
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it.each([
    ['equal', 'Thanks for sharing'],
    ['equal after trim', '  Thanks for sharing \n'],
    ['omitted', undefined],
  ])('reply: final_text %s executes the APPROVED bytes, never the client text', async (_l, finalText) => {
    mockDb.tables.community_ai_actions.push(row({ approved_at: '2026-11-01T00:00:00Z' }));
    const res = await call({ execution_mode: 'api', final_text: finalText });
    expect(res.statusCode).toBe(200);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(mockConnector.mock.calls[0][0].suggested_text).toBe('Thanks for sharing');
  });

  it.each([
    ['n/a (the manual-execute dialog)', 'n/a'],
    ['arbitrary text', 'Click my link instead'],
  ])('like: final_text %s is ignored; the approved like runs as approved', async (_l, finalText) => {
    mockDb.tables.community_ai_actions.push(row({ action_type: 'like', suggested_text: null, approved_at: '2026-11-01T00:00:00Z' }));
    const res = await call({ execution_mode: 'api', final_text: finalText });
    expect(res.statusCode).toBe(200);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(mockConnector.mock.calls[0][0].suggested_text ?? '').toBe('');
  });
});
