/**
 * SEC-91 W2-G (STEP 3AH-91, wave-2 residuals) — W2G-2:
 * POST /api/campaigns/pending/:id/approve is a company-admin action.
 *
 * Approving a pending AUTONOMOUS campaign marks it approved and creates a
 * `campaigns` row with status 'scheduled' for the whole company. The route
 * checked membership only (requireCompanyAccess), so any member — VIEW_ONLY
 * included — could approve (and, through the same handler, reject) the
 * autonomous scheduler's proposals.
 *
 * Policy (W2A-1d, the sibling POST /api/admin/autonomous): the autonomous
 * control surface (components/admin/AutonomousControlPanel — the only caller)
 * exists for COMPANY ADMINS, and what approval does — create + schedule a
 * campaign — is CAMPAIGN_EXECUTE, an admin-only capability. Same inline check:
 * COMPANY_ADMIN (incl. legacy ADMIN) / SUPER_ADMIN row in the pending
 * campaign's company, or a platform super admin.
 */
import { seed, invoke, rows, writeCalls, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { roleRows } from '../helpers/sec91W2AHarness';
import { as, w2gRoleRows, type W2GPrincipal } from '../helpers/sec91W2GHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2GHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2GHarness').identityModule());
jest.mock('../../services/authResolver', () => require('../helpers/sec91W2GHarness').authResolverModule());
const mockLogDecision = jest.fn(async (_d?: unknown) => undefined);
jest.mock('../../services/autonomousDecisionLogger', () => ({ logDecision: (d: unknown) => mockLogDecision(d) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const approve = require('../../../pages/api/campaigns/pending/[id]/approve').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const PENDING_A = 'pend-a-00-0000-0000-00000000000a';
const PENDING_B = 'pend-b-00-0000-0000-00000000000b';
const plan = (name: string) => ({ name, description: 'd', platforms: ['linkedin'], posting_frequency: {}, content_mix: {}, duration_weeks: 4, campaign_goal: 'awareness' });

beforeEach(() => {
  seed({
    user_company_roles: [...roleRows(), ...w2gRoleRows()],
    pending_campaigns: [
      { id: PENDING_A, company_id: CO_A, status: 'pending', campaign_plan: plan('Autonomous A') },
      { id: PENDING_B, company_id: CO_B, status: 'pending', campaign_plan: plan('Autonomous B') },
    ],
  });
  mockLogDecision.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const post = (pendingId: string, who: W2GPrincipal | null, url = `/api/campaigns/pending/${pendingId}/approve`) =>
  invoke((req: any, res: any) => { req.url = url; return approve(req, res); }, {
    method: 'POST', query: { id: pendingId }, body: {}, headers: who ? as(who) : {},
  });
const pendingStatus = (id: string) => rows('pending_campaigns').find((r) => r.id === id)?.status;
const createdCampaigns = () => writeCalls(['campaigns', 'notifications']);

describe('non-admin members of the owning company', () => {
  it.each(['VIEWER', 'ENGAGER', 'CREATOR', 'PUBLISHER', 'REVIEWER', 'LEGACY_MANAGER', 'LEGACY_VIEWER'] as const)(
    '%s → 403 FORBIDDEN_ROLE; pending stays pending, no campaign created',
    async (who) => {
      const r = await post(PENDING_A, who);
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: 'FORBIDDEN_ROLE' });
      expect(pendingStatus(PENDING_A)).toBe('pending');
      expect(createdCampaigns()).toEqual([]);
      expect(writeCalls(['pending_campaigns'])).toEqual([]);
      expect(mockLogDecision).not.toHaveBeenCalled();
    },
  );

  it('the (unrouted) reject branch is refused the same way', async () => {
    const r = await post(PENDING_A, 'VIEWER', `/api/campaigns/pending/${PENDING_A}/reject`);
    expect(r.status).toBe(403);
    expect(pendingStatus(PENDING_A)).toBe('pending');
  });
});

describe('admins keep approval', () => {
  it.each(['A', 'LEGACY_ADMIN'] as const)('%s (COMPANY_ADMIN of the owning company) → 200, campaign created for company A', async (who) => {
    const r = await post(PENDING_A, who);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, action: 'approved' });
    expect(pendingStatus(PENDING_A)).toBe('approved');
    const inserted = writeCalls(['campaigns']).find((c) => c.op === 'insert');
    expect(inserted?.payload).toMatchObject({ company_id: CO_A, status: 'scheduled', name: 'Autonomous A' });
  });

  it('SUPER (SUPER_ADMIN row in A) → 200', async () => {
    const r = await post(PENDING_A, 'SUPER');
    expect(r.status).toBe(200);
  });

  it('platform super admin on a company it is not a member of → 200 (override kept)', async () => {
    const r = await post(PENDING_B, 'SUPER');
    expect(r.status).toBe(200);
    expect(writeCalls(['campaigns']).find((c) => c.op === 'insert')?.payload).toMatchObject({ company_id: CO_B });
  });
});

describe('tenant isolation unchanged', () => {
  it('admin of company B → 403 on company A pending campaign, nothing written', async () => {
    const r = await post(PENDING_A, 'B');
    expect(r.status).toBe(403);
    expect(pendingStatus(PENDING_A)).toBe('pending');
    expect(createdCampaigns()).toEqual([]);
  });

  it('SPLIT (VIEW_ONLY in A, COMPANY_ADMIN in B): A → 403, B → 200 (role from the pending campaign\'s company)', async () => {
    expect((await post(PENDING_A, 'SPLIT')).status).toBe(403);
    expect(pendingStatus(PENDING_A)).toBe('pending');
    expect((await post(PENDING_B, 'SPLIT')).status).toBe(200);
    expect(pendingStatus(PENDING_B)).toBe('approved');
  });

  it('anonymous → 401', async () => {
    expect((await post(PENDING_A, null)).status).toBe(401);
    expect(pendingStatus(PENDING_A)).toBe('pending');
  });

  it('INVITED_ADMIN → 403 (requireCompanyAccess has no invited fallback; unchanged)', async () => {
    expect((await post(PENDING_A, 'INVITED_ADMIN')).status).toBe(403);
    expect(pendingStatus(PENDING_A)).toBe('pending');
  });
});
