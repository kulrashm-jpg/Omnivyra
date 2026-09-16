/**
 * STEP 3AH-91 SEC-E6 — upload-media-direct existence / content-type oracle.
 *
 * Before: the route loaded the `daily_content_plans` row BEFORE any
 * authentication, then checked the row's format, and only then called
 * enforceCompanyAccess. An anonymous caller could therefore tell an unknown id
 * (404 "Row not found") from an existing one (409 UPLOAD_NOT_VALID_FOR_FORMAT,
 * which also echoes the row's content_type) — and an authenticated member of
 * another company could read any row's content_type the same way.
 *
 * After: the caller is authenticated before any lookup (anonymous → 401 for
 * every id, no DB read), and the format checks run only after company access
 * is proven.
 */
const mockDbReads: string[] = [];
let mockRows: Record<string, unknown> = {};
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => { mockDbReads.push(table); return { data: mockRows[table] ?? null, error: null }; },
      };
      return api;
    },
    storage: { from: () => ({}), listBuckets: async () => ({ data: [] }), createBucket: async () => ({}) },
  },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
let mockUser: { id: string } | null = null;
let mockMember = false;
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => (mockUser
    ? { userId: mockUser.id, role: 'user', companyIds: [], defaultCompanyId: '', authenticated: true }
    : { userId: '', role: 'user', companyIds: [], defaultCompanyId: '', authenticated: false, authError: 'MISSING_AUTH' }),
  enforceCompanyAccess: async ({ res }: any) => {
    if (!mockUser) { res.status(401).json({ error: 'UNAUTHORIZED' }); return null; }
    if (!mockMember) { res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' }); return null; }
    return { userId: mockUser.id, companyId: 'co-a' };
  },
}));
const mockAbuseGate = jest.fn(async (..._a: unknown[]) => ({ allowed: false, reason: 'test_stop' }));
jest.mock('../../services/creatorUploadAbuseGuardService', () => ({
  checkUploadAttemptAllowed: (...a: unknown[]) => mockAbuseGate(...a),
  recordUploadSpoofAttempt: jest.fn(),
  recordUploadFailure: jest.fn(),
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(), CREATOR_EVENTS: {}, withTrace: (_t: unknown, fn: () => unknown) => fn(), newTraceId: () => 't',
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));
jest.mock('../../services/creator/creatorRowScheduler', () => ({ autoScheduleReadyCreatorRowById: jest.fn() }));

import handler from '../../../pages/api/activity-workspace/[id]/upload-media-direct';

async function call(id: string): Promise<{ status: number; body: any }> {
  const out = { status: 0, body: undefined as any };
  const res: any = {
    status(c: number) { out.status = c; return this; },
    json(b: unknown) { out.body = b; return this; },
    setHeader() { return this; }, getHeader() { return undefined; }, end() { return this; },
  };
  await handler({ method: 'POST', query: { id }, headers: {}, url: '/api/x' } as any, res);
  return out;
}

const INFOGRAPHIC_ROW = { id: 'plan-1', campaign_id: 'camp-a', content_type: 'infographic', content: {}, content_status: null, platform: 'linkedin' };

beforeEach(() => {
  mockDbReads.length = 0;
  mockRows = {};
  mockUser = null;
  mockMember = false;
  mockAbuseGate.mockClear();
});

describe('anonymous callers learn nothing', () => {
  it('existing and unknown ids both answer 401, with no database read', async () => {
    mockRows = { daily_content_plans: INFOGRAPHIC_ROW, campaigns: { company_id: 'co-a' } };
    const existing = await call('plan-1');
    mockRows = {};
    const unknown = await call('does-not-exist');
    expect(existing.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(JSON.stringify(existing.body)).not.toContain('infographic');
    expect(mockDbReads).toEqual([]);
  });
});

describe('authenticated non-members cannot read a row\'s format', () => {
  it('a foreign row answers 403 without echoing content_type', async () => {
    mockUser = { id: 'user-b' };
    mockRows = { daily_content_plans: INFOGRAPHIC_ROW, campaigns: { company_id: 'co-a' } };
    const out = await call('plan-1');
    expect(out.status).toBe(403);
    expect(JSON.stringify(out.body)).not.toContain('infographic');
  });
});

describe('members keep the existing behaviour', () => {
  it('an autonomous-only format is still refused with 409 before any upload work', async () => {
    mockUser = { id: 'user-a' };
    mockMember = true;
    mockRows = { daily_content_plans: INFOGRAPHIC_ROW, campaigns: { company_id: 'co-a' } };
    const out = await call('plan-1');
    expect(out.status).toBe(409);
    expect(out.body.code).toBe('UPLOAD_NOT_VALID_FOR_FORMAT');
    expect(mockAbuseGate).not.toHaveBeenCalled();
  });
  it('an unknown id is 404 for an authenticated caller', async () => {
    mockUser = { id: 'user-a' };
    const out = await call('missing');
    expect(out.status).toBe(404);
  });
});
