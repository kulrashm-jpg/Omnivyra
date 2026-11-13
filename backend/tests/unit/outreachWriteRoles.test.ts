/**
 * Outreach WRITE roles (e9 BLOCKING, 2026-11-13; owner ruling "view-only means view only").
 * /api/lead-intelligence/campaigns and /api/lead-intelligence/execution were gated by MEMBERSHIP (enforceCompanyAccess):
 *   - campaigns: any member could create / update / delete outreach campaigns and messages and run campaign AI;
 *   - execution: dispatch / approve / release / set_control / kill_switch were already capability-gated (admin-only,
 *     SEC-91A) - but `suppress` had NO gate: any member, a Viewer included, could add a do-not-contact.
 * Fix: 55's enforceCampaignWriteRole after the membership check (campaigns: every POST; execution: the state-changing
 * actions, BEFORE their capability check). preview / check_suppression and every GET stay open to members.
 *
 * Shared routeAuthHarness: only the DB, the identity provider and the downstream services are faked; resolveUserContext,
 * enforceCompanyAccess, TenantGuard, the execution capabilities and the write-role guard run for real.
 */
jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', REDIS_URL: 'redis://127.0.0.1:6379' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

const mockSvc = {
  createCampaign: jest.fn(async () => ({ id: 'c-new' })), updateCampaign: jest.fn(async () => undefined),
  deleteCampaign: jest.fn(async () => undefined), recommendCampaign: jest.fn(async () => ({})),
  previewStrategy: jest.fn(async () => ({})), simulateCampaign: jest.fn(async () => ({})),
  getCampaignIntelligence: jest.fn(async () => ({})), createMessage: jest.fn(async () => ({ id: 'm-new' })),
  listCampaigns: jest.fn(async () => []), listMessages: jest.fn(async () => []), getCampaign: jest.fn(async () => null),
  dispatchGuarded: jest.fn(async () => ({ ok: true, dryRun: true })), previewDispatch: jest.fn(() => ({ preview: true })),
  addSuppression: jest.fn(async () => ({ complete: true, canonicalId: 's1' })), releaseSuppression: jest.fn(async () => ({ released: true })),
  isSuppressed: jest.fn(async () => ({ suppressed: false })),
  setControl: jest.fn(async () => undefined), killSwitch: jest.fn(async () => undefined), isExecutionEnabled: jest.fn(async () => false),
  recordApproval: jest.fn(async () => ({ id: 'ap1' })), revokeApproval: jest.fn(async () => undefined),
};
jest.mock('../../services/campaign/campaignService', () => ({
  createCampaign: (...a: unknown[]) => (mockSvc.createCampaign as any)(...a), updateCampaign: (...a: unknown[]) => (mockSvc.updateCampaign as any)(...a),
  deleteCampaign: (...a: unknown[]) => (mockSvc.deleteCampaign as any)(...a), recommendCampaign: (...a: unknown[]) => (mockSvc.recommendCampaign as any)(...a),
  previewStrategy: (...a: unknown[]) => (mockSvc.previewStrategy as any)(...a), simulateCampaign: (...a: unknown[]) => (mockSvc.simulateCampaign as any)(...a),
  getCampaignIntelligence: (...a: unknown[]) => (mockSvc.getCampaignIntelligence as any)(...a), createMessage: (...a: unknown[]) => (mockSvc.createMessage as any)(...a),
  listCampaigns: (...a: unknown[]) => (mockSvc.listCampaigns as any)(...a), listMessages: (...a: unknown[]) => (mockSvc.listMessages as any)(...a),
  getCampaign: (...a: unknown[]) => (mockSvc.getCampaign as any)(...a),
}));
jest.mock('../../services/operations/operationalCoreService', () => ({ getOperationalOverlay: async () => null }));
jest.mock('../../services/execution/executionBridge', () => ({
  dispatchGuarded: (...a: unknown[]) => (mockSvc.dispatchGuarded as any)(...a), previewDispatch: (...a: unknown[]) => (mockSvc.previewDispatch as any)(...a),
}));
jest.mock('../../services/execution/suppressionService', () => ({
  ...jest.requireActual('../../services/execution/suppressionService'),
  addSuppression: (...a: unknown[]) => (mockSvc.addSuppression as any)(...a), releaseSuppression: (...a: unknown[]) => (mockSvc.releaseSuppression as any)(...a),
  isSuppressed: (...a: unknown[]) => (mockSvc.isSuppressed as any)(...a),
}));
jest.mock('../../services/execution/executionControlService', () => ({
  setControl: (...a: unknown[]) => (mockSvc.setControl as any)(...a), killSwitch: (...a: unknown[]) => (mockSvc.killSwitch as any)(...a),
  isExecutionEnabled: (...a: unknown[]) => (mockSvc.isExecutionEnabled as any)(...a),
}));
jest.mock('../../services/execution/executionApprovalService', () => ({
  recordApproval: (...a: unknown[]) => (mockSvc.recordApproval as any)(...a), revokeApproval: (...a: unknown[]) => (mockSvc.revokeApproval as any)(...a),
}));
jest.mock('../../services/execution/executionAuditService', () => ({ recordExecutionAudit: async () => undefined }));

/* eslint-disable @typescript-eslint/no-var-requires */
const H = require('../helpers/routeAuthHarness');
const campaignsRoute = require('../../../pages/api/lead-intelligence/campaigns').default;
const executionRoute = require('../../../pages/api/lead-intelligence/execution').default;
const { EXECUTION_WRITE_ACTIONS } = require('../../../pages/api/lead-intelligence/execution');
/* eslint-enable @typescript-eslint/no-var-requires */

const { CO_A, USER_A, invoke, rows } = H;
const ROLE_FORBIDDEN = { error: 'Your role can view this campaign but not change it.', code: 'ROLE_FORBIDDEN' };
function setRole(role: string) {
  const row = rows('user_company_roles').find((r: any) => r.user_id === USER_A && r.company_id === CO_A);
  row.role = role;
}
const calls = () => Object.values(mockSvc).reduce((n, f) => n + (f as jest.Mock).mock.calls.length, 0);
beforeEach(() => { for (const f of Object.values(mockSvc)) (f as jest.Mock).mockClear(); });

const CAMPAIGN_ACTIONS: Array<[string, Record<string, unknown>, keyof typeof mockSvc]> = [
  ['create', { name: 'N' }, 'createCampaign'],
  ['update', { campaign_id: 'c1', name: 'N2' }, 'updateCampaign'],
  ['delete', { campaign_id: 'c1' }, 'deleteCampaign'],
  ['recommend', { campaign_id: 'c1' }, 'recommendCampaign'],
  ['preview_strategy', { audience_id: 'a1', channels: ['email'] }, 'previewStrategy'],
  ['simulate', { campaign_id: 'c1' }, 'simulateCampaign'],
  ['intelligence', { campaign_id: 'c1' }, 'getCampaignIntelligence'],
  ['create_message', { name: 'M', channel: 'email', body: 'b' }, 'createMessage'],
];
const EXEC_ACTIONS: Array<[string, Record<string, unknown>]> = [
  ['dispatch_dry_run', { campaign_id: 'c1', entity_id: 'e1', recipient: 'x@example.com' }],
  ['approve', { campaign_id: 'c1', version: 1 }],
  ['revoke_approval', { campaign_id: 'c1', version: 1 }],
  ['suppress', { target: 'x@example.com', channel: 'email' }],
  ['release', { target: 'x@example.com', channel: 'email' }],
  ['set_control', { scope: 'tenant', enabled: false }],
  ['kill_switch', { scope: 'tenant' }],
];

describe.each(['VIEWER', 'CONTENT_ENGAGER'])('%s', (role) => {
  beforeEach(() => setRole(role));

  it.each(CAMPAIGN_ACTIONS)('campaigns %s -> 403 ROLE_FORBIDDEN, service never reached', async (action, extra) => {
    const r = await invoke(campaignsRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action, ...extra } });
    expect(r).toMatchObject({ status: 403, body: ROLE_FORBIDDEN });
    expect(calls()).toBe(0);
  });

  it.each(EXEC_ACTIONS)('execution %s -> 403 ROLE_FORBIDDEN, service never reached', async (action, extra) => {
    const r = await invoke(executionRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action, ...extra } });
    expect(r).toMatchObject({ status: 403, body: ROLE_FORBIDDEN });
    expect(calls()).toBe(0);
  });

  it('READS stay open: campaigns GET, execution preview + check_suppression', async () => {
    expect((await invoke(campaignsRoute, { method: 'GET', as: 'A', query: { company_id: CO_A, list: '1' } })).status).toBe(200);
    expect((await invoke(executionRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action: 'preview', subject: 's', body: 'b', recipient: 'x@example.com' } })).status).toBe(200);
    expect((await invoke(executionRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action: 'check_suppression', target: 'x@example.com' } })).status).toBe(200);
  });
});

describe('CONTROL: a COMPANY_ADMIN passes the role gate', () => {
  beforeEach(() => setRole('COMPANY_ADMIN')); // explicit: the role row persists across describe blocks
  it.each(CAMPAIGN_ACTIONS)('campaigns %s reaches its service', async (action, extra, svc) => {
    const r = await invoke(campaignsRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action, ...extra } });
    expect(r.status).not.toBe(403);
    expect(mockSvc[svc]).toHaveBeenCalled();
  });
  it('execution suppress (the previously UNGATED action) reaches addSuppression', async () => {
    const r = await invoke(executionRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action: 'suppress', target: 'x@example.com', channel: 'email' } });
    expect(r.status).toBe(201);
    expect(mockSvc.addSuppression).toHaveBeenCalled();
  });
  it('execution kill_switch: admin passes the role gate AND its capability (admin-only, unchanged)', async () => {
    const r = await invoke(executionRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action: 'kill_switch', scope: 'tenant' } });
    expect(r.status).not.toBe(403);
    expect(mockSvc.killSwitch).toHaveBeenCalled();
  });
  it('a CONTENT_CREATOR passes the role gate but still lacks the admin-only capability (layers compose)', async () => {
    setRole('CONTENT_CREATOR');
    const r = await invoke(executionRoute, { method: 'POST', as: 'A', body: { company_id: CO_A, action: 'kill_switch', scope: 'tenant' } });
    expect(r).toMatchObject({ status: 403, body: { error: 'missing_capability:campaign.override' } });
    expect(mockSvc.killSwitch).not.toHaveBeenCalled();
  });
});

describe('the write-action list is exhaustive', () => {
  it('every state-changing execution case is in EXECUTION_WRITE_ACTIONS; only preview / check_suppression are reads', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../../pages/api/lead-intelligence/execution.ts'), 'utf8');
    const cases = [...src.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
    expect(cases.length).toBeGreaterThanOrEqual(9);
    expect(cases.filter((c) => !EXECUTION_WRITE_ACTIONS.has(c)).sort()).toEqual(['check_suppression', 'preview']);
  });
});
