/**
 * ONBOARD-002 §1/§7 — post-login routing consumes the server-derived journey
 * authority: platformReady → workspace, not ready → the canonical journey.
 * SUPER_ADMIN bypasses onboarding; unverified/no-password gates preserved; journey
 * build failure fails open to the journey.
 */

jest.mock('../../services/authResolver', () => ({ resolveAuthenticatedUser: jest.fn() }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn() }));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../services/userPreferencesService', () => ({ getPostLoginRoute: jest.fn(), upsertUserPreferences: jest.fn(async () => undefined) }));
jest.mock('../../services/companyMatchService', () => ({ extractDomain: (e: string) => String(e).split('@')[1] ?? '' }));
jest.mock('../../services/companyMembershipIntegrityService', () => ({ selectCompatibleCompanyRole: jest.fn() }));
jest.mock('../../services/onboardingJourneyService', () => ({ buildOnboardingJourney: jest.fn() }));
jest.mock('../../services/sendAuthError', () => ({ sendAuthError: jest.fn((res: any, code: string) => res.status(401).json({ error: code })) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import handler from '../../../pages/api/auth/post-login-route';
import { supabase } from '../../db/supabaseClient';
import { resolveAuthenticatedUser } from '../../services/authResolver';
import { getPostLoginRoute } from '../../services/userPreferencesService';
import { selectCompatibleCompanyRole } from '../../services/companyMembershipIntegrityService';
import { buildOnboardingJourney } from '../../services/onboardingJourneyService';

const mockResolver = resolveAuthenticatedUser as jest.Mock;
const mockFrom = (supabase as any).from as jest.Mock;
const mockPref = getPostLoginRoute as jest.Mock;
const mockSelectRole = selectCompatibleCompanyRole as jest.Mock;
const mockJourney = buildOnboardingJourney as jest.Mock;

function stubSupabase(userRow: Record<string, unknown> | null) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: userRow }) }) }) };
    if (table === 'user_company_roles') return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [{ role: 'COMPANY_ADMIN', company_id: 'c1', status: 'active' }] }) }) }) }) };
    if (table === 'companies') return { select: () => ({ in: async () => ({ data: [] }) }) };
    return {};
  });
}

function makeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = jest.fn((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn((b: any) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}

const REQ = { method: 'GET', headers: {} } as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockResolver.mockResolvedValue({ user: { id: 'u1', email: 'jane@acme.com', emailVerified: true } });
  stubSupabase({ id: 'u1', name: 'Jane', has_password: true, is_deleted: false, onboarding_state: 'company_complete' });
  mockSelectRole.mockReturnValue({ role: 'COMPANY_ADMIN', company_id: 'c1' });
  mockPref.mockResolvedValue('/command-center');
});

describe('ONBOARD-002 §1 — Platform Ready controls routing', () => {
  test('platformReady → user-preferred workspace landing', async () => {
    mockJourney.mockResolvedValue({ platformReady: true });
    const res = makeRes();
    await handler(REQ, res);
    expect(res.body).toEqual({ route: '/command-center' });
  });

  test('NOT ready → the canonical journey (resume where they stopped)', async () => {
    mockJourney.mockResolvedValue({ platformReady: false });
    const res = makeRes();
    await handler(REQ, res);
    expect(res.body).toEqual({ route: '/onboarding/journey' });
  });

  test('no company / no profile yet (not ready) still routes to the journey', async () => {
    stubSupabase({ id: 'u1', name: null, has_password: true, is_deleted: false, onboarding_state: 'verified' });
    mockJourney.mockResolvedValue({ platformReady: false });
    const res = makeRes();
    await handler(REQ, res);
    expect(res.body).toEqual({ route: '/onboarding/journey' });
  });

  test('journey build failure fails open to the journey', async () => {
    mockJourney.mockRejectedValue(new Error('boom'));
    const res = makeRes();
    await handler(REQ, res);
    expect(res.body).toEqual({ route: '/onboarding/journey' });
  });
});

describe('ONBOARD-002 — preserved gates (backward compatibility)', () => {
  test('SUPER_ADMIN bypasses onboarding (journey not consulted)', async () => {
    mockSelectRole.mockReturnValue({ role: 'SUPER_ADMIN', company_id: 'c1' });
    const res = makeRes();
    await handler(REQ, res);
    expect(res.body).toEqual({ route: '/super-admin/dashboard' });
    expect(mockJourney).not.toHaveBeenCalled();
  });

  test('unverified email → login (verify) gate preserved', async () => {
    mockResolver.mockResolvedValue({ user: { id: 'u1', email: 'jane@acme.com', emailVerified: false } });
    const res = makeRes();
    await handler(REQ, res);
    expect(res.body.route).toContain('/login?reason=verify_email');
    expect(mockJourney).not.toHaveBeenCalled();
  });

  test('no password → set-password gate preserved', async () => {
    stubSupabase({ id: 'u1', name: 'Jane', has_password: false, is_deleted: false, onboarding_state: 'verified' });
    const res = makeRes();
    await handler(REQ, res);
    expect(res.body).toEqual({ route: '/auth/set-password' });
    expect(mockJourney).not.toHaveBeenCalled();
  });
});
