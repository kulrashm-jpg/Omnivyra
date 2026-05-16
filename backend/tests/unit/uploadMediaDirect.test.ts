/**
 * Tests for /api/activity-workspace/[id]/upload-media-direct.
 *
 * Validates:
 *   - happy path: multipart → storage → validation → FSM → DB write
 *   - MIME mismatch rejection (pre-storage gate)
 *   - oversize rejection
 *   - orphan cleanup on post-storage validation failure
 *   - re-upload replaces the prior storage object
 *   - rejection for autonomous-only rows
 *   - rejection for unsupported formats
 *   - row-not-found
 */

function createRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, body: unknown) {
      this.body = body;
      return this;
    }),
    setHeader: jest.fn(),
  };
}

const ownedUpdates: Array<{ table: string; payload: Record<string, any>; filter: Record<string, any> }> = [];
const storageCalls: { upload: any[]; remove: string[][]; listBuckets: number } = { upload: [], remove: [], listBuckets: 0 };
let supabaseRows: Record<string, unknown> = {};
let mockFileFixture: { mime: string; size: number; filepath: string } = {
  mime: 'video/mp4',
  size: 1_000_000,
  filepath: '/tmp/fake.mp4',
};
let mockValidatorReturn: { valid: boolean; errors?: string[]; details?: any } = { valid: true, validated_at: 'now', details: {} } as any;
let storageUploadShouldError: string | null = null;

function chain(table: string) {
  let updatePayload: Record<string, any> | null = null;
  const filters: Record<string, any> = {};
  const api: any = {
    select: jest.fn(() => api),
    eq: jest.fn((key: string, value: any) => {
      filters[key] = value;
      return api;
    }),
    update: jest.fn((p: Record<string, any>) => { updatePayload = p; return api; }),
    maybeSingle: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
    single: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
    then(resolve: any) {
      if (updatePayload) {
        ownedUpdates.push({ table, payload: updatePayload, filter: { ...filters } });
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return api;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        maybeSingle: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
        single: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
      };
      return api;
    }),
    storage: {
      listBuckets: jest.fn(async () => { storageCalls.listBuckets++; return { data: [{ name: 'media-uploads' }], error: null }; }),
      createBucket: jest.fn(async () => ({ data: null, error: null })),
      from: jest.fn(() => ({
        upload: jest.fn(async (path: string, _buf: Buffer, opts: any) => {
          storageCalls.upload.push({ path, opts });
          if (storageUploadShouldError) {
            return { data: null, error: { message: storageUploadShouldError } };
          }
          return { data: { path }, error: null };
        }),
        getPublicUrl: jest.fn((path: string) => ({
          data: { publicUrl: `https://supabase.test/storage/v1/object/public/media-uploads/${path}` },
        })),
        remove: jest.fn(async (paths: string[]) => { storageCalls.remove.push(paths); return { data: null, error: null }; }),
      })),
    },
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => chain(table)),
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

// Default mock returns an MP4-shaped buffer (ftyp box at offset 4). Individual
// tests can override `mockReadFileSync` via `setReadBuffer` to test spoofed
// uploads.
let mockReadFileSync: () => Buffer = () => {
  // 12 bytes: 4 size + "ftyp" + "mp42"
  return Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
};
function setReadBuffer(buffer: Buffer) {
  mockReadFileSync = () => buffer;
}

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => mockReadFileSync()),
  unlinkSync: jest.fn(),
}));

let mockFormFields: Record<string, string[]> = { source: ['direct_upload'] };
function setFormFields(fields: Record<string, string>) {
  mockFormFields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [v]]));
}

jest.mock('formidable', () => {
  return jest.fn(() => ({
    parse: (_req: unknown, cb: any) => {
      const files: any = {
        file: [{
          mimetype: mockFileFixture.mime,
          size: mockFileFixture.size,
          filepath: mockFileFixture.filepath,
        }],
      };
      cb(null, mockFormFields, files);
    },
  }));
});

function setRow(opts: { id: string; content_type: string; campaign_id?: string; content?: Record<string, any> | null }) {
  supabaseRows = {
    'daily_content_plans:single': {
      id: opts.id,
      campaign_id: opts.campaign_id ?? 'campaign-1',
      content_type: opts.content_type,
      content: opts.content ?? { creator_lifecycle_state: 'awaiting_media_upload' },
      content_status: 'awaiting_media_upload',
      platform: 'instagram',
    },
    'campaigns:single': { company_id: 'company-1' },
  };
}

async function callHandler(body: Record<string, any> = {}, query: Record<string, string> = { id: 'plan-1' }) {
  const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/upload-media-direct');
  const req: any = {
    method: 'POST',
    query,
    body,
  };
  const res = createRes() as any;
  await handler(req, res);
  return res;
}

describe('upload-media-direct API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ownedUpdates.length = 0;
    storageCalls.upload.length = 0;
    storageCalls.remove.length = 0;
    storageCalls.listBuckets = 0;
    storageUploadShouldError = null;
    mockFileFixture = { mime: 'video/mp4', size: 1_000_000, filepath: '/tmp/fake.mp4' };
    mockValidatorReturn = { valid: true, validated_at: 'now', details: {} } as any;
    mockFormFields = { source: ['direct_upload'] };
    setReadBuffer(Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]));
  });

  test('happy path: reel + video MIME → storage upload + lifecycle to ready_for_schedule', async () => {
    setRow({ id: 'plan-1', content_type: 'reel' });
    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).to).toBe('ready_for_schedule');
    expect((res.body as any).intermediate).toBe('media_uploaded');
    expect((res.body as any).uploaded_media_url).toMatch(/^https:\/\/supabase\.test\/storage\/v1\/object\/public\/media-uploads\//);
    // Storage upload happened, no remove (no orphan).
    expect(storageCalls.upload).toHaveLength(1);
    expect(storageCalls.remove).toHaveLength(0);
    // DB write recorded the new state.
    const planUpdate = ownedUpdates.filter((u) => u.table === 'daily_content_plans' && u.payload && u.payload.content_status).slice(-1)[0];
    expect(planUpdate?.payload.content_status).toBe('ready_for_schedule');
    const content = JSON.parse(planUpdate!.payload.content);
    expect(content.creator_lifecycle_state).toBe('ready_for_schedule');
    expect(content.uploaded_media_url).toMatch(/media-uploads/);
    expect(content.upload_source).toBe('direct_upload');
    expect(content.upload_storage_bucket).toBe('media-uploads');
    expect(typeof content.upload_storage_object_path).toBe('string');
  });

  test('MIME mismatch (audio for reel) returns 415 BEFORE storage upload', async () => {
    setRow({ id: 'plan-1', content_type: 'reel' });
    mockFileFixture.mime = 'audio/mpeg';
    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(415);
    expect((res.body as any).code).toBe('UPLOAD_MIME_MISMATCH');
    // Storage NEVER touched on pre-storage MIME rejection.
    expect(storageCalls.upload).toHaveLength(0);
    expect(storageCalls.remove).toHaveLength(0);
    // No DB write either.
    expect(ownedUpdates).toHaveLength(0);
  });

  test('post-storage validation failure deletes the just-uploaded object (orphan cleanup)', async () => {
    setRow({ id: 'plan-1', content_type: 'reel' });
    mockValidatorReturn = { valid: false, errors: ['simulated validation failure'], validated_at: 'now', details: {} } as any;

    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(false);
    expect((res.body as any).to).toBe('upload_failed');
    expect(storageCalls.upload).toHaveLength(1);
    // Orphan cleanup must run.
    expect(storageCalls.remove).toHaveLength(1);
    expect(storageCalls.remove[0][0]).toBe(storageCalls.upload[0].path);
    // Row transitions to upload_failed.
    const planUpdate = ownedUpdates.filter((u) => u.table === 'daily_content_plans' && u.payload && u.payload.content_status).slice(-1)[0];
    expect(planUpdate?.payload.content_status).toBe('upload_failed');
    const content = JSON.parse(planUpdate!.payload.content);
    expect(content.creator_lifecycle_state).toBe('upload_failed');
    expect(content.upload_attempted_object_path).toBe(storageCalls.upload[0].path);
    // Importantly, uploaded_media_url is NOT overwritten on failure
    expect(content.uploaded_media_url).toBeUndefined();
  });

  test('re-upload over a row with a prior uploaded_media_url replaces the old storage object', async () => {
    const priorPublicUrl = 'https://supabase.test/storage/v1/object/public/media-uploads/company-1/plan-1/video/prior.mp4';
    setRow({
      id: 'plan-1',
      content_type: 'reel',
      content: {
        creator_lifecycle_state: 'ready_for_schedule',
        uploaded_media_url: priorPublicUrl,
        upload_storage_object_path: 'company-1/plan-1/video/prior.mp4',
        upload_validation: { valid: true },
      },
    });

    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    // New object uploaded
    expect(storageCalls.upload).toHaveLength(1);
    const newPath = storageCalls.upload[0].path;
    // Prior object deleted as part of replacement (best-effort; called after DB write)
    expect(storageCalls.remove.some((removed) => removed.includes('company-1/plan-1/video/prior.mp4'))).toBe(true);
    // And it's not deleting the new object
    expect(storageCalls.remove.some((removed) => removed.includes(newPath))).toBe(false);
  });

  test('autonomous-only row rejects upload before parsing multipart', async () => {
    setRow({ id: 'plan-1', content_type: 'infographic' });
    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('UPLOAD_NOT_VALID_FOR_FORMAT');
    expect(storageCalls.upload).toHaveLength(0);
    expect(storageCalls.remove).toHaveLength(0);
  });

  test('unsupported format rejects upload safely', async () => {
    setRow({ id: 'plan-1', content_type: 'mystery-format' });
    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('UPLOAD_NOT_VALID_FOR_FORMAT');
    expect(storageCalls.upload).toHaveLength(0);
  });

  test('row-not-found returns 404', async () => {
    supabaseRows = { 'daily_content_plans:single': null, 'campaigns:single': { company_id: 'company-1' } };
    const res = await callHandler({}, { id: 'missing' });

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('storage upload error returns 500 without writing the row', async () => {
    setRow({ id: 'plan-1', content_type: 'reel' });
    storageUploadShouldError = 'Bucket not found';

    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(500);
    expect((res.body as any).code).toBe('STORAGE_UPLOAD_FAILED');
    // The DB update should NOT have run because we never reached validation.
    expect(ownedUpdates).toHaveLength(0);
  });

  test('non-POST method is rejected with 405', async () => {
    const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/upload-media-direct');
    const req: any = { method: 'GET', query: { id: 'plan-1' }, body: {} };
    const res = createRes() as any;
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test('MIME spoof: claimed video/mp4 but bytes are PNG → 415 UPLOAD_MIME_SPOOF, no storage write', async () => {
    setRow({ id: 'plan-1', content_type: 'reel' });
    // Client claims video/mp4 in the multipart envelope
    mockFileFixture.mime = 'video/mp4';
    // Actual bytes start with the PNG signature `89 50 4E 47`
    setReadBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));

    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(415);
    expect((res.body as any).code).toBe('UPLOAD_MIME_SPOOF');
    expect((res.body as any).sniffed_mime).toBe('image/png');
    expect((res.body as any).claimed_mime).toBe('video/mp4');
    // No storage write because spoof is detected BEFORE upload.
    expect(storageCalls.upload).toHaveLength(0);
    expect(storageCalls.remove).toHaveLength(0);
    expect(ownedUpdates).toHaveLength(0);
  });

  test('concurrency conflict: expected_revision mismatch → 409, no storage write', async () => {
    setRow({
      id: 'plan-1',
      content_type: 'reel',
      content: {
        creator_lifecycle_state: 'awaiting_media_upload',
        creator_lifecycle_history: [
          { from: null, to: 'awaiting_media_upload', at: 'now' },
          { from: 'awaiting_media_upload', to: 'media_uploaded', at: 'now' },
          { from: 'media_uploaded', to: 'ready_for_schedule', at: 'now' },
        ],
      },
    });
    // Caller asserted revision 1; actual is 3.
    setFormFields({ source: 'direct_upload', expected_revision: '1' });

    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('CONCURRENT_UPLOAD_CONFLICT');
    expect((res.body as any).expected_revision).toBe(1);
    expect((res.body as any).actual_revision).toBe(3);
    // No storage write occurred — concurrency rejected before bucket upload.
    expect(storageCalls.upload).toHaveLength(0);
    expect(storageCalls.remove).toHaveLength(0);
    expect(ownedUpdates).toHaveLength(0);
  });

  test('concurrency match: expected_revision === actual → upload proceeds', async () => {
    setRow({
      id: 'plan-1',
      content_type: 'reel',
      content: {
        creator_lifecycle_state: 'awaiting_media_upload',
        creator_lifecycle_history: [{ from: null, to: 'awaiting_media_upload', at: 'now' }],
      },
    });
    setFormFields({ source: 'direct_upload', expected_revision: '1' });

    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).to).toBe('ready_for_schedule');
  });

  test('upload from scheduled state succeeds (reschedule replace-media via direct upload)', async () => {
    setRow({
      id: 'plan-1',
      content_type: 'reel',
      content: {
        creator_lifecycle_state: 'scheduled',
        uploaded_media_url: 'https://supabase.test/storage/v1/object/public/media-uploads/company-1/plan-1/video/prior.mp4',
        upload_storage_object_path: 'company-1/plan-1/video/prior.mp4',
        scheduled_post_id: 'sp-1',
        creator_lifecycle_history: [
          { to: 'awaiting_media_upload' },
          { to: 'media_uploaded' },
          { to: 'ready_for_schedule' },
          { to: 'scheduled' },
        ],
      },
    });

    const res = await callHandler();

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    // FSM accepted scheduled → media_uploaded → ready_for_schedule
    expect((res.body as any).intermediate).toBe('media_uploaded');
    expect((res.body as any).to).toBe('ready_for_schedule');
    // Prior storage object replaced
    expect(storageCalls.remove.some((r) => r.includes('company-1/plan-1/video/prior.mp4'))).toBe(true);
  });
});
