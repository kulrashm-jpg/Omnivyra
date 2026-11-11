/**
 * Tests for /api/activity-workspace/[id]/upload-media-finalize.
 *
 *   - happy path: storage_path + good MIME → media_uploaded → ready_for_schedule
 *   - missing required fields → 400
 *   - non-attachment-required row → 409, orphan cleanup
 *   - MIME mismatch with expected category → 415, object KEPT (H3-FIX F-H3-1)
 *   - oversize (declared) → 413, object KEPT (H3-FIX F-H3-1)
 *   - concurrency conflict → 409, object KEPT (H3-FIX F-H3-1)
 *
 * H3-FIX (F-H3-1 / J3-1): exits decided by the request alone (declared type,
 * declared size, expected_revision) no longer delete the quarantined object, so
 * a second bad finalize cannot remove the source under an honest in-flight one.
 */

// PC5-4: creator uploads are off by default; these suites test the enabled path.
process.env.CREATOR_MEDIA_UPLOADS_ENABLED = 'true';

function createRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    status: jest.fn(function status(this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function json(this: any, body: unknown) { this.body = body; return this; }),
    setHeader: jest.fn(),
  };
}

let supabaseRows: Record<string, unknown> = {};
const storageCalls = { upload: [] as any[], remove: [] as string[][], download: [] as string[], move: [] as any[] };
// MEDIA-H3 fixture: finalize now reads the STORED object's metadata (info) from
// the private quarantine bucket and promotes it with a server-side move. The
// stored content type defaults to the declared type used by these cases.
let mockStoredInfo: { size: number; contentType: string } = { size: 1024, contentType: 'video/mp4' };
const ownedUpdates: Array<{ table: string; payload: Record<string, any> }> = [];
let mockValidatorReturn: any = { valid: true, validated_at: 'now', details: {} };

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        maybeSingle: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
      };
      return api;
    }),
    storage: {
      from: jest.fn(() => ({
        getPublicUrl: jest.fn((path: string) => ({
          data: { publicUrl: `https://supabase.test/storage/v1/object/public/media-uploads/${path}` },
        })),
        download: jest.fn(async (path: string) => {
          storageCalls.download.push(path);
          // Default: return MP4 header bytes so the sniff matches video MIME.
          const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0]);
          return { data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null };
        }),
        remove: jest.fn(async (paths: string[]) => { storageCalls.remove.push(paths); return { data: null, error: null }; }),
        info: jest.fn(async () => ({ data: { ...mockStoredInfo }, error: null })),
        move: jest.fn(async (from: string, to: string, opts: any) => { storageCalls.move.push({ from, to, opts }); return { data: { message: 'ok' }, error: null }; }),
      })),
    },
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let updatePayload: Record<string, any> | null = null;
    const api: any = {
      update: jest.fn((p: Record<string, any>) => { updatePayload = p; return api; }),
      eq: jest.fn(() => api),
      then(resolve: any) {
        if (updatePayload) ownedUpdates.push({ table, payload: updatePayload });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

// 3AH-91: the route authenticates before anything else.
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: { id: 'user-1', email: 'u@test', emailVerified: true }, error: null })),
}));

jest.mock('../../services/userContextService', () => ({
  // loadAuthorizedPlanRow authenticates BEFORE the plan read (no existence oracle); the company
  // decision stays with enforceCompanyAccess below, so an authenticated principal is all this needs.
  resolveUserContext: async () => ({ authenticated: true, userId: 'test-user', role: 'user', companyIds: [], defaultCompanyId: '' }),
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1', companyId: 'company-1' })),
}));

jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => mockValidatorReturn),
  resolveExpectedCategory: jest.requireActual('../../services/mediaUploadValidationService').resolveExpectedCategory,
  sniffMimeFromBytes: jest.requireActual('../../services/mediaUploadValidationService').sniffMimeFromBytes,
  compareSniffedToClientMime: jest.requireActual('../../services/mediaUploadValidationService').compareSniffedToClientMime,
}));

function setRow(opts: { contentType?: string; lifecycle?: string; revisionLength?: number } = {}) {
  const history = Array.from({ length: opts.revisionLength ?? 1 }, (_, i) => ({ to: `state-${i}` }));
  supabaseRows = {
    'daily_content_plans:single': {
      id: 'plan-1',
      campaign_id: 'campaign-1',
      content_type: opts.contentType ?? 'reel',
      content: {
        creator_lifecycle_state: opts.lifecycle ?? 'awaiting_media_upload',
        creator_lifecycle_history: history,
      },
      content_status: opts.lifecycle ?? 'awaiting_media_upload',
      platform: 'instagram',
    },
    'campaigns:single': { company_id: 'company-1' },
  };
}

async function callHandler(body: Record<string, any> = {}, query: Record<string, string> = { id: 'plan-1' }) {
  const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/upload-media-finalize');
  const req: any = { method: 'POST', query, body };
  const res = createRes() as any;
  await handler(req, res);
  return res;
}

describe('upload-media-finalize API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storageCalls.upload.length = 0;
    storageCalls.remove.length = 0;
    storageCalls.download.length = 0;
    storageCalls.move.length = 0;
    mockStoredInfo = { size: 1024, contentType: 'video/mp4' };
    ownedUpdates.length = 0;
    mockValidatorReturn = { valid: true, validated_at: 'now', details: {} };
  });

  test('happy path: storage_path + video/mp4 + valid sniff → ready_for_schedule', async () => {
    setRow({ contentType: 'reel' });
    const res = await callHandler({
      storage_path: 'company-1/plan-1/video/abc.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      source: 'tus_upload',
      tus_upload_url: 'https://supabase.test/storage/v1/upload/resumable/session1',
      upload_session_id: 'session1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).to).toBe('ready_for_schedule');
    const planUpdate = ownedUpdates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('ready_for_schedule');
    const content = JSON.parse(planUpdate!.payload.content);
    expect(content.tus_upload_url).toBe('https://supabase.test/storage/v1/upload/resumable/session1');
    expect(content.upload_session_id).toBe('session1');
    expect(content.upload_source).toBe('tus_upload');
    // No orphan cleanup — the storage object is the final asset.
    expect(storageCalls.remove).toHaveLength(0);
    // MEDIA-H3: it became the final asset by a server-side promotion.
    expect(storageCalls.move).toEqual([{ from: 'company-1/plan-1/video/abc.mp4', to: 'company-1/plan-1/video/abc.mp4', opts: { destinationBucket: 'media-uploads' } }]);
  });

  test('missing storage_path → 400', async () => {
    setRow();
    const res = await callHandler({ mime_type: 'video/mp4', size_bytes: 100 });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('missing size_bytes → 400', async () => {
    setRow();
    const res = await callHandler({ storage_path: 'x', mime_type: 'video/mp4' });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('non-attachment-required row → 409 + orphan cleanup', async () => {
    setRow({ contentType: 'infographic', lifecycle: 'render_ready' });
    const res = await callHandler({
      storage_path: 'plan-1/video/sess.mp4', mime_type: 'video/mp4', size_bytes: 100,
    });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('UPLOAD_NOT_VALID_FOR_FORMAT');
    expect(storageCalls.remove).toHaveLength(1);
  });

  test('MIME mismatch with expected category → 415, quarantined object kept (H3-FIX F-H3-1)', async () => {
    setRow({ contentType: 'reel' });
    const res = await callHandler({
      storage_path: 'plan-1/audio/sess.mp3', mime_type: 'audio/mpeg', size_bytes: 100,
    });
    expect(res.status).toHaveBeenCalledWith(415);
    expect((res.body as any).code).toBe('UPLOAD_MIME_MISMATCH');
    expect(storageCalls.remove).toHaveLength(0);
    expect(storageCalls.move).toHaveLength(0);
  });

  test('concurrency conflict → 409, quarantined object kept, nothing promoted (H3-FIX F-H3-1)', async () => {
    setRow({ revisionLength: 4 });
    const res = await callHandler({
      storage_path: 'plan-1/video/sess.mp4', mime_type: 'video/mp4', size_bytes: 100,
      expected_revision: 1,
    });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('CONCURRENT_UPLOAD_CONFLICT');
    expect(storageCalls.remove).toHaveLength(0);
    expect(storageCalls.move).toHaveLength(0);
  });

  test('validation failure → upload_failed, orphan cleanup, success=false 200', async () => {
    setRow();
    mockValidatorReturn = { valid: false, errors: ['simulated'], validated_at: 'now', details: {} };
    const res = await callHandler({
      storage_path: 'plan-1/video/sess.mp4', mime_type: 'video/mp4', size_bytes: 100,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(false);
    expect(storageCalls.remove).toHaveLength(1);
    const planUpdate = ownedUpdates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('upload_failed');
  });

  test('oversize (declared) → 413, quarantined object kept (H3-FIX F-H3-1)', async () => {
    setRow();
    const res = await callHandler({
      storage_path: 'plan-1/video/sess.mp4', mime_type: 'video/mp4', size_bytes: 5 * 1024 * 1024 * 1024,
    });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(storageCalls.remove).toHaveLength(0);
    expect(storageCalls.move).toHaveLength(0);
  });
});

// PB-010: mark this suite as a MODULE for tsc.
// Without a top-level import/export, tsc treats the file as a global script, so
// its top-level `const`/`function` declarations collide with identically named
// declarations in sibling suites (TS2451/TS2393). Jest already loads every test
// file as its own CommonJS module, so this is a type-visibility fix only and
// changes no runtime behaviour.
describe('PC5-4 upload gate (CREATOR_MEDIA_UPLOADS_ENABLED)', () => {
  afterEach(() => { process.env.CREATOR_MEDIA_UPLOADS_ENABLED = 'true'; });

  test('disabled → 503 UPLOADS_UNAVAILABLE; no storage read, move, upload or delete; no row write', async () => {
    delete process.env.CREATOR_MEDIA_UPLOADS_ENABLED;
    storageCalls.upload.length = 0;
    storageCalls.remove.length = 0;
    storageCalls.download.length = 0;
    storageCalls.move.length = 0;
    const res = await callHandler({
      storage_path: 'company-1/plan-1/video/abc.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1000,
    });
    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.body as any).code).toBe('UPLOADS_UNAVAILABLE');
    expect((res.body as any).retryable).toBe(false);
    expect(storageCalls).toEqual({ upload: [], remove: [], download: [], move: [] });
  });
});

export {};
