/**
 * ES-101 — /api/lead-intelligence/execution must not answer success when approval persistence fails.
 *
 * The whole route + authorization chain runs for real (same harness as sec91AExecutionCaps); only
 * the approval service is replaced, and it raises the REAL ApprovalPersistenceError class.
 */
import { seed, invoke, CO_A } from '../helpers/routeAuthHarness';
import { bearer, USER_DUAL } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

const sinks = {
  recordApproval: jest.fn(),
  revokeApproval: jest.fn(),
  recordExecutionAudit: jest.fn(async () => undefined),
};
jest.mock('../../services/execution/executionApprovalService', () => {
  const actual = jest.requireActual('../../services/execution/executionApprovalService');
  return {
    ApprovalPersistenceError: actual.ApprovalPersistenceError,
    recordApproval: (...a: unknown[]) => (sinks.recordApproval as any)(...a),
    revokeApproval: (...a: unknown[]) => (sinks.revokeApproval as any)(...a),
  };
});
jest.mock('../../services/execution/executionAuditService', () => ({
  recordExecutionAudit: (...a: unknown[]) => (sinks.recordExecutionAudit as any)(...a),
}));
jest.mock('../../services/execution/suppressionService', () => ({
  releaseSuppression: jest.fn(), addSuppression: jest.fn(), isSuppressed: jest.fn(async () => ({ suppressed: false })),
}));
jest.mock('../../services/execution/executionControlService', () => ({
  setControl: jest.fn(), killSwitch: jest.fn(), isExecutionEnabled: jest.fn(async () => false),
}));
jest.mock('../../services/execution/executionBridge', () => ({ dispatchGuarded: jest.fn(), previewDispatch: jest.fn() }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const execution = require('../../../pages/api/lead-intelligence/execution').default;
const { ApprovalPersistenceError } = jest.requireActual('../../services/execution/executionApprovalService');
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  // USER_DUAL administers company A (the approver capability for A).
  seed({ user_company_roles: [{ user_id: USER_DUAL, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' }] });
  Object.values(sinks).forEach((s) => s.mockReset());
  sinks.recordExecutionAudit.mockImplementation(async () => undefined);
});

const post = (body: Record<string, unknown>) => invoke(execution, { method: 'POST', body, headers: bearer('DUAL') });

describe('approve', () => {
  it('persisted → 201 with the stored approval id, and the approval is audited', async () => {
    sinks.recordApproval.mockResolvedValue({ id: 'appr-1' });
    const r = await post({ company_id: CO_A, action: 'approve', campaign_id: 'c-1', message_id: 'v1' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true, approvalId: 'appr-1' });
    expect(sinks.recordExecutionAudit).toHaveBeenCalledWith(expect.objectContaining({ stage: 'approval', reason: 'approval_recorded' }));
  });

  it('persistence failure → 500 with the stable code, no success body, no "recorded" audit', async () => {
    sinks.recordApproval.mockRejectedValue(new ApprovalPersistenceError('approval_persist_failed', { message: 'relation "public.execution_approvals" does not exist' }));
    const r = await post({ company_id: CO_A, action: 'approve', campaign_id: 'c-1', message_id: 'v1' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'approval_persist_failed' });
    expect(JSON.stringify(r.body)).not.toMatch(/relation|does not exist/);
    expect(sinks.recordExecutionAudit).not.toHaveBeenCalled();
  });

  it('unconfirmed write → 500, never 201', async () => {
    sinks.recordApproval.mockRejectedValue(new ApprovalPersistenceError('approval_persist_unconfirmed'));
    const r = await post({ company_id: CO_A, action: 'approve', campaign_id: 'c-1' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'approval_persist_unconfirmed' });
  });
});

describe('revoke_approval', () => {
  it('revoked → 200 and audited as cancelled', async () => {
    sinks.revokeApproval.mockResolvedValue(undefined);
    const r = await post({ company_id: CO_A, action: 'revoke_approval', campaign_id: 'c-1', message_id: 'v1' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(sinks.recordExecutionAudit).toHaveBeenCalledWith(expect.objectContaining({ decision: 'cancelled', reason: 'approval_revoked' }));
  });

  it('revoke failure → 500, not { ok: true } — the approval may still be active', async () => {
    sinks.revokeApproval.mockRejectedValue(new ApprovalPersistenceError('approval_revoke_failed', { message: 'timeout' }));
    const r = await post({ company_id: CO_A, action: 'revoke_approval', campaign_id: 'c-1', message_id: 'v1' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'approval_revoke_failed' });
    expect(sinks.recordExecutionAudit).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../helpers/routeAuthHarness').assertNoHarnessConfigurationError();
});
