/**
 * SEC-91A (STEP 3AH-91) — /api/lead-intelligence/execution capability scope.
 *
 * THE DEFECT: capabilities came from resolveUserContext().role, which is
 * 'admin' when the caller is an admin in ANY of their companies. A user who is
 * COMPANY_ADMIN of their own company but only VIEW_ONLY in another tenant could,
 * in that other tenant, lift do-not-contact suppressions (release), record or
 * revoke send approvals, and flip the execution control / kill switch.
 *
 * Capabilities are now derived from the caller's role in the REQUESTED company
 * (TenantGuard.assertTenantAccess). The execution services are stubbed as spies
 * (they are the sinks); the whole authorization chain runs for real.
 */
import { seed, invoke, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { bearer, USER_DUAL, USER_INVITED, USER_EXSUPER } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

const sinks = {
  releaseSuppression: jest.fn(async () => undefined),
  addSuppression: jest.fn(async () => undefined),
  isSuppressed: jest.fn(async () => ({ suppressed: false })),
  setControl: jest.fn(async () => undefined),
  killSwitch: jest.fn(async () => undefined),
  isExecutionEnabled: jest.fn(async () => false),
  recordApproval: jest.fn(async () => ({ id: 'appr-1' })),
  revokeApproval: jest.fn(async () => undefined),
  recordExecutionAudit: jest.fn(async () => undefined),
  dispatchGuarded: jest.fn(async () => ({ dispatched: false })),
  previewDispatch: jest.fn(() => ({ ok: true })),
};
jest.mock('../../services/execution/suppressionService', () => ({
  releaseSuppression: (...a: unknown[]) => (sinks.releaseSuppression as any)(...a),
  addSuppression: (...a: unknown[]) => (sinks.addSuppression as any)(...a),
  isSuppressed: (...a: unknown[]) => (sinks.isSuppressed as any)(...a),
}));
jest.mock('../../services/execution/executionControlService', () => ({
  setControl: (...a: unknown[]) => (sinks.setControl as any)(...a),
  killSwitch: (...a: unknown[]) => (sinks.killSwitch as any)(...a),
  isExecutionEnabled: (...a: unknown[]) => (sinks.isExecutionEnabled as any)(...a),
}));
jest.mock('../../services/execution/executionApprovalService', () => ({
  recordApproval: (...a: unknown[]) => (sinks.recordApproval as any)(...a),
  revokeApproval: (...a: unknown[]) => (sinks.revokeApproval as any)(...a),
}));
jest.mock('../../services/execution/executionAuditService', () => ({
  recordExecutionAudit: (...a: unknown[]) => (sinks.recordExecutionAudit as any)(...a),
}));
jest.mock('../../services/execution/executionBridge', () => ({
  dispatchGuarded: (...a: unknown[]) => (sinks.dispatchGuarded as any)(...a),
  previewDispatch: (...a: unknown[]) => (sinks.previewDispatch as any)(...a),
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const execution = require('../../../pages/api/lead-intelligence/execution').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const MUTATING = [
  { action: 'release', sink: 'releaseSuppression', extra: { target: 'person@example.test', channel: 'email' } },
  { action: 'approve', sink: 'recordApproval', extra: { campaign_id: 'c-1', message_id: 'v1' } },
  { action: 'revoke_approval', sink: 'revokeApproval', extra: { campaign_id: 'c-1', message_id: 'v1' } },
  { action: 'set_control', sink: 'setControl', extra: { scope: 'tenant', enabled: true } },
  { action: 'kill_switch', sink: 'killSwitch', extra: { scope: 'tenant' } },
] as const;

beforeEach(() => {
  seed({
    user_company_roles: [
      // Administers its own company A, but is only a VIEW_ONLY member of company B.
      { user_id: USER_DUAL, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: USER_DUAL, company_id: CO_B, role: 'VIEW_ONLY', status: 'active' },
      // Pending (never accepted) admin invitation to company B.
      { user_id: USER_INVITED, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'invited' },
      // Former platform admin whose SUPER_ADMIN row was deactivated.
      { user_id: USER_EXSUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: 'inactive' },
    ],
  });
  Object.values(sinks).forEach((s) => s.mockClear());
});

const post = (who: Parameters<typeof bearer>[0] | null, body: Record<string, unknown>) =>
  invoke(execution, { method: 'POST', body, headers: who ? bearer(who) : {} });

describe('lead-intelligence/execution — capabilities are scoped to the requested company', () => {
  it('unauthenticated → 401, no sink', async () => {
    const r = await post(null, { company_id: CO_B, action: 'release', target: 'x@example.test' });
    expect(r.status).toBe(401);
    expect(sinks.releaseSuppression).not.toHaveBeenCalled();
  });

  it('non-member of B → 403 (tenant guard), no sink', async () => {
    const r = await post('A', { company_id: CO_B, action: 'release', target: 'x@example.test' });
    expect(r.status).toBe(403);
    expect(sinks.releaseSuppression).not.toHaveBeenCalled();
  });

  it.each(MUTATING)('THE EXPLOIT: admin of A who is VIEW_ONLY in B cannot "$action" in B → 403, sink never reached', async ({ action, sink, extra }) => {
    const r = await post('DUAL', { company_id: CO_B, action, ...extra });
    expect(r.status).toBe(403);
    expect(String(r.body?.error)).toMatch(/^missing_capability:/);
    expect((sinks as any)[sink]).not.toHaveBeenCalled();
  });

  it.each(MUTATING)('the same user in the company they administer (A) can "$action" → allowed, bound to A', async ({ action, sink, extra }) => {
    const r = await post('DUAL', { company_id: CO_A, action, ...extra });
    expect([200, 201]).toContain(r.status);
    expect((sinks as any)[sink]).toHaveBeenCalledTimes(1);
    const firstArg = (sinks as any)[sink].mock.calls[0][0];
    const bound = typeof firstArg === 'string' ? firstArg : firstArg.companyId;
    expect(bound).toBe(CO_A);
  });

  it('an active COMPANY_ADMIN of B can release in B → 200', async () => {
    const r = await post('B', { company_id: CO_B, action: 'release', target: 'x@example.test' });
    expect(r.status).toBe(200);
    expect(sinks.releaseSuppression).toHaveBeenCalledWith(CO_B, '*', 'x@example.test');
  });

  it('an active platform super admin keeps the override in B → 200', async () => {
    const r = await post('SUPER', { company_id: CO_B, action: 'kill_switch', scope: 'tenant' });
    expect(r.status).toBe(200);
    expect(sinks.killSwitch).toHaveBeenCalledTimes(1);
  });

  it('an invited (not accepted) admin of B is admitted read-only but cannot release → 403', async () => {
    const r = await post('INVITED', { company_id: CO_B, action: 'release', target: 'x@example.test' });
    expect(r.status).toBe(403);
    expect(sinks.releaseSuppression).not.toHaveBeenCalled();
  });

  it('a deactivated super admin has no membership in B → 403 at the tenant guard', async () => {
    const r = await post('EXSUPER', { company_id: CO_B, action: 'release', target: 'x@example.test' });
    expect(r.status).toBe(403);
    expect(sinks.releaseSuppression).not.toHaveBeenCalled();
  });

  it('the read-only baseline is unchanged: a VIEW_ONLY member can still read B\'s audit', async () => {
    const r = await invoke(execution, { method: 'GET', query: { company_id: CO_B }, headers: bearer('DUAL') });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('audit');
  });

  it('client-supplied capability/role fields are ignored', async () => {
    const r = await post('DUAL', { company_id: CO_B, action: 'release', target: 'x@example.test', role: 'admin', capabilities: ['campaign.override'] });
    expect(r.status).toBe(403);
    expect(sinks.releaseSuppression).not.toHaveBeenCalled();
  });
});
