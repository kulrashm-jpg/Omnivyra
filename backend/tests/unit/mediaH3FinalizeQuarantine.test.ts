/**
 * MEDIA-H3 — upload-media-finalize: quarantine → validate → promote.
 *
 * Route-level tests with an in-memory storage stand-in that distinguishes the
 * PRIVATE quarantine bucket from the PUBLIC delivery bucket. The assertions are
 * about exposure: which bytes ever exist in `media-uploads`, and what the row
 * records.
 */
import { createMemoryStorage, MP4, TIFF_LE, RANDOM, HTML } from '../helpers/memoryStorage';

const mockMem = createMemoryStorage(['media-uploads']);
let mockRows: Record<string, any> = {};
const mockWrites: Array<Record<string, any>> = [];
let mockWriteError: { message: string } | null = null;
let mockUser: { id: string } | null = { id: 'user-a' };
let mockAuthorized = true;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: mockRows[table] ?? null, error: null }),
      };
      return api;
    },
    storage: { from: (b: string) => mockMem.storage.from(b) },
  },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    let payload: any = null;
    const api: any = {
      update: (p: any) => { payload = p; return api; },
      eq: () => api,
      then(resolve: any) {
        if (payload && !mockWriteError) mockWrites.push(payload);
        return Promise.resolve({ data: null, error: mockWriteError }).then(resolve);
      },
    };
    return api;
  },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: mockUser, error: null })),
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res }: any) => {
    if (!mockAuthorized) { res.status(403).json({ error: 'FORBIDDEN' }); return null; }
    return { userId: 'user-a', companyId: 'company-a' };
  }),
}));
jest.mock('../../services/creator/creatorRowScheduler', () => ({
  autoScheduleReadyCreatorRowById: jest.fn(async () => ({ status: 'skipped', scheduledPostId: null })),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/activity-workspace/[id]/upload-media-finalize';

const KEY = 'company-a/plan-a/video/1700000000000-0123456789abcdef0123456789abcdef.mp4';
const KEY2 = 'company-a/plan-a/video/1700000000001-fedcba9876543210fedcba9876543210.mp4';
const Q = 'media-quarantine';
const D = 'media-uploads';
const realFetch = (global as any).fetch;

function row(content: Record<string, unknown> = {}) {
  return {
    id: 'plan-a', campaign_id: 'camp-a', content_type: 'reel', platform: 'instagram', content_status: 'awaiting_media_upload',
    content: { creator_lifecycle_state: 'awaiting_media_upload', creator_lifecycle_history: [{ to: 'awaiting_media_upload' }], ...content },
  };
}
function res() {
  const r: any = { statusCode: 200, body: null, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
async function finalize(body: Record<string, unknown>) {
  const r = res();
  await (handler as any)({ method: 'POST', query: { id: 'plan-a' }, body, headers: {} }, r);
  return r;
}
const body = (over: Record<string, unknown> = {}) => ({ storage_path: KEY, mime_type: 'video/mp4', size_bytes: MP4.length, upload_session_id: 's1', ...over });
const deliveryKeys = () => [...mockMem.objects.keys()].filter((k) => k.startsWith(`${D}/`));

beforeEach(() => {
  mockMem.reset();
  mockRows = { daily_content_plans: row(), campaigns: { company_id: 'company-a' } };
  mockWrites.length = 0;
  mockWriteError = null;
  mockUser = { id: 'user-a' };
  mockAuthorized = true;
  (global as any).fetch = jest.fn(mockMem.fetchImpl);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

describe('happy path', () => {
  it('validates the quarantined bytes, promotes them, and records ONLY the server-derived delivery reference', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    const r = await finalize(body({ uploaded_media_url: 'https://evil.example/x.mp4', media_url: 'https://evil.example/y' }));
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.storage).toEqual({ bucket: D, object_path: KEY });
    expect(mockMem.has(D, KEY)).toBe(true);
    expect(mockMem.has(Q, KEY)).toBe(false);
    const content = JSON.parse(mockWrites[0].content);
    expect(content.uploaded_media_url).toBe(`https://storage.test/storage/v1/object/public/${D}/${KEY}`);
    expect(content.upload_quarantine_promoted).toBe(true);
    expect(content.upload_consumed_object_paths).toEqual([KEY]);
    expect(content.uploaded_size_bytes).toBe(MP4.length);
    // Validation (info + signed read) strictly precedes the move.
    const firstMove = mockMem.events.findIndex((e) => e.startsWith('move:'));
    expect(mockMem.events.findIndex((e) => e.startsWith(`info:${Q}:`))).toBeLessThan(firstMove);
    expect(mockMem.events.findIndex((e) => e.startsWith(`sign:${Q}:`))).toBeLessThan(firstMove);
  });
  it('size recorded is the STORED size, not the client claim', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    await finalize(body({ size_bytes: 7 }));
    expect(JSON.parse(mockWrites[0].content).uploaded_size_bytes).toBe(MP4.length);
  });
});

describe('invalid bytes never become public', () => {
  it.each([
    ['TIFF declared video/mp4', TIFF_LE, 'video/mp4'],
    ['random bytes declared video/mp4', RANDOM, 'video/mp4'],
    ['mp4 bytes with stored Content-Type text/html', MP4, 'text/html'],
    ['HTML with stored Content-Type video/mp4', HTML, 'video/mp4'],
  ])('%s → 415, deleted from quarantine, delivery untouched, row untouched', async (_n, bytes, storedType) => {
    mockMem.put(Q, KEY, bytes, storedType);
    const r = await finalize(body());
    expect(r.statusCode).toBe(415);
    expect(mockMem.has(Q, KEY)).toBe(false);
    expect(deliveryKeys()).toEqual([]);
    expect(mockMem.events.some((e) => e.startsWith('move:'))).toBe(false);
    expect(mockWrites).toEqual([]);
  });
  it('upload completed but finalize never called → nothing in the public bucket', () => {
    mockMem.put(Q, KEY, TIFF_LE, 'video/mp4');
    expect(deliveryKeys()).toEqual([]);
    expect(mockMem.serve(`https://storage.test/storage/v1/object/public/${Q}/${KEY}`).status).not.toBe(200);
  });
  it('validation failure, then a retry with a NEW authorized upload succeeds', async () => {
    mockMem.put(Q, KEY, TIFF_LE, 'video/mp4');
    expect((await finalize(body())).statusCode).toBe(415);
    mockMem.put(Q, KEY2, MP4, 'video/mp4');
    const r = await finalize(body({ storage_path: KEY2, upload_session_id: 's2' }));
    expect(r.statusCode).toBe(200);
    expect(deliveryKeys()).toEqual([`${D}/${KEY2}`]);
  });
  it('missing quarantined object → 404, nothing deleted', async () => {
    const r = await finalize(body());
    expect(r.statusCode).toBe(404);
    expect(mockMem.events.some((e) => e.startsWith('remove:'))).toBe(false);
  });
});

describe('authorization and scope (no storage access before both pass)', () => {
  it('unauthenticated → 401, zero storage calls', async () => {
    mockUser = null;
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    expect((await finalize(body())).statusCode).toBe(401);
    expect(mockMem.events).toEqual([]);
  });
  it('member of another company → 403, zero storage calls, object untouched', async () => {
    mockAuthorized = false;
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    expect((await finalize(body())).statusCode).toBe(403);
    expect(mockMem.events).toEqual([]);
    expect(mockMem.has(Q, KEY)).toBe(true);
  });
  it('another tenant\'s quarantined key → 400 out of scope, zero storage calls', async () => {
    const victim = 'company-b/plan-b/video/1700000000000-0123456789abcdef0123456789abcdef.mp4';
    mockMem.put(Q, victim, MP4, 'video/mp4');
    const r = await finalize(body({ storage_path: victim }));
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('UPLOAD_PATH_OUT_OF_SCOPE');
    expect(mockMem.events).toEqual([]);
    expect(mockMem.has(Q, victim)).toBe(true);
  });
});

describe('idempotency, replay and failure safety', () => {
  it('duplicate finalize of a promoted session → 200 idempotent, no second move, no row write', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    expect((await finalize(body())).statusCode).toBe(200);
    const promotedContent = JSON.parse(mockWrites[0].content);
    mockRows.daily_content_plans = { ...row(), content: promotedContent, content_status: 'ready_for_schedule' };
    mockWrites.length = 0;
    mockMem.events.length = 0;
    const r = await finalize(body());
    expect(r.statusCode).toBe(200);
    expect(r.body.idempotent_replay).toBe(true);
    expect(mockMem.events.some((e) => e.startsWith('move:'))).toBe(false);
    expect(mockWrites).toEqual([]);
  });
  it('replaying a still-valid token to the consumed key: the re-upload is dropped, never promoted', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    await finalize(body());
    mockRows.daily_content_plans = { ...row(), content: JSON.parse(mockWrites[0].content), content_status: 'ready_for_schedule' };
    mockMem.put(Q, KEY, TIFF_LE, 'video/mp4'); // attacker re-uses the token after the move freed the key
    const r = await finalize(body());
    expect(r.statusCode).toBe(200);
    expect(mockMem.has(Q, KEY)).toBe(false);
    expect(mockMem.objects.get(`${D}/${KEY}`)?.bytes.equals(MP4)).toBe(true);
  });
  it('an older, replaced session → 409 UPLOAD_SESSION_CONSUMED, never promoted', async () => {
    mockRows.daily_content_plans = row({
      creator_lifecycle_state: 'ready_for_schedule', upload_quarantine_promoted: true, upload_storage_bucket: D,
      upload_storage_object_path: KEY2, upload_consumed_object_paths: [KEY, KEY2],
    });
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    const r = await finalize(body());
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('UPLOAD_SESSION_CONSUMED');
    expect(mockMem.has(Q, KEY)).toBe(false);
    expect(mockMem.has(D, KEY)).toBe(false);
  });
  it('promotion failure → 503 retryable, object stays private, row untouched; retry succeeds', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockMem.faults.move = 'storage unavailable';
    const r = await finalize(body());
    expect(r.statusCode).toBe(503);
    expect(r.body.code).toBe('UPLOAD_PROMOTION_FAILED');
    expect(mockMem.has(Q, KEY)).toBe(true);
    expect(deliveryKeys()).toEqual([]);
    expect(mockWrites).toEqual([]);
    delete mockMem.faults.move;
    expect((await finalize(body())).statusCode).toBe(200);
    expect(mockMem.has(D, KEY)).toBe(true);
  });
  it('transient inspect failure → 503, object kept for retry', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockMem.faults.info = 'timeout';
    expect((await finalize(body())).statusCode).toBe(503);
    expect(mockMem.has(Q, KEY)).toBe(true);
  });
  it('DB write failure after promotion → delivery object rolled back out of the public bucket', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockWriteError = { message: 'write failed' };
    const r = await finalize(body());
    expect(r.statusCode).toBe(500);
    expect(deliveryKeys()).toEqual([]);
  });
});

// H-3 independent review (Agent A) — concurrency cases added by the reviewer (not independently reviewed).
describe('concurrent finalize of the same session (review additions)', () => {
  it('two concurrent finalizes: both succeed, exactly one delivery object, no 503 for the loser', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    const [a, b] = await Promise.all([finalize(body()), finalize(body())]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(deliveryKeys()).toEqual([`${D}/${KEY}`]);
    expect(mockMem.has(Q, KEY)).toBe(false);
  });
  it('DB write failure in the request that found the session ALREADY promoted does not delete the winner\'s public object', async () => {
    // The winner promoted and recorded the row; this request still saw the pre-promotion row.
    mockMem.put(D, KEY, MP4, 'video/mp4');
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockWriteError = { message: 'write failed' };
    const r = await finalize(body());
    expect(r.statusCode).toBe(500);
    expect(mockMem.has(D, KEY)).toBe(true);
    expect(mockMem.has(Q, KEY)).toBe(false);
  });
});

export {};
