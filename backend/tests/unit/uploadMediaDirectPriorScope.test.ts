/**
 * 3AH-92 — upload-media-direct must only ever delete a PRIOR object that
 * belongs to the authorized activity.
 *
 * The replacement cleanup derived the prior object from the row's recorded
 * `content.uploaded_media_url` and removed it with the server (secret-key)
 * client, with no scoping. That URL is caller-writable: the link-based
 * `upload-media` endpoint records any http(s) `media_url` verbatim, even when
 * validation fails. So a member of company A could:
 *   1. POST /upload-media  { media_url: "https://x/media-uploads/<B's object>" }
 *   2. POST /upload-media-direct with any valid file
 * and the server deleted company B's object from the `media-uploads` bucket.
 *
 * The prior path must now be an upload of THIS activity — the same two layouts
 * the finalize route accepts (3AH-91):
 *   TUS:    <activityId>/<subdir>/<session>.<ext>
 *   direct: <companyId>/<activityId>/<subdir>/<stem>.<ext>
 * Anything else is left untouched, and the new upload still succeeds.
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

const storageCalls: { upload: Array<{ path: string }>; remove: string[][] } = { upload: [], remove: [] };
let supabaseRows: Record<string, unknown> = {};
let accessGranted = true;

function chain() {
  const api: any = {
    select: jest.fn(() => api),
    eq: jest.fn(() => api),
    in: jest.fn(() => api),
    update: jest.fn(() => api),
    insert: jest.fn(() => api),
    maybeSingle: jest.fn(async () => ({ data: null, error: null })),
    single: jest.fn(async () => ({ data: null, error: null })),
    then(resolve: any) {
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return api;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn(() => api),
        maybeSingle: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
        single: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
      };
      return api;
    }),
    storage: {
      listBuckets: jest.fn(async () => ({ data: [{ name: 'media-uploads' }], error: null })),
      createBucket: jest.fn(async () => ({ data: null, error: null })),
      from: jest.fn(() => ({
        upload: jest.fn(async (path: string) => {
          storageCalls.upload.push({ path });
          return { data: { path }, error: null };
        }),
        getPublicUrl: jest.fn((path: string) => ({
          data: { publicUrl: `https://supabase.test/storage/v1/object/public/media-uploads/${path}` },
        })),
        remove: jest.fn(async (paths: string[]) => {
          storageCalls.remove.push(paths);
          return { data: null, error: null };
        }),
      })),
    },
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => chain()),
}));

jest.mock('../../services/userContextService', () => ({
  // STEP 3AH-95: the route authenticates BEFORE loading the row (SEC91-E6,
  // PR #246), so the identity seam must exist in this fixture too. An
  // unauthenticated caller is covered by sec91EUploadExistenceOracle.
  resolveUserContext: jest.fn(async () => ({
    userId: 'user-a',
    role: 'user',
    companyIds: ['company-a'],
    defaultCompanyId: 'company-a',
    authenticated: true,
  })),
  enforceCompanyAccess: jest.fn(async ({ res }: any) => {
    if (accessGranted) return { userId: 'user-a', companyId: 'company-a' };
    res.status(403).json({ error: 'Access denied to company' });
    return null;
  }),
}));

jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => ({ valid: true, validated_at: 'now', details: {} })),
  resolveExpectedCategory: jest.requireActual('../../services/mediaUploadValidationService').resolveExpectedCategory,
  sniffMimeFromBytes: jest.requireActual('../../services/mediaUploadValidationService').sniffMimeFromBytes,
  compareSniffedToClientMime: jest.requireActual('../../services/mediaUploadValidationService').compareSniffedToClientMime,
}));

jest.mock('../../services/creator/creatorRowScheduler', () => ({
  autoScheduleReadyCreatorRowById: jest.fn(async () => ({ status: 'skipped', scheduledPostId: null })),
}));

jest.mock('fs', () => ({
  // MP4-shaped bytes: 4-byte size + "ftyp" + "mp42"
  readFileSync: jest.fn(() => Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])),
  unlinkSync: jest.fn(),
}));

jest.mock('formidable', () => jest.fn(() => ({
  parse: (_req: unknown, cb: any) => {
    cb(null, { source: ['direct_upload'] }, {
      file: [{ mimetype: 'video/mp4', size: 1_000_000, filepath: '/tmp/fake.mp4' }],
    });
  },
})));

const ACTIVITY = 'plan-a1';
const COMPANY = 'company-a';
const PUBLIC_PREFIX = 'https://supabase.test/storage/v1/object/public/media-uploads/';

function setRow(priorUrl: string | null, state = 'ready_for_schedule') {
  supabaseRows = {
    'daily_content_plans:single': {
      id: ACTIVITY,
      campaign_id: 'campaign-a',
      content_type: 'reel',
      content: {
        creator_lifecycle_state: state,
        ...(priorUrl ? { uploaded_media_url: priorUrl } : {}),
      },
      content_status: state,
      platform: 'instagram',
    },
    'campaigns:single': { company_id: COMPANY },
  };
}

async function callHandler() {
  const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/upload-media-direct');
  const req: any = { method: 'POST', query: { id: ACTIVITY }, body: {} };
  const res = createRes() as any;
  await handler(req, res);
  return res;
}

function removedPaths(): string[] {
  return storageCalls.remove.flat();
}

describe('upload-media-direct — prior-object cleanup is scoped to the authorized activity (3AH-92)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storageCalls.upload.length = 0;
    storageCalls.remove.length = 0;
    accessGranted = true;
  });

  describe('out-of-scope prior objects are NEVER deleted (and the upload still succeeds)', () => {
    const cases: Array<[string, string]> = [
      ['another tenant\'s direct-upload object', `${PUBLIC_PREFIX}company-b/plan-b1/video/victim.mp4`],
      ['another tenant\'s TUS object', `${PUBLIC_PREFIX}plan-b1/video/plan-b1-1700000000000-abcdefgh.mp4`],
      ['another activity of the SAME company', `${PUBLIC_PREFIX}${COMPANY}/plan-a2/video/sibling.mp4`],
      ['a foreign host whose path names another tenant', `https://attacker.example/media-uploads/company-b/plan-b1/video/victim.mp4`],
      ['an encoded-slash traversal out of this activity', `${PUBLIC_PREFIX}${ACTIVITY}/video/..%2F..%2Fcompany-b%2Fplan-b1%2Fvideo%2Fvictim.mp4`],
      ['an encoded dot-segment that collapses to the activity folder', `${PUBLIC_PREFIX}${ACTIVITY}/video/%2e%2e`],
      ['a percent-encoded key under this activity', `${PUBLIC_PREFIX}${ACTIVITY}/video/%00x.mp4`],
      ['an activity-id prefix collision', `${PUBLIC_PREFIX}${ACTIVITY}0/video/other.mp4`],
      ['a company-only path with no activity segment', `${PUBLIC_PREFIX}${COMPANY}/video/x.mp4`],
      ['the bucket root object', `${PUBLIC_PREFIX}victim.mp4`],
    ];

    test.each(cases)('%s', async (_label, priorUrl) => {
      setRow(priorUrl);
      const res = await callHandler();

      expect(res.status).toHaveBeenCalledWith(200);
      expect((res.body as any).success).toBe(true);
      expect(storageCalls.upload).toHaveLength(1);
      // Nothing at all is removed: the new object is kept, the foreign one untouched.
      expect(removedPaths()).toEqual([]);
    });

    test('a scheduled row (replace-media) with a foreign prior URL leaves it untouched', async () => {
      setRow(`${PUBLIC_PREFIX}company-b/plan-b1/video/victim.mp4`, 'scheduled');
      const res = await callHandler();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(removedPaths()).toEqual([]);
    });
  });

  describe('in-scope prior objects are still replaced', () => {
    test('direct-upload layout <companyId>/<activityId>/… is removed after the new URL is recorded', async () => {
      setRow(`${PUBLIC_PREFIX}${COMPANY}/${ACTIVITY}/video/prior.mp4`);
      const res = await callHandler();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(removedPaths()).toEqual([`${COMPANY}/${ACTIVITY}/video/prior.mp4`]);
      expect(removedPaths()).not.toContain(storageCalls.upload[0].path);
    });

    test('TUS layout <activityId>/… is removed', async () => {
      const prior = `${ACTIVITY}/video/${ACTIVITY}-1700000000000-abcdefgh.mp4`;
      setRow(`${PUBLIC_PREFIX}${prior}`);
      const res = await callHandler();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(removedPaths()).toEqual([prior]);
    });

    test('no prior URL → nothing removed', async () => {
      setRow(null, 'awaiting_media_upload');
      const res = await callHandler();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(removedPaths()).toEqual([]);
    });
  });

  describe('regression guards (hold on main too)', () => {
    test('authorization failure → no storage mutation of any kind', async () => {
      accessGranted = false;
      setRow(`${PUBLIC_PREFIX}${COMPANY}/${ACTIVITY}/video/prior.mp4`);
      const res = await callHandler();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(storageCalls.upload).toEqual([]);
      expect(removedPaths()).toEqual([]);
    });

    test('the new object is written under <companyId>/<activityId>/ from server state', async () => {
      setRow(null, 'awaiting_media_upload');
      await callHandler();
      expect(storageCalls.upload[0].path.startsWith(`${COMPANY}/${ACTIVITY}/video/`)).toBe(true);
    });
  });
});

export {};
