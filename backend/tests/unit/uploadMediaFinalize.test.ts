/**
 * Tests for /api/activity-workspace/[id]/upload-media-finalize.
 *
 *   - happy path: storage_path + good MIME → media_uploaded → ready_for_schedule
 *   - missing required fields → 400
 *   - non-attachment-required row → 409, orphan cleanup
 *   - MIME mismatch with expected category → 415, orphan cleanup
 *   - oversize → 413, orphan cleanup
 *   - concurrency conflict → 409, orphan cleanup
 */

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
const storageCalls = { upload: [] as any[], remove: [] as string[][], download: [] as string[] };
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

jest.mock('../../services/userContextService', () => ({
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
      storage_path: 'x/y.mp4', mime_type: 'video/mp4', size_bytes: 100,
    });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('UPLOAD_NOT_VALID_FOR_FORMAT');
    expect(storageCalls.remove).toHaveLength(1);
  });

  test('MIME mismatch with expected category → 415 + orphan cleanup', async () => {
    setRow({ contentType: 'reel' });
    const res = await callHandler({
      storage_path: 'x/y.mp3', mime_type: 'audio/mpeg', size_bytes: 100,
    });
    expect(res.status).toHaveBeenCalledWith(415);
    expect((res.body as any).code).toBe('UPLOAD_MIME_MISMATCH');
    expect(storageCalls.remove).toHaveLength(1);
  });

  test('concurrency conflict → 409 + orphan cleanup', async () => {
    setRow({ revisionLength: 4 });
    const res = await callHandler({
      storage_path: 'x/y.mp4', mime_type: 'video/mp4', size_bytes: 100,
      expected_revision: 1,
    });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('CONCURRENT_UPLOAD_CONFLICT');
    expect(storageCalls.remove).toHaveLength(1);
  });

  test('validation failure → upload_failed, orphan cleanup, success=false 200', async () => {
    setRow();
    mockValidatorReturn = { valid: false, errors: ['simulated'], validated_at: 'now', details: {} };
    const res = await callHandler({
      storage_path: 'x/y.mp4', mime_type: 'video/mp4', size_bytes: 100,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(false);
    expect(storageCalls.remove).toHaveLength(1);
    const planUpdate = ownedUpdates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('upload_failed');
  });

  test('oversize → 413 + orphan cleanup', async () => {
    setRow();
    const res = await callHandler({
      storage_path: 'x/y.mp4', mime_type: 'video/mp4', size_bytes: 5 * 1024 * 1024 * 1024,
    });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(storageCalls.remove).toHaveLength(1);
  });
});
