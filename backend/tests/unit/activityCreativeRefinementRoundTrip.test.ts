/**
 * Phase 64B-C — refinement round-trip through the REAL persistence layer.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The other refinement suites replace `creatorAssetPersistenceService` with a
 * mock. Those mocks returned `{ library: envelope }`, a shape the real
 * `libraryReadAsset` never produces (it returns `{ envelope, serverMeta }`), so
 * every suite passed while every real refinement failed and no refined version
 * was ever shown after a reload.
 *
 * Here only the database (`ownedDbTable`), config, telemetry and the render
 * orchestrator are faked. `libraryReadAsset` / `libraryWriteAsset` run for real
 * against an in-memory `creator_assets` table, so a read/write shape mismatch
 * between the refinement services and persistence cannot hide again.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const orchestrate = jest.fn();

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([col, val]) => {
    if (col === 'library->>currentVersion') {
      return String((row.library as { currentVersion?: unknown } | null)?.currentVersion) === val;
    }
    return row[col] === val;
  });
}

function tableApi(table: string) {
  const rows = (db[table] ??= []);
  const filters: Array<[string, unknown]> = [];
  const api: Record<string, any> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    order: () => api,
    limit: () => api,
    maybeSingle: async () => ({ data: rows.find((r) => matches(r, filters)) ?? null, error: null }),
    single: async () => ({ data: rows.find((r) => matches(r, filters)) ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows.filter((r) => matches(r, filters)), error: null }).then(res, rej),
    insert: (payload: Row) => {
      const clash = rows.some((r) => r.id === payload.id);
      if (!clash) rows.push({ created_at: '2026-01-01T00:00:00Z', ...payload });
      return {
        select: () => ({
          single: async () => (clash
            ? { data: null, error: { code: '23505', message: 'duplicate key' } }
            : { data: rows.find((r) => r.id === payload.id), error: null }),
        }),
      };
    },
    update: (payload: Row) => {
      const upd: Record<string, any> = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return upd; },
        select: () => upd,
        maybeSingle: async () => {
          const hit = rows.find((r) => matches(r, filters));
          if (hit) Object.assign(hit, payload);
          return { data: hit ?? null, error: null };
        },
      };
      return upd;
    },
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => tableApi(t) }));
jest.mock('../../services/creator/creatorOrchestrator', () => ({
  runCreatorOrchestration: (...a: unknown[]) => orchestrate(...a),
}));

import { refineActivityCreative } from '../../services/creator/activityCreativeRefinementService';
import { resolveActivityCreative } from '../../services/creator/activityCreativeService';

const ORIGINAL = { title: 'Campaign original', url: 'https://cdn/original.png' };

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.campaigns = [{ id: 'camp-A', company_id: 'co-A' }, { id: 'camp-B', company_id: 'co-B' }];
  db.creator_asset_attachments = [];
  db.daily_content_plans = [{
    id: 'act-A', campaign_id: 'camp-A', asset_type: 'image', content_status: 'render_ready',
    content: JSON.stringify({
      title: 'Launch week', platform: 'linkedin', creator_asset_id: 'asset-1',
      rendered_asset: { creator_asset_id: 'asset-1', urls: [ORIGINAL.url] },
    }),
  }];
  db.creator_assets = [{
    id: 'asset-1', company_id: 'co-A', user_id: 'u1', creator_type: 'image', title: ORIGINAL.title,
    url: ORIGINAL.url, files: [], metadata: {}, deleted_at: null, archived_at: null,
    library: {
      id: 'asset-1', currentVersion: 1,
      versions: [{ version: 1, op: 'generate', payload: ORIGINAL, createdAt: '2026-01-01' }],
    },
  }];
  orchestrate.mockReset().mockResolvedValue({
    output: {
      asset_payload: { title: 'Refined', url: 'https://cdn/refined.png' },
      metadata: { rendered_asset: { urls: ['https://cdn/refined.png'] } },
    },
  });
});

const stored = () => db.creator_assets.find((r) => r.id === 'asset-1')!.library as {
  currentVersion: number; versions: Array<{ version: number; op: string; payload: Row }>;
};

describe('refinement persists through the real libraryReadAsset/libraryWriteAsset', () => {
  it('appends version 2, keeps the original as version 1, and reports success', async () => {
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out).toMatchObject({ ok: true, version: 2, originalVersion: 1 });
    expect(stored().currentVersion).toBe(2);
    expect(stored().versions.map((v) => v.version)).toEqual([1, 2]);
    expect(stored().versions[0].payload).toEqual(ORIGINAL);
  });

  it('after a reload, the creative resolves to the refined current version', async () => {
    await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    const creative = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(creative).toMatchObject({ currentVersion: 2, isRefined: true });
    expect(creative!.urls).toContain('https://cdn/refined.png');
  });

  it('a second refinement becomes version 3', async () => {
    await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out).toMatchObject({ ok: true, version: 3 });
    expect(stored().versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('a foreign company cannot refine it and the stored envelope does not move', async () => {
    const before = JSON.stringify(stored());
    const out = await refineActivityCreative({ companyId: 'co-B', userId: 'u2', activityId: 'act-A' });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(stored())).toBe(before);
  });

  it('an unrefined creative reports version 1 and the campaign render', async () => {
    const creative = await resolveActivityCreative({ companyId: 'co-A', activityId: 'act-A' });
    expect(creative).toMatchObject({ currentVersion: 1, isRefined: false, urls: [ORIGINAL.url] });
  });
});
