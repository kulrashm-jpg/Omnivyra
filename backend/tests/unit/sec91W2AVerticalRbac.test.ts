/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2A-1 same-company role gaps.
 *
 * SEC-A found that three destructive/administrative actions only checked
 * MEMBERSHIP of the owning company, so any member — including VIEW_ONLY — could
 * perform them. Each is fixed ONLY where the repository already states the role
 * policy for that action:
 *
 *   DELETE /api/campaigns/:id   → COMPANY_ADMIN / SUPER_ADMIN.
 *       Policy: capabilityRegistry CAMPAIGN_DELETE is held by SUPER_ADMIN and
 *       COMPANY_ADMIN only; the sibling delete route the UI actually uses
 *       (/api/admin/delete-campaign) refuses everyone else ("Only super admins
 *       or company admins can delete campaigns").
 *   PUT /api/campaigns/:id      → campaign-authoring roles (not VIEW_ONLY).
 *       Policy: VIEW_ONLY holds CAMPAIGN_VIEW only (capabilityRegistry), the
 *       campaigns work-area is hidden from VIEW_ONLY (ROLE_ACCESS_MAP), and the
 *       campaign write permission set (PERMISSIONS.CREATE_CAMPAIGN, used by the
 *       sibling POST /api/campaigns) is admin + content roles. Content roles
 *       keep their pause/resume/cancel controls on pages/campaigns.tsx.
 *   DELETE /api/reports/:id     → any role except VIEW_ONLY (and its aliases).
 *       Policy: pages/reports.tsx "View-only roles may open + export reports,
 *       but never delete them" — previously enforced only in the browser.
 *   POST /api/admin/autonomous  → COMPANY_ADMIN / SUPER_ADMIN.
 *       Policy: AutonomousControlPanel "Allows company admins to toggle
 *       autonomous campaign generation"; CAMPAIGN_EXECUTE / AUTOMATION_EXECUTE
 *       (what autonomous mode does: generate and auto-activate campaigns) are
 *       admin-only capabilities. GET (read settings) stays membership-only.
 *
 * The real guard chain runs; only the database and identity provider are fake.
 */
import { seed, invoke, rows, writeCalls, CAMPAIGN_A, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { as, roleRows, USER_VIEWER } from '../helpers/sec91W2AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2AHarness').identityModule());
jest.mock('../../services/authResolver', () => require('../helpers/sec91W2AHarness').authResolverModule());
jest.mock('../../services/companyThemeStateService', () => ({ releaseThemeFromCampaign: jest.fn(async () => undefined) }));
jest.mock('../../services/campaignReadinessService', () => ({
  evaluateCampaignReadiness: jest.fn(async () => ({ readiness_state: 'ready', readiness_percentage: 100, blocking_issues: [] })),
}));
jest.mock('../../services/autonomousDecisionLogger', () => ({ logDecision: jest.fn(async () => undefined) }));
// reports/[reportId] pulls in the export/render stack at import time.
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../services/reportCardService', () => ({
  startAsyncReportGeneration: jest.fn(async () => undefined),
  MAX_REPORT_GENERATION_ATTEMPTS: 3,
  REPORT_RETRY_COOLDOWN_MINUTES: 10,
}));
jest.mock('../../services/export/canonicalReportPipeline', () => ({
  renderCanonicalReportHtml: jest.fn(() => '<html/>'),
  renderCanonicalReportPdf: jest.fn(async () => Buffer.from('pdf')),
}));
jest.mock('../../services/export/htmlToPdfRenderer', () => ({ renderPdfFromHtml: jest.fn(async () => Buffer.from('pdf')) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const campaignById = require('../../../pages/api/campaigns/[id]').default;
const reportById = require('../../../pages/api/reports/[reportId]').default;
const autonomous = require('../../../pages/api/admin/autonomous').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const REPORT_A = 'rep-a-000-0000-0000-00000000000a';
const REPORT_B = 'rep-b-000-0000-0000-00000000000b';

function world(extraRoles: Array<Record<string, unknown>> = []) {
  seed({
    user_company_roles: [...roleRows(), ...extraRoles],
    reports: [
      { id: REPORT_A, company_id: CO_A, status: 'completed', report_type: 'snapshot' },
      { id: REPORT_B, company_id: CO_B, status: 'completed', report_type: 'snapshot' },
    ],
    company_settings: [{ company_id: CO_A, autonomous_mode: false, approval_required: true, risk_tolerance: 'balanced' }],
  });
}
beforeEach(() => {
  world();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const campaignWrites = () => writeCalls(['campaigns', 'campaign_versions', 'scheduled_posts']);
const campaignA = () => rows('campaigns').find((r) => r.id === CAMPAIGN_A);

describe('DELETE /api/campaigns/:id — CAMPAIGN_DELETE (admins only)', () => {
  it.each(['VIEWER', 'ENGAGER', 'CREATOR', 'PUBLISHER', 'REVIEWER'] as const)(
    '%s member of the owning company → 403, nothing deleted',
    async (who) => {
      const r = await invoke(campaignById, { method: 'DELETE', query: { id: CAMPAIGN_A }, headers: as(who) });
      expect(r.status).toBe(403);
      expect(campaignWrites()).toEqual([]);
      expect(campaignA()).toBeDefined();
    },
  );

  it('COMPANY_ADMIN of the owning company → 200, campaign deleted', async () => {
    const r = await invoke(campaignById, { method: 'DELETE', query: { id: CAMPAIGN_A }, headers: as('A') });
    expect(r.status).toBe(200);
    expect(campaignA()).toBeUndefined();
  });

  it('platform super admin → 200', async () => {
    const r = await invoke(campaignById, { method: 'DELETE', query: { id: CAMPAIGN_A }, headers: as('SUPER') });
    expect(r.status).toBe(200);
    expect(campaignA()).toBeUndefined();
  });

  it('admin of ANOTHER company → 403 (tenant guard unchanged), nothing deleted', async () => {
    const r = await invoke(campaignById, { method: 'DELETE', query: { id: CAMPAIGN_A }, headers: as('B') });
    expect(r.status).toBe(403);
    expect(campaignWrites()).toEqual([]);
  });
});

describe('PUT /api/campaigns/:id — campaign authoring roles (VIEW_ONLY is read-only)', () => {
  it.each(['VIEWER', 'ENGAGER'] as const)('%s → 403, campaign unchanged', async (who) => {
    const r = await invoke(campaignById, { method: 'PUT', query: { id: CAMPAIGN_A }, body: { status: 'paused', name: 'hijacked' }, headers: as(who) });
    expect(r.status).toBe(403);
    expect(campaignWrites()).toEqual([]);
    expect(campaignA()?.name).toBe('Campaign A');
    expect(campaignA()?.status).toBe('planning');
  });

  it.each(['A', 'CREATOR', 'PUBLISHER', 'REVIEWER', 'SUPER'] as const)(
    '%s keeps the campaigns-page status control → 200',
    async (who) => {
      const r = await invoke(campaignById, { method: 'PUT', query: { id: CAMPAIGN_A }, body: { status: 'paused' }, headers: as(who) });
      expect(r.status).toBe(200);
      expect(campaignA()?.status).toBe('paused');
    },
  );

  it('GET stays open to VIEW_ONLY (CAMPAIGN_VIEW)', async () => {
    const r = await invoke(campaignById, { method: 'GET', query: { id: CAMPAIGN_A }, headers: as('VIEWER') });
    expect(r.status).toBe(200);
    expect(r.body.campaign.id).toBe(CAMPAIGN_A);
  });
});

describe('DELETE /api/reports/:id — view-only roles never delete (server-side now)', () => {
  const reportA = () => rows('reports').find((r) => r.id === REPORT_A);

  it.each(['VIEWER', 'ENGAGER'] as const)('%s → 403, report kept', async (who) => {
    const r = await invoke(reportById, { method: 'DELETE', query: { reportId: REPORT_A }, headers: as(who) });
    expect(r.status).toBe(403);
    expect(writeCalls(['reports'])).toEqual([]);
    expect(reportA()).toBeDefined();
  });

  it.each(['A', 'CREATOR', 'PUBLISHER', 'REVIEWER'] as const)('%s → 200, report deleted', async (who) => {
    const r = await invoke(reportById, { method: 'DELETE', query: { reportId: REPORT_A }, headers: as(who) });
    expect(r.status).toBe(200);
    expect(reportA()).toBeUndefined();
  });

  it('the role that counts is the one in the REPORT\'s company: admin elsewhere, viewer here → 403', async () => {
    world([{ user_id: USER_VIEWER, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' }]);
    const here = await invoke(reportById, { method: 'DELETE', query: { reportId: REPORT_A }, headers: as('VIEWER') });
    expect(here.status).toBe(403);
    expect(reportA()).toBeDefined();
    const there = await invoke(reportById, { method: 'DELETE', query: { reportId: REPORT_B }, headers: as('VIEWER') });
    expect(there.status).toBe(200);
  });

  it('foreign report stays an enumeration-safe 404', async () => {
    const r = await invoke(reportById, { method: 'DELETE', query: { reportId: REPORT_B }, headers: as('A') });
    expect(r.status).toBe(404);
    expect(writeCalls(['reports'])).toEqual([]);
  });

  it('an unknown role string fails closed → 403', async () => {
    rows('user_company_roles').find((row) => row.user_id === USER_VIEWER)!.role = 'SOMETHING_NEW';
    const r = await invoke(reportById, { method: 'DELETE', query: { reportId: REPORT_A }, headers: as('VIEWER') });
    expect(r.status).toBe(403);
    expect(reportA()).toBeDefined();
  });
});

describe('/api/admin/autonomous — toggling autonomous mode is an admin action', () => {
  const settingsA = () => rows('company_settings').find((r) => r.company_id === CO_A);

  it.each(['VIEWER', 'CREATOR', 'PUBLISHER', 'REVIEWER'] as const)('POST by %s → 403, settings unchanged', async (who) => {
    const r = await invoke(autonomous, { method: 'POST', body: { company_id: CO_A, autonomous_mode: true, approval_required: false }, headers: as(who) });
    expect(r.status).toBe(403);
    expect(writeCalls(['company_settings'])).toEqual([]);
    expect(settingsA()?.autonomous_mode).toBe(false);
  });

  it('POST by COMPANY_ADMIN → 200, settings written', async () => {
    const r = await invoke(autonomous, { method: 'POST', body: { company_id: CO_A, autonomous_mode: true }, headers: as('A') });
    expect(r.status).toBe(200);
    // The harness upsert appends rather than merging, so assert the write itself.
    const w = writeCalls(['company_settings']);
    expect(w).toHaveLength(1);
    expect(w[0].payload).toMatchObject({ company_id: CO_A, autonomous_mode: true });
  });

  it('POST by platform super admin → 200', async () => {
    const r = await invoke(autonomous, { method: 'POST', body: { company_id: CO_B, risk_tolerance: 'conservative' }, headers: as('SUPER') });
    expect(r.status).toBe(200);
  });

  it('POST by admin of another company → 403 (membership guard unchanged)', async () => {
    const r = await invoke(autonomous, { method: 'POST', body: { company_id: CO_A, autonomous_mode: true }, headers: as('B') });
    expect(r.status).toBe(403);
    expect(writeCalls(['company_settings'])).toEqual([]);
  });

  it('GET stays membership-only (VIEW_ONLY can read the settings)', async () => {
    const r = await invoke(autonomous, { method: 'GET', query: { company_id: CO_A }, headers: as('VIEWER') });
    expect(r.status).toBe(200);
    expect(r.body.data.autonomous_mode).toBe(false);
  });

  it('unauthenticated POST → 401', async () => {
    const r = await invoke(autonomous, { method: 'POST', body: { company_id: CO_A, autonomous_mode: true } });
    expect(r.status).toBe(401);
    expect(writeCalls(['company_settings'])).toEqual([]);
  });
});
