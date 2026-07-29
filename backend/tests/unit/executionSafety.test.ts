/**
 * EXECUTION-SAFETY-001 / ES-106 — permanent regression protection for the five R2/R4 findings.
 * Approval (M-1), kill-switch precedence (M-2), RBAC (m-1/m-2), audit reliability (m-3).
 */

// ── audit-reliability mocks (only affect the DB-touching audit path) ──────────────────────────
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../observability/metrics', () => ({ recordDb: jest.fn() }));

import { evaluateApproval, type ApprovalRow } from '../../services/execution/executionApprovalService';
import { evaluateControls } from '../../services/execution/executionControlService';
import { resolveExecutionCapabilities, resolveExecutionRoles, hasExecutionCapability, ROLE_CAPABILITIES } from '../../../lib/execution/executionCapabilities';
import { recordExecutionAudit } from '../../services/execution/executionAuditService';
import { ownedDbTable } from '../../db/writeOwner';
import { trackEvent } from '../../services/telemetry/telemetryDispatcher';
import { recordDb } from '../../observability/metrics';

const NOW = 1_800_000_000_000; // fixed instant (no Date.now dependence in assertions)
const approval = (over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  company_id: 'co1', campaign_id: 'camp1', version: 'default', approved_by: 'approver1',
  approved_at: new Date(NOW - 1000).toISOString(), active: true, revoked_at: null, ...over,
});
const ctx = { companyId: 'co1', campaignId: 'camp1', version: 'default', nowMs: NOW };

describe('ES-101 — server-owned approval (M-1)', () => {
  it('valid persisted approval authorizes', () => {
    expect(evaluateApproval(approval(), ctx)).toMatchObject({ approved: true, approver: 'approver1' });
  });
  it('forged/absent approval fails closed', () => {
    expect(evaluateApproval(null, ctx).approved).toBe(false);
    expect(evaluateApproval(undefined, ctx).approved).toBe(false);
  });
  it('revoked approval is rejected', () => {
    expect(evaluateApproval(approval({ active: false }), ctx).approved).toBe(false);
    expect(evaluateApproval(approval({ revoked_at: new Date(NOW).toISOString() }), ctx)).toMatchObject({ approved: false, reason: 'approval_revoked' });
  });
  it('expired approval is rejected', () => {
    const old = approval({ approved_at: new Date(NOW - 40 * 86_400_000).toISOString() });
    expect(evaluateApproval(old, { ...ctx, ttlMs: 30 * 86_400_000 })).toMatchObject({ approved: false, reason: 'approval_expired' });
  });
  it('cross-tenant approval never authorizes another company', () => {
    expect(evaluateApproval(approval({ company_id: 'other' }), ctx)).toMatchObject({ approved: false, reason: 'cross_tenant_approval' });
  });
  it('approval bound to a different campaign/version does not carry over', () => {
    expect(evaluateApproval(approval({ campaign_id: 'campX' }), ctx)).toMatchObject({ approved: false, reason: 'campaign_mismatch' });
    expect(evaluateApproval(approval({ version: 'v2' }), ctx)).toMatchObject({ approved: false, reason: 'version_mismatch' });
  });
  it('invalid approval timestamp fails closed', () => {
    expect(evaluateApproval(approval({ approved_at: 'not-a-date' }), ctx).approved).toBe(false);
  });
});

describe('ES-102 — kill-switch most-restrictive precedence (M-2)', () => {
  const R = (o: any) => ({ scope: o.scope, scope_id: o.scope_id ?? '__none__', enabled: o.enabled ?? true, emergency_stop: o.emergency_stop ?? false, company_id: o.company_id ?? '__global__' });
  const base = { companyId: 'co1', campaignId: 'camp1', connector: 'email', envEnabled: true };
  const globalOn = R({ scope: 'global', company_id: '__global__', enabled: true });

  it('env OFF disables regardless of rows', () => {
    expect(evaluateControls([globalOn], { ...base, envEnabled: false }).enabled).toBe(false);
  });
  it('no enabled global row → default OFF', () => {
    expect(evaluateControls([], base)).toMatchObject({ enabled: false, reason: 'global_disabled' });
    expect(evaluateControls([R({ scope: 'global', enabled: false })], base).enabled).toBe(false);
  });
  it('global enabled + no restrictions → enabled', () => {
    expect(evaluateControls([globalOn], base)).toMatchObject({ enabled: true });
  });
  it('tenant stop disables', () => {
    expect(evaluateControls([globalOn, R({ scope: 'tenant', company_id: 'co1', emergency_stop: true })], base)).toMatchObject({ enabled: false, reason: 'tenant_emergency_stop' });
  });
  it('connector stop disables', () => {
    expect(evaluateControls([globalOn, R({ scope: 'connector', scope_id: 'email', company_id: 'co1', emergency_stop: true })], base).enabled).toBe(false);
  });
  it('campaign stop disables', () => {
    expect(evaluateControls([globalOn, R({ scope: 'campaign', scope_id: 'camp1', company_id: 'co1', emergency_stop: true })], base).enabled).toBe(false);
  });
  it('global emergency stop disables (unmaskable)', () => {
    expect(evaluateControls([R({ scope: 'global', enabled: true, emergency_stop: true })], base).enabled).toBe(false);
  });
  it('CROSS-COMPANY MASKING PROHIBITED — a global-enabled connector row cannot mask a tenant connector emergency_stop', () => {
    const rows = [globalOn, R({ scope: 'connector', scope_id: 'email', company_id: '__global__', enabled: true }), R({ scope: 'connector', scope_id: 'email', company_id: 'co1', emergency_stop: true })];
    expect(evaluateControls(rows, base)).toMatchObject({ enabled: false, reason: 'connector_emergency_stop' });
  });
  it('another company\'s tenant/campaign stop does NOT affect this company', () => {
    const rows = [globalOn, R({ scope: 'tenant', company_id: 'other', emergency_stop: true }), R({ scope: 'campaign', scope_id: 'campZ', company_id: 'other', emergency_stop: true })];
    expect(evaluateControls(rows, base).enabled).toBe(true);
  });
  it('most-restrictive: a disabled (non-stop) applicable layer wins over enabled global', () => {
    expect(evaluateControls([globalOn, R({ scope: 'connector', scope_id: 'email', company_id: 'co1', enabled: false })], base).enabled).toBe(false);
  });
});

describe('ES-103 / ES-104 — RBAC (m-1 release, m-2 override)', () => {
  const admin = { role: 'admin' }; const member = { role: 'user' };
  it('admin resolves to operator+approver capabilities (override + approve), NOT execute', () => {
    const caps = resolveExecutionCapabilities(admin);
    expect(caps).toEqual(expect.arrayContaining(['campaign.override', 'campaign.approve', 'campaign.cancel']));
    expect(caps).not.toContain('campaign.execute'); // executor is an explicit operator grant, never implicit
  });
  it('non-admin member gets NO override/approve/execute (privilege escalation blocked)', () => {
    const caps = resolveExecutionCapabilities(member);
    expect(hasExecutionCapability(caps, 'campaign.override')).toBe(false);
    expect(hasExecutionCapability(caps, 'campaign.approve')).toBe(false);
    expect(hasExecutionCapability(caps, 'campaign.execute')).toBe(false);
  });
  it('unauthenticated / unknown resolves to read-only auditor', () => {
    expect(resolveExecutionRoles(null)).toEqual(['auditor']);
    expect(resolveExecutionCapabilities(undefined)).toEqual([]);
  });
  it('operator role centrally holds override (m-2 binding present)', () => {
    expect(ROLE_CAPABILITIES.operator).toContain('campaign.override');
  });
});

describe('ES-105 — audit reliability (m-3)', () => {
  const chain = (result: any) => {
    const maybeSingle = jest.fn().mockResolvedValue(result);
    const select = jest.fn(() => ({ maybeSingle }));
    const insert = jest.fn(() => ({ select }));
    (ownedDbTable as jest.Mock).mockReturnValue({ insert });
    return { insert };
  };
  beforeEach(() => { (trackEvent as jest.Mock).mockClear(); (recordDb as jest.Mock).mockClear(); (ownedDbTable as jest.Mock).mockReset(); });

  it('successful audit persists once and emits the stage event, NOT a failure event', async () => {
    const { insert } = chain({ error: null });
    await recordExecutionAudit({ companyId: 'co1', campaignId: 'camp1', stage: 'control', decision: 'allowed', correlationId: 'corr-1' });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(recordDb).not.toHaveBeenCalled();
    const types = (trackEvent as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(types).toContain('execution.control.allowed');
    expect(types).not.toContain('execution.audit.write_failed');
  });

  it('persist FAILURE is observable — retries, emits DB error metric + alertable telemetry with correlation id', async () => {
    const { insert } = chain({ error: { message: 'boom' } });
    await recordExecutionAudit({ companyId: 'co1', campaignId: 'camp1', stage: 'connector', decision: 'dry_run', correlationId: 'corr-9' });
    expect(insert).toHaveBeenCalledTimes(2); // one retry
    expect(recordDb).toHaveBeenCalledWith(expect.objectContaining({ table: 'execution_audit', error: true }));
    const failEvent = (trackEvent as jest.Mock).mock.calls.map((c) => c[0]).find((e) => e.type === 'execution.audit.write_failed');
    expect(failEvent).toBeDefined();
    expect(failEvent.metadata.correlation_id).toBe('corr-9');
  });
});
