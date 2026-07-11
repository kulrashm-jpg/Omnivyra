/**
 * CHARACTERIZATION (Strategic Mix P2 pre-work) — locks the EXISTING behavior
 * of creatorAssetPersistenceService before the Asset Library evolution, so
 * every extension can be verified against this baseline:
 *
 *  - stable-id upsert (same identity inputs → same row id; overwrite not fork)
 *  - list scoping/ordering/limit
 *  - delete cascades attachments and is (id, company) scoped
 *  - attachment upsert conflict key
 *  - availability gate (CREATOR_PERSISTENCE_UNAVAILABLE)
 *
 * These are the seams the Creator save flow (handleSaveAsBlock), the writer
 * attach lifecycle, and the reuse picker depend on. NOT a spec — update
 * deliberately if the contract changes.
 */

let probeError = false; // availability probe fails when true
type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
let listRows: Record<string, unknown>[] = [];
let deleteCount = 0;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Call[] = [];
    const record = (op: string, ...args: unknown[]) => { const c = { table, op, args }; chain.push(c); calls.push(c); };
    const builder: any = {};
    for (const op of ['select', 'eq', 'in', 'order', 'limit', 'delete']) {
      builder[op] = (...args: unknown[]) => { record(op, ...args); return builder; };
    }
    builder.upsert = (payload: unknown, opts: unknown) => {
      record('upsert', payload, opts);
      return {
        select: () => ({ single: () => Promise.resolve({ data: payload as Record<string, unknown>, error: null }) }),
      };
    };
    builder.single = () => { record('single'); return builder; };
    builder.maybeSingle = () => { record('maybeSingle'); return builder; };
    builder.then = (res: any, rej: any) => {
      if (probeError) return Promise.resolve({ data: null, error: { message: 'relation does not exist' } }).then(res, rej);
      if (chain.some((c) => c.op === 'delete')) return Promise.resolve({ data: Array(deleteCount).fill({ id: 'x' }), error: null, count: deleteCount }).then(res, rej);
      return Promise.resolve({ data: listRows, error: null }).then(res, rej);
    };
    return builder;
  },
}));

jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

import * as svc from '../../services/creatorAssetPersistenceService';

const baseInput = {
  tenantId: 'co-1',
  companyId: 'co-1',
  userId: 'user-1',
  sourceType: null as 'post' | 'thread' | null,
  sourceId: null as string | null,
  creatorType: 'infographic',
  title: 'Q3 KPI infographic',
  url: 'https://cdn.example/a.png',
  metadata: { creatorBrandKit: { rendererIdentityVersion: 'v1', layoutVariantId: 'lv1' }, renderIdentityHash: 'hash-1' },
  renderIdentityHash: 'hash-1',
};

beforeEach(() => {
  calls.length = 0;
  probeError = false;
  listRows = [];
  deleteCount = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('stable-id upsert (the save/overwrite contract)', () => {
  it('same identity inputs produce the SAME row id (overwrite, not fork)', async () => {
    const a = await svc.upsertCreatorAssetRecord({ ...baseInput });
    const b = await svc.upsertCreatorAssetRecord({ ...baseInput });
    expect(a.id).toBe(b.id);
    expect(String(a.id)).toHaveLength(32);
    const upserts = calls.filter((c) => c.table === 'creator_assets' && c.op === 'upsert');
    expect(upserts).toHaveLength(2);
    expect(upserts[0].args[1]).toEqual({ onConflict: 'id' });
  });

  it('different render identity forks a different id', async () => {
    const a = await svc.upsertCreatorAssetRecord({ ...baseInput });
    const b = await svc.upsertCreatorAssetRecord({
      ...baseInput,
      renderIdentityHash: 'hash-2',
      metadata: { ...baseInput.metadata, renderIdentityHash: 'hash-2' },
    });
    expect(a.id).not.toBe(b.id);
  });

  it('persists the reconstruction metadata envelope (integrity/reconstruction/parity + recovery)', async () => {
    await svc.upsertCreatorAssetRecord({ ...baseInput });
    const upsert = calls.find((c) => c.table === 'creator_assets' && c.op === 'upsert')!;
    const row = upsert.args[0] as Record<string, unknown>;
    const md = row.metadata as Record<string, unknown>;
    expect(md.reconstructionVersion).toBe('creator-asset-reconstruction-v1');
    expect(md.integrity).toBeDefined();
    expect(md.reconstruction).toBeDefined();
    expect(md.parity).toBeDefined();
    expect((md.recovery as Record<string, unknown>).recoveryVersion).toBe('creator-asset-recovery-v1');
    expect(row.company_id).toBe('co-1');
    expect(row.creator_type).toBe('infographic');
  });

  it('gates on persistence availability with the canonical error prefix', async () => {
    // The availability probe caches for 60s at module scope — use a FRESH
    // module instance so the probe actually runs against the failing mock.
    probeError = true;
    jest.resetModules();
    jest.doMock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('../../services/creatorAssetPersistenceService');
    await expect(fresh.upsertCreatorAssetRecord({ ...baseInput })).rejects.toThrow(
      /^CREATOR_PERSISTENCE_UNAVAILABLE:/,
    );
  });
});

describe('listCreatorAssets (reuse picker / workflow recent-8 contract)', () => {
  it('scopes to company, orders newest-first, applies limit + type filter', async () => {
    listRows = [{ id: 'a1' }];
    const rows = await svc.listCreatorAssets({
      companyId: 'co-1',
      userId: 'user-1',
      creatorTypes: ['infographic', 'infographic'],
      limit: 8,
    });
    expect(rows).toEqual([{ id: 'a1' }]);
    const seq = calls.filter((c) => c.table === 'creator_assets').map((c) => c.op);
    expect(seq).toEqual(expect.arrayContaining(['select', 'eq', 'order', 'limit', 'in']));
    const eq = calls.find((c) => c.table === 'creator_assets' && c.op === 'eq')!;
    expect(eq.args).toEqual(['company_id', 'co-1']);
    const inCall = calls.find((c) => c.op === 'in')!;
    expect(inCall.args[1]).toEqual(['infographic']); // deduped
    const limit = calls.find((c) => c.op === 'limit')!;
    expect(limit.args[0]).toBe(8);
  });
});

describe('deleteCreatorAssetRecord (id+company scoped, attachment cascade)', () => {
  it('deletes attachments for the asset and the asset row, both company-scoped', async () => {
    deleteCount = 1;
    const result = await svc.deleteCreatorAssetRecord({ assetId: 'row-9', companyId: 'co-1' });
    expect(result.deletedAsset).toBe(true);
    const attachmentDelete = calls.filter((c) => c.table === 'creator_asset_attachments' && c.op === 'delete');
    const assetDelete = calls.filter((c) => c.table === 'creator_assets' && c.op === 'delete');
    expect(attachmentDelete.length).toBeGreaterThanOrEqual(1);
    expect(assetDelete.length).toBeGreaterThanOrEqual(1);
    const companyScopes = calls.filter((c) => c.op === 'eq' && c.args[0] === 'company_id');
    expect(companyScopes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('attachCreatorAsset (writer attach lifecycle contract)', () => {
  it('upserts the asset first, then the attachment with the composite conflict key', async () => {
    await svc.attachCreatorAsset({
      tenantId: 'co-1',
      companyId: 'co-1',
      userId: 'user-1',
      sourceType: 'post',
      sourceId: 'post-1',
      creatorType: 'image',
      title: 'Hero image',
      url: 'https://cdn.example/b.png',
      metadata: { creatorBrandKit: { rendererIdentityVersion: 'v1', layoutVariantId: 'lv1' }, renderIdentityHash: 'h2' },
      renderIdentityHash: 'h2',
    } as never);
    const order = calls.filter((c) => c.op === 'upsert').map((c) => c.table);
    expect(order).toEqual(['creator_assets', 'creator_asset_attachments']);
    const attachment = calls.filter((c) => c.op === 'upsert' && c.table === 'creator_asset_attachments')[0];
    expect(attachment.args[1]).toEqual({ onConflict: 'company_id,user_id,source_type,source_id,creator_asset_id' });
  });
});
