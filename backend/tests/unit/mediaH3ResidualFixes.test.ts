/**
 * H3-FIX - regression tests for the residuals found by the independent H-3
 * review (Agent F, branch review/f-h3-independent db727dea,
 * backend/tests/unit/reviewFH3Residuals.test.ts). The reviewer's repro tests
 * asserted the VULNERABLE behaviour; these are the same scenarios with the
 * assertions inverted to the fixed behaviour, plus the related fixes.
 *
 *   F-H3-1 / J3-1  planted delivery object adopted through a concurrent self-discard
 *   F-H3-2         stored content type not bound to the key minted at authorize
 *   F-H3-5 / J3-4  no-stream truncate fallback buffered a body far above the limit
 *   F-H3-6         finalize row write had no compare-and-swap
 *   F-H3-8         raw database error message returned to the client
 *
 * Harness copied from mediaH3FinalizeQuarantine.test.ts (in-memory storage that
 * separates the private quarantine bucket from the public delivery bucket).
 */
import { createMemoryStorage, MP4 } from '../helpers/memoryStorage';

const mockMem = createMemoryStorage(['media-uploads']);
let mockRows: Record<string, any> = {};
const mockWrites: Array<Record<string, any>> = [];
const mockWriteFilters: Array<Array<[string, string, unknown]>> = [];
let mockWriteError: { message: string } | null = null;
let mockWriteCount: number | undefined;
let mockOnWrite: (() => void) | null = null;
let mockUser: { id: string } | null = { id: 'user-a' };

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
    const filters: Array<[string, string, unknown]> = [];
    const api: any = {
      update: (p: any) => { payload = p; return api; },
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push(['is', c, v]); return api; },
      then(resolve: any) {
        if (mockOnWrite) mockOnWrite();
        mockWriteFilters.push(filters);
        const lost = mockWriteCount === 0;
        if (payload && !mockWriteError && !lost) mockWrites.push(payload);
        return Promise.resolve({ data: null, error: mockWriteError, count: mockWriteCount }).then(resolve);
      },
    };
    return api;
  },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: mockUser, error: null })),
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-a', companyId: 'company-a' })),
}));
jest.mock('../../services/creator/creatorRowScheduler', () => ({
  autoScheduleReadyCreatorRowById: jest.fn(async () => ({ status: 'skipped', scheduledPostId: null })),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/activity-workspace/[id]/upload-media-finalize';
import {
  mintQuarantineObjectPath,
  authorizedMimeForObjectPath,
  QUARANTINE_ALLOWED_MIME_TYPES,
} from '../../services/activityWorkspace/quarantinedMediaUpload';
import { readBodyBounded } from '../../../lib/security/boundedBodyRead';

const KEY = 'company-a/plan-a/video/1700000000000-0123456789abcdef0123456789abcdef.mp4';
const Q = 'media-quarantine';
const D = 'media-uploads';
const realFetch = (global as any).fetch;

function row(content: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id: 'plan-a', campaign_id: 'camp-a', content_type: 'reel', platform: 'instagram', content_status: 'awaiting_media_upload',
    content: { creator_lifecycle_state: 'awaiting_media_upload', creator_lifecycle_history: [{ to: 'awaiting_media_upload' }], ...content },
    ...extra,
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
const committedRow = () => row({
  creator_lifecycle_state: 'ready_for_schedule', upload_quarantine_promoted: true,
  upload_storage_bucket: D, upload_storage_object_path: KEY, upload_consumed_object_paths: [KEY],
  uploaded_media_url: `https://example.test/storage/v1/object/public/${D}/${KEY}`, uploaded_mime_type: 'video/mp4',
});
/** Planted object: same length and same first 32 bytes as MP4, HTML tail. */
function plantedLikeMp4(): Buffer {
  const tail = Buffer.from('<html><script>x</script>'.padEnd(MP4.length - 32, ' ')).subarray(0, MP4.length - 32);
  return Buffer.concat([MP4.subarray(0, 32), tail]);
}
/** Runs `before` once, just before the next quarantine move. */
function beforeNextMove(before: () => Promise<void> | void) {
  const origFrom = mockMem.storage.from;
  (mockMem.storage as any).from = (b: string) => {
    const api: any = origFrom(b);
    if (b !== Q) return api;
    return {
      ...api,
      async move(...a: any[]) {
        (mockMem.storage as any).from = origFrom;
        await before();
        return origFrom(Q).move(a[0], a[1], a[2]);
      },
    };
  };
  return () => { (mockMem.storage as any).from = origFrom; };
}

beforeEach(() => {
  mockMem.reset();
  mockRows = { daily_content_plans: row(), campaigns: { company_id: 'company-a' } };
  mockWrites.length = 0;
  mockWriteFilters.length = 0;
  mockWriteError = null;
  mockWriteCount = undefined;
  mockOnWrite = null;
  mockUser = { id: 'user-a' };
  (global as any).fetch = jest.fn(mockMem.fetchImpl);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

describe('F-H3-1 FIXED (J3-1): a planted delivery object is never adopted', () => {
  it('reviewer repro inverted: a concurrent wrong-category finalize no longer deletes the source, the honest finalize refuses the plant (409), nothing recorded', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const P = plantedLikeMp4();
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockMem.put(D, KEY, P, 'video/mp4');
    let r2: any = null;
    const restore = beforeNextMove(async () => { r2 = await finalize(body({ mime_type: 'audio/mpeg' })); });
    try {
      const r1 = await finalize(body());
      expect(r2.statusCode).toBe(415);
      expect(r1.statusCode).toBe(409);
      expect(r1.body.code).toBe('UPLOAD_DELIVERY_CONFLICT');
      expect(mockWrites).toEqual([]);
      expect(mockMem.has(Q, KEY)).toBe(true); // R2 did not delete it
      expect(mockMem.objects.get(`${D}/${KEY}`)!.bytes.equals(P)).toBe(true);
    } finally {
      restore();
    }
  });

  it('source removed by any other means + plant with identical size/type/head -> 503 UPLOAD_PROMOTION_UNCONFIRMED, nothing recorded or scheduled, plant untouched', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { autoScheduleReadyCreatorRowById } = jest.requireMock('../../services/creator/creatorRowScheduler');
    (autoScheduleReadyCreatorRowById as jest.Mock).mockClear();
    const P = plantedLikeMp4();
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockMem.put(D, KEY, P, 'video/mp4');
    const restore = beforeNextMove(() => { mockMem.objects.delete(`${Q}/${KEY}`); });
    try {
      const r = await finalize(body());
      expect(r.statusCode).toBe(503);
      expect(r.body).toMatchObject({ code: 'UPLOAD_PROMOTION_UNCONFIRMED', retryable: true });
      expect(r.body.success).toBeUndefined();
      expect(mockWrites).toEqual([]);
      expect(autoScheduleReadyCreatorRowById).not.toHaveBeenCalled();
      expect(mockMem.objects.get(`${D}/${KEY}`)!.bytes.equals(P)).toBe(true);
      expect(mockMem.events.some((e) => e.startsWith(`remove:${D}:`))).toBe(false);
      expect(errSpy.mock.calls.some((c) => (c[1] as any)?.event === 'media_h3_delivery_unproven')).toBe(true);
    } finally {
      restore();
    }
  });

  it('honest same-session race: the loser accepts the key only on the winner\'s committed row (200 idempotent replay, no row write of its own)', async () => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    const restore = beforeNextMove(async () => {
      await mockMem.storage.from(Q).move(KEY, KEY, { destinationBucket: D }); // winner's move
      mockRows.daily_content_plans = committedRow(); // winner's committed row
    });
    try {
      const r = await finalize(body());
      expect(r.statusCode).toBe(200);
      expect(r.body).toMatchObject({ success: true, idempotent_replay: true });
      expect(mockWrites).toEqual([]);
      expect(mockMem.objects.get(`${D}/${KEY}`)!.bytes.equals(MP4)).toBe(true);
    } finally {
      restore();
    }
  });

  it.each([
    ['declared size over the cap (413)', { size_bytes: 5 * 1024 * 1024 * 1024 }, 413],
    ['declared type in the wrong category (415)', { mime_type: 'audio/mpeg' }, 415],
    ['declared type not the authorized one (415)', { mime_type: 'video/webm' }, 415],
    ['stale expected_revision (409)', { expected_revision: 99 }, 409],
  ])('caller-controlled exit keeps the quarantined object: %s', async (_n, over, status) => {
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    const r = await finalize(body(over as Record<string, unknown>));
    expect(r.statusCode).toBe(status);
    expect(mockMem.has(Q, KEY)).toBe(true);
    expect(mockMem.events.some((e) => e.startsWith(`remove:${Q}:`))).toBe(false);
    expect(mockMem.has(D, KEY)).toBe(false);
    expect(mockWrites).toEqual([]);
  });
});

describe('F-H3-2 FIXED: the stored type is bound to the key minted at authorize', () => {
  it('reviewer repro inverted: a key minted for video/mp4 cannot be published as video/webm', async () => {
    const minted = mintQuarantineObjectPath({ companyId: 'company-a', activityId: 'plan-a', mime: 'video/mp4' }).objectPath;
    const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(44, 7)]);
    mockMem.put(Q, minted, WEBM, 'video/webm');
    const r = await finalize(body({ storage_path: minted, mime_type: 'video/webm', size_bytes: WEBM.length }));
    expect(r.statusCode).toBe(415);
    expect(r.body.code).toBe('UPLOAD_TYPE_NOT_AUTHORIZED');
    expect(mockMem.has(D, minted)).toBe(false);
    expect(mockWrites).toEqual([]);
  });

  it('the matching type still finalizes', async () => {
    const minted = mintQuarantineObjectPath({ companyId: 'company-a', activityId: 'plan-a', mime: 'video/webm' }).objectPath;
    const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(44, 7)]);
    mockMem.put(Q, minted, WEBM, 'video/webm');
    const r = await finalize(body({ storage_path: minted, mime_type: 'video/webm', size_bytes: WEBM.length }));
    expect(r.statusCode).toBe(200);
    expect(mockMem.objects.get(`${D}/${minted}`)!.contentType).toBe('video/webm');
  });

  it('every allowlisted type round-trips through the minted key; foreign keys bind to nothing', () => {
    for (const mime of QUARANTINE_ALLOWED_MIME_TYPES) {
      const { objectPath } = mintQuarantineObjectPath({ companyId: 'c', activityId: 'a', mime });
      expect(authorizedMimeForObjectPath(objectPath)).toBe(mime);
    }
    expect(authorizedMimeForObjectPath('c/a/video/x.html')).toBeNull();
    expect(authorizedMimeForObjectPath('c/a/image/x.mp4')).toBeNull();
    expect(authorizedMimeForObjectPath('c/a/video/noext')).toBeNull();
    expect(authorizedMimeForObjectPath('')).toBeNull();
  });
});

describe('F-H3-5 FIXED (J3-4): the no-stream fallback never buffers beyond the limit', () => {
  it('reviewer repro inverted: a declared 10 MiB body with limit 32 is refused without calling arrayBuffer()', async () => {
    const arrayBuffer = jest.fn(async () => new ArrayBuffer(10 * 1024 * 1024));
    const r = await readBodyBounded({ body: null, arrayBuffer, headers: { get: () => String(10 * 1024 * 1024) } }, 32, 'truncate');
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, reason: 'read_failed' });
  });
  it('a declared length within the limit is still read', async () => {
    const r = await readBodyBounded({ body: null, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => '3' } }, 32, 'truncate');
    expect(r.ok).toBe(true);
  });
  it('a body larger than the limit despite a small declared length is refused (truncate and fail)', async () => {
    const big = async () => new ArrayBuffer(64);
    expect(await readBodyBounded({ body: null, arrayBuffer: big, headers: { get: () => '3' } }, 32, 'truncate')).toEqual({ ok: false, reason: 'read_failed' });
    expect(await readBodyBounded({ body: null, arrayBuffer: big, headers: { get: () => '3' } }, 32, 'fail')).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('F-H3-6 FIXED: the finalize row write is a compare-and-swap', () => {
  it('the write is filtered on the updated_at read at the start', async () => {
    mockRows.daily_content_plans = row({}, { updated_at: '2026-11-01T00:00:00.000000+00:00' });
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    const r = await finalize(body());
    expect(r.statusCode).toBe(200);
    expect(mockWriteFilters[mockWriteFilters.length - 1]).toEqual([['eq', 'id', 'plan-a'], ['eq', 'updated_at', '2026-11-01T00:00:00.000000+00:00']]);
  });
  it('lost CAS (0 rows matched) -> 409 CONCURRENT_UPLOAD_CONFLICT and this request\'s promoted object is rolled back', async () => {
    mockRows.daily_content_plans = row({}, { updated_at: '2026-11-01T00:00:00.000000+00:00' });
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockWriteCount = 0;
    const r = await finalize(body());
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('CONCURRENT_UPLOAD_CONFLICT');
    expect(mockMem.has(D, KEY)).toBe(false);
    expect(mockWrites).toEqual([]);
  });
  it('a NULL updated_at is matched with IS NULL', async () => {
    mockRows.daily_content_plans = row({}, { updated_at: null });
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    expect((await finalize(body())).statusCode).toBe(200);
    expect(mockWriteFilters[mockWriteFilters.length - 1]).toContainEqual(['is', 'updated_at', null]);
  });
});

describe('F-H3-8 FIXED: no raw database error in the response', () => {
  it('row write failure -> 500 UPLOAD_RECORD_FAILED without the database message', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMem.put(Q, KEY, MP4, 'video/mp4');
    mockWriteError = { message: 'permission denied for relation secret_internal_table' };
    const r = await finalize(body());
    expect(r.statusCode).toBe(500);
    expect(r.body.code).toBe('UPLOAD_RECORD_FAILED');
    expect(JSON.stringify(r.body)).not.toContain('secret_internal_table');
  });
});
