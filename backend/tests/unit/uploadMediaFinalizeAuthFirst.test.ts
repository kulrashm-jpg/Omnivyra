/**
 * 3AH-91 (S-1) — upload-media-finalize must authorize BEFORE any storage operation.
 *
 * THE DEFECT: the route deleted the caller-named `storage_path` from the
 * media-uploads bucket (with the server client) on early branches that ran
 * before any authentication — e.g. `size_bytes` over the limit, a missing row,
 * an unresolved company — and even after enforceCompanyAccess rejected the
 * caller. An anonymous request could delete any object whose path it knew
 * (paths are visible in public media URLs). Even an authorized caller could
 * name another tenant's object and have a rejection branch delete it.
 *
 * The real guard chain runs (enforceCompanyAccess → TenantGuard); only the
 * database, identity provider and storage are fake. Every storage call and the
 * authorization verdict land in ONE ordered event log.
 */
import {
  seed, invoke, failTable, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, USER_A,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const storageBucket = (bucket: string) => ({
    remove: jest.fn(async (paths: string[]) => { mockEvents.push(`storage:remove:${bucket}:${paths.join(',')}`); return { data: null, error: null }; }),
    download: jest.fn(async (p: string) => {
      mockEvents.push(`storage:download:${p}`);
      const buf = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0]);
      return { data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null };
    }),
    getPublicUrl: jest.fn((p: string) => { mockEvents.push(`storage:url:${p}`); return { data: { publicUrl: `https://supabase.test/storage/v1/object/public/${bucket}/${p}` } }; }),
    upload: jest.fn(async () => { mockEvents.push('storage:upload'); return { data: null, error: null }; }),
  });
  const supabase = {
    ...h.fakeSupabase,
    from: (t: string) => { mockEvents.push(`db:${t}`); return h.fakeSupabase.from(t); },
    storage: { from: storageBucket },
  };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const b = jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule().ownedDbTable(t);
    const update = b.update;
    b.update = (p: unknown) => { mockEvents.push(`db:write:${t}`); return update(p); };
    return b;
  },
}));
jest.mock('../../services/supabaseAuthService', () => {
  const m = jest.requireActual('../helpers/routeAuthHarness').authModule();
  const inner = m.getSupabaseUserFromRequest;
  return { ...m, getSupabaseUserFromRequest: jest.fn(async (req: any) => { mockEvents.push('auth'); return inner(req); }) };
});
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/userContextService', () => {
  const actual = jest.requireActual('../../services/userContextService');
  return {
    ...actual,
    enforceCompanyAccess: jest.fn(async (input: any) => {
      const r = await actual.enforceCompanyAccess(input);
      mockEvents.push(r ? 'authz:ok' : 'authz:deny');
      return r;
    }),
  };
});
jest.mock('../../services/mediaUploadValidationService', () => ({
  ...jest.requireActual('../../services/mediaUploadValidationService'),
  validateMediaUpload: jest.fn(async () => ({ valid: true, validated_at: 'now', details: {} })),
}));
jest.mock('../../services/creator/creatorRowScheduler', () => ({
  autoScheduleReadyCreatorRowById: jest.fn(async () => ({ status: 'scheduled', scheduledPostId: 'sp-1' })),
}));

import handler from '../../../pages/api/activity-workspace/[id]/upload-media-finalize';

const PLAN_A = 'plan-a-0-0000-0000-00000000000a';
const PLAN_B = 'plan-b-0-0000-0000-00000000000b';
const OWN_PATH = `${PLAN_A}/video/${PLAN_A}-1-abc.mp4`;
const VICTIM_PATH = `${PLAN_B}/video/${PLAN_B}-1-xyz.mp4`;
const MP4 = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0]);

function plan(id: string, campaignId: string, extra: Record<string, unknown> = {}) {
  return {
    id, campaign_id: campaignId, content_type: 'reel', platform: 'instagram', content_status: 'awaiting_media_upload',
    content: { creator_lifecycle_state: 'awaiting_media_upload', creator_lifecycle_history: [{ to: 'awaiting_media_upload' }], ...extra },
  };
}
const body = (over: Record<string, unknown> = {}) => ({ storage_path: OWN_PATH, mime_type: 'video/mp4', size_bytes: 1000, ...over });
const finalize = (id: string, b: Record<string, unknown>, as: 'A' | 'B' | null) =>
  invoke(handler as any, { method: 'POST', query: { id }, body: b, as });
const storageEvents = () => mockEvents.filter((e) => e.startsWith('storage:'));
const removed = () => mockEvents.filter((e) => e.startsWith('storage:remove:')).map((e) => e.split(':').slice(3).join(':'));
const first = (prefix: string) => mockEvents.findIndex((e) => e.startsWith(prefix));

beforeEach(() => {
  mockEvents.length = 0;
  seed({ daily_content_plans: [plan(PLAN_A, CAMPAIGN_A), plan(PLAN_B, CAMPAIGN_B)] });
  (global as any).fetch = jest.fn(async (url: string) => {
    mockEvents.push(`storage:fetch:${url}`);
    return { status: 206, arrayBuffer: async () => MP4.buffer.slice(MP4.byteOffset, MP4.byteOffset + MP4.byteLength) };
  });
});

// ── 1–2. Anonymous ────────────────────────────────────────────────────────────
describe('anonymous caller', () => {
  it.each([
    ['plain', body()],
    ['oversize (the old pre-auth delete branch)', body({ size_bytes: 5 * 1024 ** 3 })],
    ['victim path + oversize', body({ storage_path: VICTIM_PATH, size_bytes: 5 * 1024 ** 3 })],
  ])('%s → 401, and NOTHING touches storage or the database', async (_n, b) => {
    const r = await finalize(PLAN_A, b, null);
    expect(r.status).toBe(401);
    expect(storageEvents()).toEqual([]);
    expect(mockEvents.filter((e) => e.startsWith('db:'))).toEqual([]);
  });
  it('an unknown activity is indistinguishable (401, no read)', async () => {
    const r = await finalize('no-such-plan', body(), null);
    expect(r.status).toBe(401);
    expect(mockEvents).toEqual(['auth']);
  });
});

// ── 3–4. Wrong-company member ─────────────────────────────────────────────────
describe('authenticated member of another company', () => {
  it.each([
    ['plain', body()],
    ['oversize', body({ size_bytes: 5 * 1024 ** 3 })],
    ['MIME mismatch (a post-auth delete branch on main)', body({ mime_type: 'audio/mpeg' })],
  ])('%s → 403, storage never touched', async (_n, b) => {
    const r = await finalize(PLAN_A, b, 'B');
    expect(r.status).toBe(403);
    expect(storageEvents()).toEqual([]);
    expect(mockEvents.filter((e) => e.startsWith('db:write'))).toEqual([]);
  });
});

// ── 5. Correct-company member ─────────────────────────────────────────────────
describe('authenticated member of the owning company', () => {
  it('succeeds exactly as before, and authorization precedes every storage call', async () => {
    const r = await finalize(PLAN_A, body({ source: 'tus_upload' }), 'A');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.to).toBe('scheduled');
    expect(r.body.storage).toEqual({ bucket: 'media-uploads', object_path: OWN_PATH });
    expect(mockEvents).toContain('db:write:daily_content_plans');
    expect(removed()).toEqual([]);
    const authz = mockEvents.indexOf('authz:ok');
    expect(mockEvents.indexOf('auth')).toBe(0);
    expect(authz).toBeGreaterThan(0);
    expect(first('storage:')).toBeGreaterThan(authz);
  });
  it('the direct-upload layout <company>/<activity>/… is also in scope', async () => {
    const r = await finalize(PLAN_A, body({ storage_path: `${CO_A}/${PLAN_A}/video/s.mp4` }), 'A');
    expect(r.status).toBe(200);
  });
  it('an authorized early rejection cleans up ONLY its own object, after authorization', async () => {
    const r = await finalize(PLAN_A, body({ size_bytes: 5 * 1024 ** 3 }), 'A');
    expect(r.status).toBe(413);
    expect(removed()).toEqual([OWN_PATH]);
    expect(first('storage:remove:')).toBeGreaterThan(mockEvents.indexOf('authz:ok'));
  });
});

// ── 6–7. Caller-supplied ownership metadata is ignored ────────────────────────
describe('caller-supplied company_id / user_id cannot authorize', () => {
  it('member of B naming company A / user A for A\'s activity → 403, no storage', async () => {
    const r = await finalize(PLAN_A, body({ company_id: CO_A, companyId: CO_A, user_id: USER_A, userId: USER_A }), 'B');
    expect(r.status).toBe(403);
    expect(storageEvents()).toEqual([]);
  });
  it('member of B naming ITS OWN company for A\'s activity → 403, no storage', async () => {
    for (const b of [body({ company_id: CO_B }), body({ companyId: CO_B, size_bytes: 5 * 1024 ** 3 })]) {
      mockEvents.length = 0;
      const r = await finalize(PLAN_A, b, 'B');
      expect(r.status).toBe(403);
      expect(storageEvents()).toEqual([]);
    }
  });
  it('anonymous caller naming a user_id → 401 before any read or storage call', async () => {
    const r = await finalize(PLAN_A, body({ user_id: USER_A, userId: USER_A, size_bytes: 5 * 1024 ** 3 }), null);
    expect(r.status).toBe(401);
    expect(mockEvents).toEqual(['auth']);
  });
  it('member of A naming company B for its own activity → still scoped to A (ignored)', async () => {
    const r = await finalize(PLAN_A, body({ company_id: CO_B, companyId: CO_B }), 'A');
    expect(r.status).toBe(200);
    expect(r.body.storage.object_path).toBe(OWN_PATH);
  });
});

// ── 8. Malicious storage_path ─────────────────────────────────────────────────
describe('a caller-named object outside the authorized activity is never touched', () => {
  it.each([
    ['another activity', VICTIM_PATH],
    ['another tenant, direct layout', `${CO_B}/${PLAN_B}/video/x.mp4`],
    ['own company, other activity', `${CO_A}/${PLAN_B}/video/x.mp4`],
    ['other company, own activity id', `${CO_B}/${PLAN_A}/video/x.mp4`],
    ['traversal', `${PLAN_A}/../${PLAN_B}/video/x.mp4`],
    ['dot segment', `${PLAN_A}/./x.mp4`],
    ['absolute', `/${PLAN_A}/video/x.mp4`],
    ['empty segment', `${PLAN_A}//x.mp4`],
    ['backslash', `${PLAN_A}\\..\\${PLAN_B}\\x.mp4`],
    ['control character', `${PLAN_A}/video/x\u0000.mp4`],
    ['bare activity prefix', `${PLAN_A}/x.mp4`],
    ['activity id as a substring', `${PLAN_A}extra/video/x.mp4`],
  ])('%s → 400 OUT_OF_SCOPE, no storage call — even on the oversize branch', async (_n, path) => {
    for (const b of [body({ storage_path: path }), body({ storage_path: path, size_bytes: 5 * 1024 ** 3 }), body({ storage_path: path, mime_type: 'audio/mpeg' })]) {
      mockEvents.length = 0;
      const r = await finalize(PLAN_A, b, 'A');
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('UPLOAD_PATH_OUT_OF_SCOPE');
      expect(storageEvents()).toEqual([]);
    }
  });
  it('a prior upload URL naming another tenant\'s object is NOT deleted on replacement', async () => {
    seed({ daily_content_plans: [plan(PLAN_A, CAMPAIGN_A, { uploaded_media_url: `https://supabase.test/storage/v1/object/public/media-uploads/${VICTIM_PATH}` })] });
    const r = await finalize(PLAN_A, body(), 'A');
    expect(r.status).toBe(200);
    expect(removed()).toEqual([]);
  });
  it('a prior upload of THIS activity is still replaced', async () => {
    const prior = `${PLAN_A}/video/${PLAN_A}-0-old.mp4`;
    seed({ daily_content_plans: [plan(PLAN_A, CAMPAIGN_A, { uploaded_media_url: `https://supabase.test/storage/v1/object/public/media-uploads/${prior}` })] });
    const r = await finalize(PLAN_A, body(), 'A');
    expect(r.status).toBe(200);
    expect(removed()).toEqual([prior]);
  });
});

// ── 9–10. Missing activity and lookup failures fail closed ────────────────────
describe('fail closed', () => {
  it('missing activity → 404, no storage call (the old code deleted the object)', async () => {
    const r = await finalize('no-such-plan', body({ storage_path: 'no-such-plan/video/x.mp4' }), 'A');
    expect(r.status).toBe(404);
    expect(storageEvents()).toEqual([]);
  });
  it.each([
    ['daily_content_plans', 500],
    ['campaigns', 503],
    ['user_company_roles', 503],
  ])('%s lookup failure → %i, no storage call', async (table, status) => {
    failTable(table as string);
    const r = await finalize(PLAN_A, body({ size_bytes: 5 * 1024 ** 3 }), 'A');
    expect(r.status).toBe(status);
    expect(storageEvents()).toEqual([]);
  });
  it('activity whose campaign has no company → 403, no storage call (the old code deleted)', async () => {
    seed({ campaigns: [{ id: 'camp-noco', company_id: null }], daily_content_plans: [plan('plan-noco', 'camp-noco')] });
    const r = await finalize('plan-noco', body({ storage_path: 'plan-noco/video/x.mp4', size_bytes: 5 * 1024 ** 3 }), 'A');
    expect(r.status).toBe(403);
    expect(storageEvents()).toEqual([]);
  });
});

// ── 11. Every early error path ────────────────────────────────────────────────
describe('every early error path', () => {
  const EARLY = [
    body({ storage_path: '' }),
    body({ mime_type: '' }),
    body({ size_bytes: 0 }),
    body({ size_bytes: 5 * 1024 ** 3 }),
  ];
  it.each([[null], ['B']] as const)('caller %p: no early path touches storage', async (as) => {
    for (const b of EARLY) {
      mockEvents.length = 0;
      const r = await finalize(PLAN_A, b, as);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(storageEvents()).toEqual([]);
    }
  });
  it('non-attachment format for the owner → 409 with own-object cleanup only after authorization', async () => {
    seed({ daily_content_plans: [{ ...plan(PLAN_A, CAMPAIGN_A), content_type: 'post' }] });
    const r = await finalize(PLAN_A, body(), 'A');
    expect(r.status).toBe(409);
    expect(removed()).toEqual([OWN_PATH]);
    expect(first('storage:')).toBeGreaterThan(mockEvents.indexOf('authz:ok'));
  });
});
