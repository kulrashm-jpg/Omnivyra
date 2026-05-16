/**
 * Tests for the creator media storage janitor.
 *
 * - Lists objects, intersects with referenced paths, deletes orphans
 *   older than the age threshold.
 * - Protects referenced paths even when they're old.
 * - Skips young objects.
 * - Honors maxDeletes cap.
 * - Clears stale awaiting_media_upload session stamps.
 * - Dry-run does not call delete or mutate rows.
 * - Reports structured counts.
 */

import { runCreatorMediaStorageJanitor } from '../../jobs/creatorMediaStorageJanitorJob';

type FakeFile = { name: string; createdAt: string | null };
type FakeDir = { name: string };
type ListEntry = (FakeFile & { isDir?: false }) | (FakeDir & { isDir: true });

const bucket = {
  files: new Map<string, FakeFile>(),       // path → file metadata
  dirs: new Map<string, ListEntry[]>(),     // prefix → entries (mixed dirs + files)
  removeCalls: [] as string[][],
};

const referencedRows: Array<{ id: string; content: any }> = [];
const staleSessionRows: Array<{ id: string; resumable_session_started_at: string; content_status: string }> = [];
const ownedUpdates: Array<{ table: string; payload: Record<string, any>; ids: string[] }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      let pageLimit = 500;
      let lastIdGt: string | null = null;
      const api: any = {
        select: jest.fn(() => api),
        order: jest.fn(() => api),
        limit: jest.fn((n: number) => { pageLimit = n; return api; }),
        gt: jest.fn((_k: string, v: string) => { lastIdGt = v; return api; }),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        lt: jest.fn((k: string, _v: any) => { filters[`${k}__lt`] = true; return api; }),
        maybeSingle: jest.fn(async () => ({ data: null, error: null })),
        then(resolve: any) {
          if (table === 'daily_content_plans') {
            // Two query shapes:
            // 1) select id, content → walk in pages of 500
            // 2) lt resumable_session_started_at + eq content_status → stale sessions
            if (filters['resumable_session_started_at__lt'] && filters.content_status === 'awaiting_media_upload') {
              return Promise.resolve({ data: staleSessionRows, error: null }).then(resolve);
            }
            const rows = lastIdGt
              ? referencedRows.filter((r) => r.id > lastIdGt!)
              : referencedRows;
            return Promise.resolve({ data: rows.slice(0, pageLimit), error: null }).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return api;
    }),
    storage: {
      from: jest.fn((_bucketName: string) => ({
        list: jest.fn(async (prefix: string) => {
          const entries = bucket.dirs.get(prefix) ?? [];
          return {
            data: entries.map((e) => ({
              name: e.name,
              id: (e as any).isDir ? null : `${prefix}/${e.name}-id`,
              metadata: (e as any).isDir ? null : { size: 1024 },
              created_at: (e as any).isDir ? null : (e as FakeFile).createdAt,
            })),
            error: null,
          };
        }),
        remove: jest.fn(async (paths: string[]) => {
          bucket.removeCalls.push(paths);
          return { data: null, error: null };
        }),
      })),
    },
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let payload: Record<string, any> | null = null;
    let ids: string[] = [];
    const api: any = {
      update: jest.fn((p: Record<string, any>) => { payload = p; return api; }),
      in: jest.fn((_k: string, v: string[]) => { ids = v; return api; }),
      eq: jest.fn(() => api),
      then(resolve: any) {
        if (payload) ownedUpdates.push({ table, payload, ids });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

function resetBucket() {
  bucket.files.clear();
  bucket.dirs.clear();
  bucket.removeCalls.length = 0;
  referencedRows.length = 0;
  staleSessionRows.length = 0;
  ownedUpdates.length = 0;
}

function fakeBucketSetup(opts: {
  files: Array<{ path: string; ageHours: number }>;
}) {
  // Build a directory tree from the file paths.
  const tree: Record<string, ListEntry[]> = { '': [] };
  for (const f of opts.files) {
    const parts = f.path.split('/');
    let prefix = '';
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const isLast = i === parts.length - 1;
      const parentEntries = tree[prefix] ?? (tree[prefix] = []);
      const fullChild = prefix ? `${prefix}/${segment}` : segment;
      const exists = parentEntries.find((e) => e.name === segment);
      if (!exists) {
        if (isLast) {
          parentEntries.push({
            name: segment,
            createdAt: new Date(Date.now() - f.ageHours * 3600 * 1000).toISOString(),
          });
        } else {
          parentEntries.push({ name: segment, isDir: true });
          tree[fullChild] = tree[fullChild] ?? [];
        }
      }
      prefix = fullChild;
    }
  }
  for (const [prefix, entries] of Object.entries(tree)) {
    bucket.dirs.set(prefix, entries);
  }
}

describe('creatorMediaStorageJanitorJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetBucket();
  });

  test('deletes orphan objects older than minAgeHours', async () => {
    fakeBucketSetup({ files: [
      { path: 'company-1/plan-1/video/old.mp4', ageHours: 48 },
      { path: 'company-1/plan-2/video/older.mp4', ageHours: 72 },
    ]});
    const report = await runCreatorMediaStorageJanitor({ minAgeHours: 24, dryRun: false });
    expect(report.scanned_count).toBe(2);
    expect(report.deleted_count).toBe(2);
    expect(bucket.removeCalls).toHaveLength(1);
    expect(bucket.removeCalls[0]).toEqual(expect.arrayContaining([
      'company-1/plan-1/video/old.mp4',
      'company-1/plan-2/video/older.mp4',
    ]));
  });

  test('protects objects referenced by daily_content_plans.upload_storage_object_path', async () => {
    fakeBucketSetup({ files: [
      { path: 'company-1/plan-1/video/keep.mp4', ageHours: 48 },
      { path: 'company-1/plan-1/video/orphan.mp4', ageHours: 48 },
    ]});
    referencedRows.push({
      id: 'plan-1',
      content: { upload_storage_object_path: 'company-1/plan-1/video/keep.mp4' },
    });
    const report = await runCreatorMediaStorageJanitor({ minAgeHours: 24, dryRun: false });
    expect(report.protected_count).toBe(1);
    expect(report.deleted_count).toBe(1);
    expect(bucket.removeCalls[0]).toEqual(['company-1/plan-1/video/orphan.mp4']);
  });

  test('skips objects younger than minAgeHours', async () => {
    fakeBucketSetup({ files: [
      { path: 'company-1/plan-1/video/fresh.mp4', ageHours: 1 },
      { path: 'company-1/plan-1/video/old.mp4', ageHours: 48 },
    ]});
    const report = await runCreatorMediaStorageJanitor({ minAgeHours: 24 });
    expect(report.skipped_count).toBe(1);
    expect(report.deleted_count).toBe(1);
    expect(bucket.removeCalls[0]).toEqual(['company-1/plan-1/video/old.mp4']);
  });

  test('honors maxDeletes cap', async () => {
    fakeBucketSetup({ files: [
      { path: 'c/p1/video/a.mp4', ageHours: 48 },
      { path: 'c/p1/video/b.mp4', ageHours: 48 },
      { path: 'c/p1/video/c.mp4', ageHours: 48 },
    ]});
    const report = await runCreatorMediaStorageJanitor({ minAgeHours: 24, maxDeletes: 2 });
    expect(report.deleted_count).toBe(2);
    expect(report.skipped_count).toBeGreaterThanOrEqual(1);
  });

  test('clears stale awaiting_media_upload session stamps', async () => {
    fakeBucketSetup({ files: [] });
    staleSessionRows.push(
      { id: 'plan-1', resumable_session_started_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(), content_status: 'awaiting_media_upload' },
      { id: 'plan-2', resumable_session_started_at: new Date(Date.now() - 96 * 3600 * 1000).toISOString(), content_status: 'awaiting_media_upload' },
    );
    const report = await runCreatorMediaStorageJanitor({ staleSessionHours: 48 });
    expect(report.stale_sessions_cleared).toBe(2);
    const stampUpdate = ownedUpdates.find((u) => u.payload.resumable_session_started_at === null);
    expect(stampUpdate?.ids).toEqual(['plan-1', 'plan-2']);
  });

  test('dryRun does not call storage.remove or update rows', async () => {
    fakeBucketSetup({ files: [
      { path: 'company-1/plan-1/video/old.mp4', ageHours: 48 },
    ]});
    staleSessionRows.push({
      id: 'plan-1',
      resumable_session_started_at: new Date(Date.now() - 96 * 3600 * 1000).toISOString(),
      content_status: 'awaiting_media_upload',
    });
    const report = await runCreatorMediaStorageJanitor({ minAgeHours: 24, dryRun: true });
    expect(report.deleted_count).toBe(1);
    expect(bucket.removeCalls).toHaveLength(0);
    expect(report.stale_sessions_cleared).toBe(1);
    // No row-level update under dry run
    expect(ownedUpdates.length).toBe(0);
  });

  test('reports structured counts', async () => {
    fakeBucketSetup({ files: [
      { path: 'c/p1/video/old.mp4', ageHours: 48 },
      { path: 'c/p1/video/fresh.mp4', ageHours: 1 },
      { path: 'c/p1/video/keep.mp4', ageHours: 48 },
    ]});
    referencedRows.push({
      id: 'plan-1',
      content: { upload_storage_object_path: 'c/p1/video/keep.mp4' },
    });
    const report = await runCreatorMediaStorageJanitor({ minAgeHours: 24 });
    expect(report.scanned_count).toBe(3);
    expect(report.deleted_count).toBe(1);
    expect(report.protected_count).toBe(1);
    expect(report.skipped_count).toBe(1);
    expect(report.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('also protects upload_attempted_object_path', async () => {
    fakeBucketSetup({ files: [
      { path: 'c/p1/video/half-uploaded.mp4', ageHours: 48 },
    ]});
    referencedRows.push({
      id: 'plan-1',
      content: { upload_attempted_object_path: 'c/p1/video/half-uploaded.mp4' },
    });
    const report = await runCreatorMediaStorageJanitor({ minAgeHours: 24 });
    expect(report.protected_count).toBe(1);
    expect(report.deleted_count).toBe(0);
  });
});
