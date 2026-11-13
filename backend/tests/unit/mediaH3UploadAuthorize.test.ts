/**
 * MEDIA-H3 — POST /api/activity-workspace/[id]/upload-media-authorize: the
 * only credential a browser gets for upload bytes is a signed token for ONE
 * server-minted key in the PRIVATE quarantine bucket, after authentication and
 * tenant authorization.
 */
// PC5-4: creator uploads are off by default; these suites test the enabled path.
process.env.CREATOR_MEDIA_UPLOADS_ENABLED = 'true';

import { createMemoryStorage } from '../helpers/memoryStorage';

const mockMem = createMemoryStorage(['media-uploads']);
let mockRows: Record<string, any> = {};
const mockDbReads: string[] = [];
let mockUser: { id: string } | null = { id: 'user-a' };
let mockAuthorized = true;
let mockRate: any = { allowed: true };

// Campaign WRITE role guard (2026-11-13): this suite's caller is an authorized WRITER; the role gate itself is
// covered by campaignWriteRoles.test.ts. Only enforceCampaignWriteRole is stubbed; the pure decision stays real.
jest.mock('../../services/campaignWriteRole', () => ({
  ...jest.requireActual('../../services/campaignWriteRole'),
  enforceCampaignWriteRole: async () => true,
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      mockDbReads.push(table);
      const api: any = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: mockRows[table] ?? null, error: null }) };
      return api;
    },
    storage: { from: (b: string) => mockMem.storage.from(b) },
  },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: mockUser, error: null })),
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res, companyId }: any) => {
    if (!mockAuthorized) { res.status(403).json({ error: 'FORBIDDEN' }); return null; }
    return { userId: 'user-a', companyId };
  }),
}));
jest.mock('../../services/creatorUploadAbuseGuardService', () => ({
  checkUploadAttemptAllowed: jest.fn(async () => mockRate),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/activity-workspace/[id]/upload-media-authorize';
import { isActivityObjectPath } from '../../services/activityWorkspace/activityObjectPath';

function res() {
  const r: any = { statusCode: 200, body: null, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
async function authorize(body: Record<string, unknown>, method = 'POST') {
  const r = res();
  await (handler as any)({ method, query: { id: 'plan-a' }, body, headers: {} }, r);
  return r;
}

beforeEach(() => {
  mockMem.reset();
  mockDbReads.length = 0;
  mockRows = {
    daily_content_plans: { id: 'plan-a', campaign_id: 'camp-a', content_type: 'reel' },
    campaigns: { company_id: 'company-a' },
  };
  mockUser = { id: 'user-a' };
  mockAuthorized = true;
  mockRate = { allowed: true };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('issues a no-overwrite signed token for a server-minted key in the PRIVATE quarantine bucket', async () => {
  const r = await authorize({ mime_type: 'video/mp4', size_bytes: 1234 });
  expect(r.statusCode).toBe(200);
  expect(r.headers['Cache-Control']).toBe('no-store');
  expect(r.body.bucket).toBe('media-quarantine');
  expect(r.body.resumable_endpoint).toBe('/storage/v1/upload/resumable/sign');
  expect(r.body.object_path).toMatch(/^company-a\/plan-a\/video\/\d+-[0-9a-f]{32}\.mp4$/);
  expect(isActivityObjectPath(r.body.object_path, 'plan-a', 'company-a')).toBe(true);
  expect(r.body.token).toBe(`tok:media-quarantine:${r.body.object_path}`);
  expect(mockMem.events).toEqual([`sign-upload:media-quarantine:${r.body.object_path}:upsert=false`]);
});

it('every authorization is a fresh key (single-use per upload)', async () => {
  const a = await authorize({ mime_type: 'video/mp4', size_bytes: 1 });
  const b = await authorize({ mime_type: 'video/mp4', size_bytes: 1 });
  expect(a.body.object_path).not.toBe(b.body.object_path);
});

it('caller-supplied bucket / key / company are ignored', async () => {
  const r = await authorize({
    mime_type: 'video/mp4', size_bytes: 1, bucket: 'media-uploads', bucketName: 'media-uploads',
    object_path: 'company-b/plan-b/video/x.mp4', storage_path: 'company-b/x.mp4', company_id: 'company-b',
  });
  expect(r.body.bucket).toBe('media-quarantine');
  expect(r.body.object_path.startsWith('company-a/plan-a/')).toBe(true);
  expect(mockMem.events.every((e) => e.startsWith('sign-upload:media-quarantine:company-a/plan-a/'))).toBe(true);
});

it('unauthenticated → 401 before any DB read or storage call', async () => {
  mockUser = null;
  const r = await authorize({ mime_type: 'video/mp4', size_bytes: 1 });
  expect(r.statusCode).toBe(401);
  expect(mockDbReads).toEqual([]);
  expect(mockMem.events).toEqual([]);
});

it('member of another company → 403, no token minted', async () => {
  mockAuthorized = false;
  const r = await authorize({ mime_type: 'video/mp4', size_bytes: 1 });
  expect(r.statusCode).toBe(403);
  expect(mockMem.events).toEqual([]);
});

it.each([
  ['image/tiff for a reel', 'image/tiff', 415],
  ['text/html', 'text/html', 415],
  ['image/svg+xml', 'image/svg+xml', 415],
  ['audio for a reel (wrong category)', 'audio/mpeg', 415],
  ['unlisted video subtype', 'video/x-matroska', 415],
])('%s → %i, no token', async (_n, mime, status) => {
  const r = await authorize({ mime_type: mime, size_bytes: 1 });
  expect(r.statusCode).toBe(status);
  expect(mockMem.events).toEqual([]);
});

it('non-attachment format → 409; oversize → 413; missing fields → 400; GET → 405', async () => {
  mockRows.daily_content_plans.content_type = 'post';
  expect((await authorize({ mime_type: 'video/mp4', size_bytes: 1 })).statusCode).toBe(409);
  mockRows.daily_content_plans.content_type = 'reel';
  expect((await authorize({ mime_type: 'video/mp4', size_bytes: 3 * 1024 ** 3 })).statusCode).toBe(413);
  expect((await authorize({ size_bytes: 1 })).statusCode).toBe(400);
  expect((await authorize({ mime_type: 'video/mp4' })).statusCode).toBe(400);
  expect((await authorize({}, 'GET')).statusCode).toBe(405);
  expect(mockMem.events).toEqual([]);
});

it('rate-limited → 429; token minting failure → 503', async () => {
  mockRate = { allowed: false, reason: 'rate_limited', retry_after_seconds: 30 };
  expect((await authorize({ mime_type: 'video/mp4', size_bytes: 1 })).statusCode).toBe(429);
  expect(mockMem.events).toEqual([]);
  mockRate = { allowed: true };
  mockMem.faults.sign = 'boom';
  const r = await authorize({ mime_type: 'video/mp4', size_bytes: 1 });
  expect(r.statusCode).toBe(503);
  expect(r.body.token).toBeUndefined();
});

describe('PC5-4 upload gate (CREATOR_MEDIA_UPLOADS_ENABLED)', () => {
  afterEach(() => { process.env.CREATOR_MEDIA_UPLOADS_ENABLED = 'true'; });

  it('disabled → 503 UPLOADS_UNAVAILABLE, non-retryable, before any DB read or token', async () => {
    delete process.env.CREATOR_MEDIA_UPLOADS_ENABLED;
    const r = await authorize({ mime_type: 'video/mp4', size_bytes: 1234 });
    expect(r.statusCode).toBe(503);
    expect(r.body).toEqual(expect.objectContaining({ code: 'UPLOADS_UNAVAILABLE', retryable: false }));
    expect(r.body.token).toBeUndefined();
    expect(mockDbReads).toEqual([]);
    expect(mockMem.events).toEqual([]);
  });

  it('disabled + unauthenticated → still 401 first', async () => {
    delete process.env.CREATOR_MEDIA_UPLOADS_ENABLED;
    mockUser = null;
    expect((await authorize({ mime_type: 'video/mp4', size_bytes: 1 })).statusCode).toBe(401);
  });

  it.each(['false', '1', 'TRUE', 'yes', ''])('only the exact value "true" enables (%p → 503)', async (v) => {
    process.env.CREATOR_MEDIA_UPLOADS_ENABLED = v;
    expect((await authorize({ mime_type: 'video/mp4', size_bytes: 1 })).statusCode).toBe(503);
    expect(mockMem.events).toEqual([]);
  });
});

export {};
