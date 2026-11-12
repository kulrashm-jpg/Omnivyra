/**
 * S2 tenant seam (e1) - backend/services/campaignExecutionCheckpointService.ts. campaign_execution_checkpoint and
 * daily_content_plans are CHILD tables of campaigns (via campaign_id). campaigns.id is the primary key, so B's
 * campaign cannot share A's campaign id; instead every B checkpoint / plan row shares its own id (and week/day) with
 * an A row. Tenant A must never read, update or create rows under B's campaign, and a B plan must never count as
 * content for A's checkpoint.
 */
jest.mock('../../db/writeOwner', () => require('../helpers/s2FaithfulFakeDb').writeOwnerModule());
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('raw supabase.from must not be used'); } } }));
jest.mock('../../db/contentAssetStore', () => ({
  getContentAssetById: jest.fn(async () => null),
  listContentAssets: jest.fn(async () => []),
}));
jest.mock('../../services/campaignExecutionStateService', () => ({
  markDayComplete: jest.fn(async (campaignId: string) => ({ campaign_id: campaignId })),
  getCampaignState: jest.fn(async (campaignId: string) => ({ campaign_id: campaignId })),
}));

import { db, writes, reads, resetDb } from '../helpers/s2FaithfulFakeDb';
import { tenantContextFor } from '../../db/tenantTable';
import { markDayComplete } from '../../services/campaignExecutionStateService';
import {
  createCheckpoint,
  completeCheckpoint,
  abandonCheckpoint,
  resolveOrphanedCheckpoints,
  getCheckpoint,
} from '../../services/campaignExecutionCheckpointService';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CA = 'ca000000-0000-4000-8000-00000000000a';
const CB = 'cb000000-0000-4000-8000-00000000000b';
const CK = 'campaign_execution_checkpoint';
const ctxA = tenantContextFor({ userId: 'user-a' }, A);

function seed() {
  resetDb({
    campaigns: [
      { id: CA, company_id: A },
      { id: CB, company_id: B },
    ],
    [CK]: [
      { id: 'ck-1', campaign_id: CA, week: 1, day: 1, status: 'in_progress', content_id: null, content_source: 'content_assets' },
      { id: 'ck-2', campaign_id: CA, week: 1, day: 2, status: 'in_progress', content_id: 'plan-1', content_source: 'daily_content_plans' },
      { id: 'ck-3', campaign_id: CA, week: 1, day: 3, status: 'abandoned', content_id: null, content_source: 'content_assets' },
      // B: same ids and the same (week, day) slots, under B's campaign
      { id: 'ck-1', campaign_id: CB, week: 1, day: 1, status: 'in_progress', content_id: null, content_source: 'content_assets' },
      { id: 'ck-2', campaign_id: CB, week: 1, day: 2, status: 'in_progress', content_id: 'plan-1', content_source: 'daily_content_plans' },
      { id: 'ck-3', campaign_id: CB, week: 1, day: 3, status: 'abandoned', content_id: null, content_source: 'content_assets' },
    ],
    daily_content_plans: [
      // plan-1 exists ONLY under B's campaign (A's checkpoint names it)
      { id: 'plan-1', campaign_id: CB },
    ],
  }, { [CK]: [['campaign_id', 'week', 'day']] });
  (markDayComplete as jest.Mock).mockClear();
}
const bRows = () => JSON.stringify(db[CK].filter((r) => r.campaign_id === CB));
const bWrites = () => writes.filter((w) => w.affected.some((r) => r.campaign_id === CB) || JSON.stringify(w.payload ?? '').includes(CB));

beforeEach(seed);

describe('campaignExecutionCheckpointService under the tenant seam', () => {
  it('getCheckpoint reads A\'s row for A\'s campaign (B\'s same-id, same-slot row is not seen)', async () => {
    const cp = await getCheckpoint(ctxA, CA, 1, 1);
    expect(cp).toMatchObject({ id: 'ck-1', campaign_id: CA });
    // the campaign was verified under A before the child read
    expect(reads.find((r) => r.table === 'campaigns')?.filters).toContainEqual({ op: 'eq', col: 'company_id', value: A });
  });

  it('getCheckpoint for B\'s campaign is refused for A (TENANT_MISMATCH), never read', async () => {
    await expect(getCheckpoint(ctxA, CB, 1, 1)).rejects.toThrow(/TENANT_MISMATCH/);
    expect(reads.filter((r) => r.table === CK)).toHaveLength(0);
  });

  it('createCheckpoint inserts under A\'s campaign (stamped) and touches nothing of B', async () => {
    const before = bRows();
    const cp = await createCheckpoint(ctxA, CA, 2, 1);
    expect(cp).toMatchObject({ campaign_id: CA, week: 2, day: 1, status: 'in_progress' });
    const ins = writes.filter((w) => w.verb === 'insert');
    expect(ins).toHaveLength(1);
    expect((ins[0].payload as any).campaign_id).toBe(CA);
    expect(bRows()).toBe(before);
  });

  it('createCheckpoint re-opens A\'s abandoned slot only (B\'s abandoned same slot stays abandoned)', async () => {
    const cp = await createCheckpoint(ctxA, CA, 1, 3);
    expect(cp).toMatchObject({ campaign_id: CA, status: 'in_progress' });
    expect(db[CK].find((r) => r.campaign_id === CB && r.day === 3)?.status).toBe('abandoned');
    const upd = writes.filter((w) => w.verb === 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0].filters).toContainEqual({ op: 'eq', col: 'campaign_id', value: CA });
  });

  it('createCheckpoint naming B\'s campaign is refused and writes nothing', async () => {
    const before = bRows();
    await expect(createCheckpoint(ctxA, CB, 5, 5)).rejects.toThrow(/TENANT_MISMATCH/);
    expect(writes).toHaveLength(0);
    expect(bRows()).toBe(before);
  });

  it('completeCheckpoint completes A\'s slot only and advances A\'s campaign', async () => {
    const before = bRows();
    const res = await completeCheckpoint(ctxA, CA, 1, 1, 'content-a');
    expect(res?.checkpoint).toMatchObject({ campaign_id: CA, status: 'completed', content_id: 'content-a' });
    expect(bRows()).toBe(before);
    expect(markDayComplete).toHaveBeenCalledWith(CA, 1, 1, 'content-a');
    expect(bWrites()).toHaveLength(0);
  });

  it('completeCheckpoint / abandonCheckpoint naming B\'s campaign are refused; B is untouched', async () => {
    const before = bRows();
    await expect(completeCheckpoint(ctxA, CB, 1, 1, 'content-x')).rejects.toThrow(/TENANT_MISMATCH/);
    await expect(abandonCheckpoint(ctxA, CB, 1, 1)).rejects.toThrow(/TENANT_MISMATCH/);
    expect(writes).toHaveLength(0);
    expect(markDayComplete).not.toHaveBeenCalled();
    expect(bRows()).toBe(before);
  });

  it('resolveOrphanedCheckpoints handles A\'s in-progress rows only; B\'s plan never counts as A\'s content', async () => {
    const before = bRows();
    const res = await resolveOrphanedCheckpoints(ctxA, CA);
    // ck-1: no content -> abandoned; ck-2 names plan-1, which exists only under B's campaign -> abandoned, NOT finalized
    expect(res.finalized).toEqual([]);
    expect(res.abandoned).toEqual(expect.arrayContaining([{ week: 1, day: 1 }, { week: 1, day: 2 }]));
    expect(res.abandoned).toHaveLength(2);
    expect(bRows()).toBe(before);
    expect(markDayComplete).not.toHaveBeenCalled();
    expect(bWrites()).toHaveLength(0);
  });

  it('resolveOrphanedCheckpoints finalizes when the plan IS one of A\'s campaign plans (positive control)', async () => {
    db.daily_content_plans.push({ id: 'plan-1', campaign_id: CA });
    const res = await resolveOrphanedCheckpoints(ctxA, CA);
    expect(res.finalized).toEqual([{ week: 1, day: 2 }]);
    expect(markDayComplete).toHaveBeenCalledWith(CA, 1, 2, 'plan-1');
  });
});
