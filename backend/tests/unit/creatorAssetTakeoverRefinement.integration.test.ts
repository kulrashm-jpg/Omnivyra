/**
 * F3 × refinement (INTEGRATION — needs the SEC-1, refinement-read-shape and F3
 * patches together; on a tree without the refinement fix it cannot discriminate
 * because refinement then reads no envelope at all).
 *
 * Company A plants a library row under the deterministic id company B's next
 * generation will compute. B generates (the persistence write), B's activity
 * references that id, then B reloads and refines it. B must never see A's
 * payload, and A's row must be left field-for-field unchanged.
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
    if (col.startsWith('metadata->>')) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return String(meta[col.slice('metadata->>'.length)] ?? '') === String(val);
    }
    return row[col] === val;
  });
}

function tableApi(table: string) {
  const rows = (db[table] ??= []);
  const filters: Array<[string, unknown]> = [];
  const found = () => rows.find((r) => matches(r, filters)) ?? null;
  const api: Record<string, any> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => ({ data: found(), error: null }),
    single: async () => ({ data: found(), error: null }),
    then: (res: any, rej: any) =>
      Promise.resolve({ data: rows.filter((r) => matches(r, filters)), error: null }).then(res, rej),
    insert: (payload: Row) => {
      const clash = rows.some((r) => r.id === payload.id);
      if (!clash) rows.push({ created_at: '2026-01-01T00:00:00Z', archived_at: null, deleted_at: null, ...payload });
      const result = clash
        ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "creator_assets_pkey"' } }
        : { data: rows.find((r) => r.id === payload.id), error: null };
      return { select: () => ({ single: async () => result }) };
    },
    upsert: (payload: Row) => {
      const hit = rows.find((r) => r.id === payload.id);
      if (hit) Object.assign(hit, payload);
      else rows.push({ created_at: '2026-01-01T00:00:00Z', archived_at: null, deleted_at: null, ...payload });
      return { select: () => ({ single: async () => ({ data: rows.find((r) => r.id === payload.id), error: null }) }) };
    },
    update: (payload: Row) => {
      const upd: Record<string, any> = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return upd; },
        select: () => upd,
        maybeSingle: async () => {
          const hit = found();
          if (hit) Object.assign(hit, payload);
          return { data: hit, error: null };
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

import { upsertCreatorAssetRecord, libraryWriteAsset } from '../../services/creatorAssetPersistenceService';
import { refineActivityCreative } from '../../services/creator/activityCreativeRefinementService';
import { resolveActivityCreative } from '../../services/creator/activityCreativeService';

const A = 'co-A';
const B = 'co-B';
const B_INPUT = { companyId: B, userId: 'u-B', creatorType: 'image', title: 'Creator asset' };
const A_SECRET = { title: 'A-only confidential deck', url: 'https://cdn/a-private.png' };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.creator_assets = [];
  db.creator_asset_attachments = [];
  db.campaigns = [{ id: 'camp-B', company_id: B }];
  db.daily_content_plans = [];
}

async function idCompanyBWillUse(): Promise<string> {
  reset();
  const id = String((await upsertCreatorAssetRecord(B_INPUT)).id);
  reset();
  return id;
}

beforeEach(() => {
  reset();
  orchestrate.mockReset().mockResolvedValue({
    output: {
      asset_payload: { title: 'B refined', url: 'https://cdn/b-refined.png' },
      metadata: { rendered_asset: { urls: ['https://cdn/b-refined.png'] } },
    },
  });
});

async function plantAsA(id: string) {
  await libraryWriteAsset({
    companyId: A,
    userId: 'u-A',
    envelope: { id, currentVersion: 1, versions: [{ version: 1, op: 'generate', payload: A_SECRET, createdAt: '2026-01-01' }] },
  });
  return JSON.parse(JSON.stringify(db.creator_assets.find((r) => r.id === id)));
}

function activityFor(assetId: string) {
  db.daily_content_plans.push({
    id: 'act-B', campaign_id: 'camp-B', asset_type: 'image', content_status: 'render_ready',
    content: JSON.stringify({ title: 'B week', platform: 'linkedin', creator_asset_id: assetId, rendered_asset: { creator_asset_id: assetId, urls: [] } }),
  });
}

async function reloadAndRefineAsB() {
  const reloaded = await resolveActivityCreative({ companyId: B, activityId: 'act-B' });
  const refined = await refineActivityCreative({ companyId: B, userId: 'u-B', activityId: 'act-B' });
  return { reloaded, refined };
}

function expectNoA(...values: unknown[]) {
  for (const v of values) expect(JSON.stringify(v ?? null)).not.toContain(A_SECRET.title);
  expect(JSON.stringify(orchestrate.mock.calls)).not.toContain(A_SECRET.title);
}

it("B's generation lands on B's own re-homed row; reload and refinement show only B's content", async () => {
  const id = await idCompanyBWillUse();
  const aBefore = await plantAsA(id);

  const bRow = await upsertCreatorAssetRecord(B_INPUT); // B's generation persists its asset
  expect(bRow.id).not.toBe(id);
  activityFor(String(bRow.id));

  const { reloaded, refined } = await reloadAndRefineAsB();
  expect(reloaded).not.toBeNull();
  expectNoA(reloaded, refined, db.creator_assets.filter((r) => r.company_id === B));
  expect(JSON.parse(JSON.stringify(db.creator_assets.find((r) => r.id === id)))).toEqual(aBefore);
});

it("an activity still pointing at the squatted id never resolves A's envelope for B", async () => {
  const id = await idCompanyBWillUse();
  const aBefore = await plantAsA(id);
  await upsertCreatorAssetRecord(B_INPUT);
  activityFor(id);

  const { reloaded, refined } = await reloadAndRefineAsB();
  expectNoA(reloaded, refined);
  expect(JSON.parse(JSON.stringify(db.creator_assets.find((r) => r.id === id)))).toEqual(aBefore);
});
