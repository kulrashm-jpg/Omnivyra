/**
 * STEP 3AH-91 SEC-E5 — storage object names and URLs.
 *
 *  - Public-bucket object names must be unguessable (CSPRNG, 128 bits), not
 *    `Math.random()` (media-uploads via upload-media-direct; media-* via
 *    mediaService.uploadMedia).
 *  - RPA screenshots live in a PRIVATE bucket: the store must not mint a
 *    "public" URL for them (dead for a private bucket, and an exposure if the
 *    bucket were ever made public). It hands back a short-lived signed URL and
 *    persists no URL at all — `object_path` is the durable reference.
 *
 * Math.random is pinned to a constant so a Math.random-derived name would be
 * identical across calls — the test then proves names do not depend on it.
 */
const mockUpload = jest.fn(async (..._a: unknown[]) => ({ data: {}, error: null }));
const mockGetPublicUrl = jest.fn((path: string) => ({ data: { publicUrl: `https://storage.test/object/public/${path}` } }));
const mockCreateSignedUrl = jest.fn(async (path: string, ttl: number) => ({ data: { signedUrl: `https://storage.test/object/sign/${path}?token=t&ttl=${ttl}` }, error: null }));
const mockInserts: Array<{ table: string; payload: any }> = [];
jest.mock('../../db/supabaseClient', () => {
  const storageBucket = {
    upload: (...a: unknown[]) => mockUpload(...a),
    getPublicUrl: (p: string) => mockGetPublicUrl(p),
    createSignedUrl: (p: string, ttl: number) => mockCreateSignedUrl(p, ttl),
    remove: async () => ({ data: null, error: null }),
  };
  const client = {
    storage: {
      from: () => storageBucket,
      listBuckets: async () => ({ data: [{ name: 'rpa-artifacts' }, { name: 'media-uploads' }] }),
      createBucket: async () => ({ error: null }),
    },
    from: () => ({}),
    rpc: async () => ({ data: [], error: null }),
  };
  return { supabase: client, default: client };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: any = {
      insert: (payload: any) => { mockInserts.push({ table, payload }); return b; },
      select: () => b,
      single: async () => ({ data: { id: 'row-1', ...(mockInserts[mockInserts.length - 1]?.payload ?? {}) }, error: null }),
      then: (ok: any) => Promise.resolve({ data: null, error: null }).then(ok),
    };
    return b;
  },
}));

import { unguessableObjectStem } from '../../../lib/security/objectNames';
import { deriveObjectPath } from '../../../pages/api/activity-workspace/[id]/upload-media-direct';
import { uploadMedia } from '../../services/mediaService';
import { saveRpaArtifact } from '../../services/rpaWorker/rpaArtifactStore';

const STEM = /^\d+-[0-9a-f]{32}$/;
let randomSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockInserts.length = 0;
  randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
});
afterEach(() => randomSpy.mockRestore());

describe('unguessable object names', () => {
  it('the stem is 128-bit hex from the CSPRNG and independent of Math.random', () => {
    const a = unguessableObjectStem();
    const b = unguessableObjectStem();
    expect(a).toMatch(STEM);
    expect(b).toMatch(STEM);
    expect(a).not.toBe(b);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('upload-media-direct object paths keep their layout but use the unguessable stem', () => {
    const input = { companyId: 'co-1', dailyPlanId: 'dp-1', mime: 'video/mp4' };
    const p1 = deriveObjectPath(input);
    const p2 = deriveObjectPath(input);
    expect(p1).not.toBe(p2);
    const m = p1.match(/^co-1\/dp-1\/video\/(.+)\.mp4$/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(STEM);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('mediaService.uploadMedia names public-bucket objects with the unguessable stem', async () => {
    const tiny = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await uploadMedia({ userId: 'user-1', file: tiny, fileName: 'a.png', mimeType: 'image/png' } as any);
    await uploadMedia({ userId: 'user-1', file: tiny, fileName: 'a.png', mimeType: 'image/png' } as any);
    const paths = mockUpload.mock.calls.map((c) => String(c[0]));
    expect(paths).toHaveLength(2);
    expect(paths[0]).not.toBe(paths[1]);
    for (const p of paths) {
      const m = p.match(/^user-1\/(.+)\.png$/);
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(STEM);
    }
  });
});

describe('RPA artifacts (private bucket) are never given a public URL', () => {
  it('returns a short-lived signed URL and persists no URL', async () => {
    const saved = await saveRpaArtifact({
      action_id: 'act-1', organization_id: 'org-1', buffer: Buffer.from('png'), kind: 'screenshot', ext: 'png',
    });
    expect(mockGetPublicUrl).not.toHaveBeenCalled();
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
    const [path, ttl] = mockCreateSignedUrl.mock.calls[0];
    expect(path).toBe(saved?.object_path);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
    expect(saved?.public_url).toContain('/object/sign/');
    expect(saved?.durable).toBe(true);

    const row = mockInserts.find((i) => i.table === 'rpa_artifacts')?.payload;
    expect(row).toBeDefined();
    expect(row.object_path).toBe(saved?.object_path);
    expect(row.public_url).toBeNull();
  });

  it('a signing failure degrades to no URL, never to a public one', async () => {
    mockCreateSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'sign failed' } } as any);
    const saved = await saveRpaArtifact({ action_id: 'act-2', organization_id: 'org-1', buffer: Buffer.from('png') });
    expect(saved?.public_url).toBeNull();
    expect(saved?.durable).toBe(true);
    expect(mockGetPublicUrl).not.toHaveBeenCalled();
  });
});
