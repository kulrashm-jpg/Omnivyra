/**
 * S2 tenant seam - boltPersistenceGuards (e1). insertCampaignOrThrow / insertCampaignVersionOrThrow /
 * updateCampaignVersionOrThrow take the caller's TenantContext: inserts are stamped with the tenant's
 * company_id (a row naming another tenant is refused), and the version update is pinned to the tenant.
 *
 * Cross-tenant negative: company B owns a campaign_versions row with the SAME id as A's; A's update never
 * touches it. The fake applies every filter and records every write's filters.
 */
type Row = Record<string, unknown>;
const mockWrites: Array<{ table: string; op: string; filters: Array<[string, string, unknown]> }> = [];
function mockRecordingTable(table: string) {
  const { fakeTable } = require('../helpers/fakeWhatsappDb');
  const b = fakeTable(table);
  const rec = { table, op: 'select', filters: [] as Array<[string, string, unknown]> };
  for (const op of ['insert', 'update', 'upsert']) {
    const orig = b[op];
    b[op] = (...a: unknown[]) => { rec.op = op; return orig(...a); };
  }
  for (const f of ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte']) {
    const orig = b[f];
    b[f] = (col: string, v: unknown) => { rec.filters.push([f, col, v]); return orig(col, v); };
  }
  const then = b.then;
  b.then = (res: any, rej: any) => { if (rec.op !== 'select') mockWrites.push(rec); return then(res, rej); };
  return b;
}
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockRecordingTable(t),
  ownedDbRpc: async () => ({ data: null, error: null }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockRecordingTable(t) } }));

import { fakeDb, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { tenantContextFor } from '../../db/tenantTable';
import {
  insertCampaignOrThrow, insertCampaignVersionOrThrow, updateCampaignVersionOrThrow,
} from '../../services/boltPersistenceGuards';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const VER = 'cccccccc-0000-4000-8000-000000000003';
const tenantA = tenantContextFor({ userId: 'user-a' }, A);
const verB: Row = { id: VER, company_id: B, campaign_id: 'camp-b', status: 'draft' };

beforeEach(() => {
  mockWrites.length = 0;
  resetFakeDb({
    campaigns: [{ id: 'camp-b', company_id: B, name: 'B campaign' }],
    campaign_versions: [{ id: VER, company_id: A, campaign_id: 'camp-a', status: 'draft' }, { ...verB }],
  });
});

it('inserts are stamped with A; a row naming B is refused and nothing is written', async () => {
  await insertCampaignOrThrow(tenantA, { id: 'camp-a', name: 'A campaign' });
  await insertCampaignVersionOrThrow(tenantA, { id: 'ver-new', campaign_id: 'camp-a' });
  expect(fakeDb.tables.campaigns.find((c) => c.id === 'camp-a')!.company_id).toBe(A);
  expect(fakeDb.tables.campaign_versions.find((v) => v.id === 'ver-new')!.company_id).toBe(A);

  const before = JSON.stringify(fakeDb.tables);
  await expect(insertCampaignOrThrow(tenantA, { id: 'camp-x', company_id: B })).rejects.toThrow(/TENANT_MISMATCH/);
  await expect(insertCampaignVersionOrThrow(tenantA, { id: 'ver-x', campaign_id: 'camp-b', company_id: B })).rejects.toThrow(/TENANT_MISMATCH/);
  expect(JSON.stringify(fakeDb.tables)).toBe(before);
});

it('A\'s version update reaches only A\'s row, never B\'s row with the same id', async () => {
  await updateCampaignVersionOrThrow(tenantA, VER, { status: 'committed' });
  const rows = fakeDb.tables.campaign_versions;
  expect(rows.find((r) => r.company_id === A)!.status).toBe('committed');
  expect(rows.find((r) => r.company_id === B)).toEqual(verB);
  const upd = mockWrites.find((w) => w.table === 'campaign_versions' && w.op === 'update')!;
  expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'company_id', A], ['eq', 'id', VER]]));
});
