/**
 * OPT-002 — pilot route HTTP cache headers.
 *
 * Proves, for every pilot route, that:
 *  - the 200 GET path emits EXACTLY the assigned canonical policy
 *    (`private, max-age=<tier>` + `Vary: Authorization, Cookie`), and
 *  - NO cache header is emitted on any error path (400/401/403/405/500)
 *    or on any mutation method.
 *
 * Handlers are exercised through their default export (createApiRoute wrapper),
 * per the established endpoint-test convention (see sec001CompanyRouteGuards).
 */
import notificationsHandler from '../../../pages/api/notifications';
import accountsHandler from '../../../pages/api/accounts';
import reportsHandler from '../../../pages/api/reports/index';
import journeyHandler from '../../../pages/api/onboarding/journey';
import integrationsHandler from '../../../pages/api/engagement/integrations';
import contentTypePrefsHandler from '../../../pages/api/social-platforms/content-type-prefs';
import leadStatsHandler from '../../../pages/api/lead-intelligence/stats';
import { createApiRequestMock, createMockRes } from '../utils';

const mockTableResponses: Record<string, { data: any; error: any }> = {};
jest.mock('../../db/supabaseClient', () => {
  const { createSupabaseMock } = require('../utils/createSupabaseMock');
  return {
    supabase: createSupabaseMock(
      (table: string) => mockTableResponses[table] || { data: [], error: null }
    ),
  };
});

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(),
}));

jest.mock('../../services/reportCardService', () => {
  const actual = jest.requireActual('../../services/reportCardService');
  return { ...actual, getCompanyReportsForCard: jest.fn() };
});

jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: jest.fn(),
}));
jest.mock('../../services/requestContext', () => ({
  seedRequestContextFromRequest: jest.fn(),
}));
jest.mock('../../services/onboardingJourneyService', () => ({
  buildOnboardingJourney: jest.fn(),
  applyJourneyStageAction: jest.fn(),
  emitPlatformReadyOnce: jest.fn(),
}));

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(),
  enforceCompanyAccess: jest.fn(),
}));
jest.mock('../../services/platformTokenService', () => ({
  getPlatformsWithActiveSocialAccountsForOrg: jest.fn(),
  getPlatformsWithTokensForOrg: jest.fn(),
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceReadService', () => ({
  getLeadStats: jest.fn(),
}));

// Anonymous-path SSR fallback in /api/notifications must not hit the network.
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
  })),
}));

import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';
import { getCompanyReportsForCard } from '../../services/reportCardService';
import { resolveAuthenticatedUser } from '../../services/authResolver';
import { buildOnboardingJourney } from '../../services/onboardingJourneyService';
import { enforceCompanyAccess, resolveUserContext } from '../../services/userContextService';
import {
  getPlatformsWithActiveSocialAccountsForOrg,
  getPlatformsWithTokensForOrg,
} from '../../services/platformTokenService';
import { getLeadStats } from '../../services/leadIntelligence/leadIntelligenceReadService';

const authMock = getSupabaseUserFromRequest as jest.Mock;
const reportsCardMock = getCompanyReportsForCard as jest.Mock;
const authResolverMock = resolveAuthenticatedUser as jest.Mock;
const journeyMock = buildOnboardingJourney as jest.Mock;
const enforceAccessMock = enforceCompanyAccess as jest.Mock;
const resolveUserContextMock = resolveUserContext as jest.Mock;
const activePlatformsMock = getPlatformsWithActiveSocialAccountsForOrg as jest.Mock;
const tokenPlatformsMock = getPlatformsWithTokensForOrg as jest.Mock;
const leadStatsMock = getLeadStats as jest.Mock;

/** Deny the way the real enforceCompanyAccess does: write the response, resolve null. */
const denyCompanyAccessWith = (status: number, error: string) =>
  enforceAccessMock.mockImplementation(async ({ res }: { res: any }) => {
    res.status(status).json({ error });
    return null;
  });

const cacheHeaderCalls = (res: any): Array<[string, string]> =>
  (res.setHeader as jest.Mock).mock.calls.filter(
    ([name]: [string]) => name === 'Cache-Control' || name === 'Vary' || name === 'Pragma'
  );

const expectPrivateCache = (res: any, maxAge: number) => {
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', `private, max-age=${maxAge}`);
  expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization, Cookie');
  const ccValues = (res.setHeader as jest.Mock).mock.calls
    .filter(([n]: [string]) => n === 'Cache-Control')
    .map(([, v]: [string, string]) => v);
  expect(ccValues).toEqual([`private, max-age=${maxAge}`]);
  for (const v of ccValues) {
    expect(v).not.toMatch(/public|s-maxage/);
  }
};

const expectNoCacheHeaders = (res: any) => {
  expect(cacheHeaderCalls(res)).toEqual([]);
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockTableResponses)) delete mockTableResponses[key];
});

describe('GET /api/notifications — P3 NEAR_LIVE (30 s)', () => {
  test('200: exact private cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['notifications'] = {
      data: [{ id: 'n1', type: 't', title: 'T', message: 'm', is_read: false, created_at: 'now' }],
      error: null,
    };
    const res = createMockRes();
    await notificationsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(200);
    expectPrivateCache(res, 30);
  });

  test('401 anonymous: no cache headers', async () => {
    authMock.mockResolvedValue({ user: null, error: 'no session' });
    const res = createMockRes();
    await notificationsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(401);
    expectNoCacheHeaders(res);
  });

  test('500 db error: no cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['notifications'] = { data: null, error: { message: 'db down' } };
    const res = createMockRes();
    await notificationsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(500);
    expectNoCacheHeaders(res);
  });

  test('PATCH mutation: no cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['notifications'] = { data: [], error: null };
    const res = createMockRes();
    await notificationsHandler(createApiRequestMock({ method: 'PATCH' }), res);
    expect(res.statusCode).toBe(200);
    expectNoCacheHeaders(res);
  });
});

describe('GET /api/accounts — P3 STANDARD (60 s)', () => {
  test('200: exact private cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['social_accounts'] = {
      data: [{ id: 'a1', platform: 'linkedin', is_active: true, token_expires_at: null }],
      error: null,
    };
    const res = createMockRes();
    await accountsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(200);
    expectPrivateCache(res, 60);
  });

  test('401 anonymous: no cache headers', async () => {
    authMock.mockResolvedValue({ user: null, error: 'no session' });
    const res = createMockRes();
    await accountsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(401);
    expectNoCacheHeaders(res);
  });

  test('500 db error: no cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['social_accounts'] = { data: null, error: { message: 'db down' } };
    const res = createMockRes();
    await accountsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(500);
    expectNoCacheHeaders(res);
  });

  test('405 non-GET: no cache headers', async () => {
    const res = createMockRes();
    await accountsHandler(createApiRequestMock({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
    expectNoCacheHeaders(res);
  });
});

describe('GET /api/reports — P3 NEAR_LIVE (30 s)', () => {
  test('200 member: exact private cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['user_company_roles'] = { data: { company_id: 'company-1' }, error: null };
    reportsCardMock.mockResolvedValue({
      reports: [],
      domain: 'example.com',
      hasFreeReportUsed: false,
      hasGeneratingReport: false,
      reportState: 'available',
      canGenerateFreeReport: true,
    });
    const res = createMockRes();
    await reportsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(200);
    expectPrivateCache(res, 30);
  });

  test('401 anonymous: no cache headers', async () => {
    authMock.mockResolvedValue({ user: null, error: 'no session' });
    const res = createMockRes();
    await reportsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(401);
    expectNoCacheHeaders(res);
  });

  test('403 no membership: no cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['user_company_roles'] = { data: null, error: null };
    const res = createMockRes();
    await reportsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(403);
    expectNoCacheHeaders(res);
  });

  test('500 service failure: no cache headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
    mockTableResponses['user_company_roles'] = { data: { company_id: 'company-1' }, error: null };
    reportsCardMock.mockRejectedValue(new Error('boom'));
    const res = createMockRes();
    await reportsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(500);
    expectNoCacheHeaders(res);
  });
});

describe('GET /api/onboarding/journey — conditional P4/P3 (no-store in progress, 300 s complete)', () => {
  const journeyOf = (platformReady: boolean) => ({
    companyId: 'company-1',
    platformReady,
    stages: [],
  });

  test('200 in-progress journey: exactly private, no-store — never a max-age', async () => {
    authResolverMock.mockResolvedValue({ user: { id: 'user-1', emailVerified: true }, error: null });
    journeyMock.mockResolvedValue(journeyOf(false));
    const res = createMockRes();
    await journeyHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    const ccValues = (res.setHeader as jest.Mock).mock.calls
      .filter(([n]: [string]) => n === 'Cache-Control')
      .map(([, v]: [string, string]) => v);
    expect(ccValues).toEqual(['private, no-store']);
  });

  test('200 platformReady journey: exact P3 STABLE headers', async () => {
    authResolverMock.mockResolvedValue({ user: { id: 'user-1', emailVerified: true }, error: null });
    journeyMock.mockResolvedValue(journeyOf(true));
    const res = createMockRes();
    await journeyHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(200);
    expectPrivateCache(res, 300);
  });

  test('401 anonymous: no cache headers', async () => {
    authResolverMock.mockResolvedValue({ user: null, error: 'Invalid session' });
    const res = createMockRes();
    await journeyHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(401);
    expectNoCacheHeaders(res);
  });

  test('POST stage action: no cache headers', async () => {
    authResolverMock.mockResolvedValue({ user: { id: 'user-1', emailVerified: true }, error: null });
    journeyMock.mockResolvedValue(journeyOf(false));
    const { applyJourneyStageAction } = jest.requireMock('../../services/onboardingJourneyService');
    (applyJourneyStageAction as jest.Mock).mockResolvedValue({ ok: true });
    const res = createMockRes();
    await journeyHandler(
      createApiRequestMock({ method: 'POST', body: { stage: 'company', action: 'complete' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expectNoCacheHeaders(res);
  });
});

describe('GET /api/engagement/integrations — P3 STANDARD (60 s)', () => {
  test('200 member: exact private cache headers', async () => {
    enforceAccessMock.mockResolvedValue({ userId: 'user-1' });
    tokenPlatformsMock.mockResolvedValue(['linkedin']);
    activePlatformsMock.mockResolvedValue(['x']);
    const res = createMockRes();
    await integrationsHandler(
      createApiRequestMock({ query: { organization_id: 'company-1' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expectPrivateCache(res, 60);
  });

  test('400 missing org id: no cache headers, guard never called', async () => {
    const res = createMockRes();
    await integrationsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(400);
    expect(enforceAccessMock).not.toHaveBeenCalled();
    expectNoCacheHeaders(res);
  });

  test('403 denied by guard: no cache headers', async () => {
    denyCompanyAccessWith(403, 'FORBIDDEN');
    const res = createMockRes();
    await integrationsHandler(
      createApiRequestMock({ query: { organization_id: 'company-1' } }),
      res
    );
    expect(res.statusCode).toBe(403);
    expectNoCacheHeaders(res);
  });

  test('405 non-GET: no cache headers', async () => {
    const res = createMockRes();
    await integrationsHandler(
      createApiRequestMock({ method: 'POST', query: { organization_id: 'company-1' } }),
      res
    );
    expect(res.statusCode).toBe(405);
    expectNoCacheHeaders(res);
  });
});

describe('GET /api/social-platforms/content-type-prefs — P3 STANDARD (60 s)', () => {
  test('200 member: exact private cache headers', async () => {
    enforceAccessMock.mockResolvedValue({ userId: 'user-1' });
    mockTableResponses['company_profiles'] = {
      data: { platform_content_type_prefs: { linkedin: ['post'] } },
      error: null,
    };
    const res = createMockRes();
    await contentTypePrefsHandler(createApiRequestMock({ companyId: 'company-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ prefs: { linkedin: ['post'] } });
    expectPrivateCache(res, 60);
  });

  test('400 missing companyId: no cache headers', async () => {
    const res = createMockRes();
    await contentTypePrefsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(400);
    expectNoCacheHeaders(res);
  });

  test('401 denied by guard: no cache headers', async () => {
    denyCompanyAccessWith(401, 'UNAUTHORIZED');
    const res = createMockRes();
    await contentTypePrefsHandler(createApiRequestMock({ companyId: 'company-1' }), res);
    expect(res.statusCode).toBe(401);
    expectNoCacheHeaders(res);
  });

  test('500 db error: no cache headers', async () => {
    enforceAccessMock.mockResolvedValue({ userId: 'user-1' });
    mockTableResponses['company_profiles'] = { data: null, error: { message: 'db down' } };
    const res = createMockRes();
    await contentTypePrefsHandler(createApiRequestMock({ companyId: 'company-1' }), res);
    expect(res.statusCode).toBe(500);
    expectNoCacheHeaders(res);
  });

  test('PUT mutation (same URI as GET): no cache headers', async () => {
    enforceAccessMock.mockResolvedValue({ userId: 'user-1' });
    mockTableResponses['company_profiles'] = { data: null, error: null };
    const res = createMockRes();
    await contentTypePrefsHandler(
      createApiRequestMock({
        method: 'PUT',
        companyId: 'company-1',
        body: { prefs: { linkedin: ['post'] } },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    expectNoCacheHeaders(res);
  });
});

describe('GET /api/lead-intelligence/stats — P3 STANDARD (60 s)', () => {
  test('200 member: exact private cache headers', async () => {
    resolveUserContextMock.mockResolvedValue({ userId: 'user-1' });
    enforceAccessMock.mockResolvedValue({ userId: 'user-1' });
    leadStatsMock.mockResolvedValue({ total: 3, bySource: {}, byStatus: {} });
    const res = createMockRes();
    await leadStatsHandler(
      createApiRequestMock({ query: { company_id: 'company-1' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expectPrivateCache(res, 60);
  });

  test('401 anonymous: no cache headers', async () => {
    resolveUserContextMock.mockResolvedValue(null);
    const res = createMockRes();
    await leadStatsHandler(
      createApiRequestMock({ query: { company_id: 'company-1' } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expectNoCacheHeaders(res);
  });

  test('400 missing company_id: no cache headers', async () => {
    resolveUserContextMock.mockResolvedValue({ userId: 'user-1' });
    const res = createMockRes();
    await leadStatsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(400);
    expectNoCacheHeaders(res);
  });

  test('403 denied by guard: no cache headers', async () => {
    resolveUserContextMock.mockResolvedValue({ userId: 'user-1' });
    denyCompanyAccessWith(403, 'FORBIDDEN');
    const res = createMockRes();
    await leadStatsHandler(
      createApiRequestMock({ query: { company_id: 'company-1' } }),
      res
    );
    expect(res.statusCode).toBe(403);
    expectNoCacheHeaders(res);
  });

  test('405 non-GET: no cache headers', async () => {
    const res = createMockRes();
    await leadStatsHandler(
      createApiRequestMock({ method: 'POST', query: { company_id: 'company-1' } }),
      res
    );
    expect(res.statusCode).toBe(405);
    expectNoCacheHeaders(res);
  });
});
