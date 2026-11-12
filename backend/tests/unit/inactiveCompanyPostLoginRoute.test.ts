/**
 * e1 2026-11-12 (BLOCKING safety; e9 condition 3). After the inactive-company role gate, login must still work:
 *  - every membership in an INACTIVE company -> a clear /company-inactive page (signed in, no 403 loop);
 *  - a user in TWO companies (one inactive) lands in the ACTIVE one as usual;
 *  - a platform SUPER_ADMIN is routed to the platform runtime even if its membership's company is inactive;
 *  - a companies read error changes no routing (server-side authorization still fails closed).
 */
jest.mock('../../services/authResolver', () => ({ resolveAuthenticatedUser: jest.fn() }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn() }));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../services/userPreferencesService', () => ({ getPostLoginRoute: jest.fn(async () => '/command-center'), upsertUserPreferences: jest.fn(async () => undefined) }));
jest.mock('../../services/companyMatchService', () => ({ extractDomain: (e: string) => String(e).split('@')[1] ?? '', isFreeEmailDomain: () => false }));
jest.mock('../../services/onboardingJourneyService', () => ({ buildOnboardingJourney: jest.fn(async () => ({ platformReady: true })) }));
jest.mock('../../services/sendAuthError', () => ({ sendAuthError: jest.fn((res: any, code: string) => res.status(401).json({ error: code })) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import handler from '../../../pages/api/auth/post-login-route';
import { supabase } from '../../db/supabaseClient';
import { resolveAuthenticatedUser } from '../../services/authResolver';
import { buildOnboardingJourney } from '../../services/onboardingJourneyService';

const mockFrom = (supabase as any).from as jest.Mock;
const ACTIVE = '11111111-1111-4111-8111-111111111111';
const OFF = '22222222-2222-4222-8222-222222222222';
let roles: any[] = [];
let companies: any[] = [];
let companiesError: any = null;

beforeEach(() => {
  jest.clearAllMocks();
  (resolveAuthenticatedUser as jest.Mock).mockResolvedValue({ user: { id: 'u1', email: 'jane@acme.com', emailVerified: true } });
  companiesError = null;
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', name: 'Jane', has_password: true, is_deleted: false, onboarding_state: 'company_complete' } }) }) }) };
    if (table === 'user_company_roles') return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: roles }) }) }) }) };
    if (table === 'companies') return { select: () => ({ in: async (_c: string, ids: string[]) => (companiesError ? { data: null, error: companiesError } : { data: companies.filter((c) => ids.includes(c.id)), error: null }) }) };
    return {};
  });
});
function makeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = jest.fn((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn((b: any) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}
const route = async () => { const res = makeRes(); await handler({ method: 'GET', headers: {} } as any, res); return res; };

test('every membership in an INACTIVE company -> /company-inactive (200, no loop)', async () => {
  roles = [{ role: 'COMPANY_ADMIN', company_id: OFF, join_source: 'invited' }];
  companies = [{ id: OFF, status: 'inactive' }];
  const res = await route();
  expect([res.statusCode, res.body]).toEqual([200, { route: '/company-inactive' }]);
  expect(buildOnboardingJourney).not.toHaveBeenCalled();
});

test('a suspended company is treated the same as an inactive one', async () => {
  roles = [{ role: 'CONTENT_CREATOR', company_id: OFF, join_source: 'invited' }];
  companies = [{ id: OFF, status: 'suspended' }];
  expect((await route()).body).toEqual({ route: '/company-inactive' });
});

test('a user in TWO companies (one inactive) lands in the workspace as usual', async () => {
  roles = [{ role: 'COMPANY_ADMIN', company_id: OFF, join_source: 'invited' }, { role: 'CONTENT_CREATOR', company_id: ACTIVE, join_source: 'invited' }];
  companies = [{ id: OFF, status: 'inactive' }, { id: ACTIVE, status: 'active' }];
  const res = await route();
  expect([res.statusCode, res.body]).toEqual([200, { route: '/command-center' }]);
});

test('EXEMPT: a platform SUPER_ADMIN goes to the platform runtime even if its membership company is inactive', async () => {
  roles = [{ role: 'SUPER_ADMIN', company_id: OFF, join_source: 'invited' }];
  companies = [{ id: OFF, status: 'inactive' }];
  expect((await route()).body).toEqual({ route: '/super-admin/dashboard' });
});

test('a companies read ERROR changes no routing (never a false "inactive")', async () => {
  roles = [{ role: 'COMPANY_ADMIN', company_id: ACTIVE, join_source: 'invited' }];
  companiesError = { message: 'connection reset' };
  expect((await route()).body).toEqual({ route: '/command-center' });
});

test('control: a user with no memberships at all is NOT sent to /company-inactive', async () => {
  roles = [];
  companies = [];
  (buildOnboardingJourney as jest.Mock).mockResolvedValueOnce({ platformReady: false });
  expect((await route()).body).toEqual({ route: '/onboarding/journey' });
});
