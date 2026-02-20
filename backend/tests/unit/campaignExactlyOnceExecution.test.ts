/**
 * Campaign Exactly-Once Execution — checkpoint-based tests.
 * Verifies: no duplicate content on resume, safe regenerate, idempotent retries, single advancement.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../db/contentAssetStore', () => ({
  getContentAssetById: jest.fn(),
  listContentAssets: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { getContentAssetById, listContentAssets } from '../../db/contentAssetStore';
import {
  createCheckpoint,
  completeCheckpoint,
  resolveOrphanedCheckpoints,
  abandonCheckpoint,
} from '../../services/campaignExecutionCheckpointService';
import {
  startCampaign,
  markDayComplete,
  getCampaignState,
  resumeCampaign,
} from '../../services/campaignExecutionStateService';

const CAMPAIGN = 'campaign-exactly-once-1';

type StateRow = Record<string, unknown>;
type CheckpointRow = Record<string, unknown>;

function createMocks() {
  const stateStore = new Map<string, StateRow>();
  const checkpointStore = new Map<string, CheckpointRow>();
  const contentStore = new Map<string, { campaign_id: string; week_number: number; day: string }>();

  const ckKey = (c: string, w: number, d: number) => `${c}:${w}:${d}`;

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaign_execution_state') {
      return {
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: () => Promise.resolve({ data: stateStore.get(val) ?? null, error: null }),
          }),
        }),
        insert: (p: StateRow) => {
          const cid = p.campaign_id as string;
          if (stateStore.has(cid)) {
            return { select: () => ({ single: () => Promise.resolve({ data: stateStore.get(cid), error: null }) }) };
          }
          const row = {
            id: `gen-${cid}`,
            campaign_id: cid,
            duration_weeks: p.duration_weeks ?? 4,
            current_week: p.current_week ?? 1,
            current_day: p.current_day ?? 1,
            completed_weeks: p.completed_weeks ?? [],
            completed_days: p.completed_days ?? [],
            momentum_snapshot: p.momentum_snapshot ?? { week: 1, momentum_level: 'low', psychological_movement: 'Awareness' },
            last_generated_content_id: p.last_generated_content_id ?? null,
            status: p.status ?? 'active',
            started_at: p.started_at ?? null,
            updated_at: new Date().toISOString(),
          };
          stateStore.set(cid, row);
          return { select: () => ({ single: () => Promise.resolve({ data: stateStore.get(cid), error: null }) }) };
        },
        update: (p: StateRow) => ({
          eq: (col: string, val: string) => ({
            select: () => ({
              single: () => {
                const existing = stateStore.get(val);
                if (!existing) return Promise.resolve({ data: null, error: { message: 'not found' } });
                const merged = { ...existing, ...p };
                stateStore.set(val, merged);
                return Promise.resolve({ data: stateStore.get(val), error: null });
              },
            }),
          }),
        }),
      };
    }

    if (table === 'campaign_execution_checkpoint') {
      return {
        select: () => ({
          eq: (col: string, val: string | number) => ({
            eq: (c2: string, v2: string | number) => ({
              eq: (c3: string, v3: string | number) => ({
                maybeSingle: () => {
                  const key = col === 'campaign_id' ? ckKey(val as string, v2 as number, v3 as number) : '';
                  return Promise.resolve({ data: checkpointStore.get(key) ?? null, error: null });
                },
                single: () => {
                  const key = col === 'campaign_id' ? ckKey(val as string, v2 as number, v3 as number) : '';
                  const d = checkpointStore.get(key);
                  return Promise.resolve({ data: d ?? null, error: d ? null : { message: 'not found' } });
                },
              }),
              maybeSingle: () => {
                const key = col === 'campaign_id' && c2 === 'week' ? ckKey(val as string, v2 as number, 1) : '';
                return Promise.resolve({ data: checkpointStore.get(key) ?? null, error: null });
              },
              then: (resolve: any) =>
                Promise.resolve({
                  data: Array.from(checkpointStore.entries())
                    .filter(([, r]) => (r as any).campaign_id === val && (r as any).status === v2)
                    .map(([, r]) => r),
                  error: null,
                }).then(resolve),
            }),
          }),
        }),
        insert: (p: CheckpointRow) => {
          const key = ckKey(p.campaign_id as string, p.week as number, p.day as number);
          const row = {
            id: `ck-${key}`,
            campaign_id: p.campaign_id,
            week: p.week,
            day: p.day,
            status: p.status ?? 'in_progress',
            content_id: p.content_id ?? null,
            content_source: p.content_source ?? 'content_assets',
            updated_at: new Date().toISOString(),
          };
          checkpointStore.set(key, row);
          return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
        },
        update: (p: CheckpointRow) => ({
          eq: (c: string, v: string | number) => ({
            eq: (c2: string, v2: string | number) => ({
              eq: (c3: string, v3: string | number) => ({
                eq: (c4: string, v4: string | number) => ({
                  select: () => ({
                    single: () => {
                      const key = c === 'campaign_id' ? ckKey(v as string, v2 as number, v3 as number) : '';
                      const existing = checkpointStore.get(key);
                      if (!existing) return Promise.resolve({ data: null, error: { message: 'not found' } });
                      const merged = { ...existing, ...p };
                      checkpointStore.set(key, merged);
                      return Promise.resolve({ data: merged, error: null });
                    },
                    maybeSingle: () => {
                      const key = c === 'campaign_id' ? ckKey(v as string, v2 as number, v3 as number) : '';
                      const existing = checkpointStore.get(key);
                      if (!existing) return Promise.resolve({ data: null, error: null });
                      const merged = { ...existing, ...p };
                      checkpointStore.set(key, merged);
                      return Promise.resolve({ data: merged, error: null });
                    },
                  }),
                }),
                select: () => ({
                  single: () => {
                    const key = c === 'campaign_id' ? ckKey(v as string, v2 as number, v3 as number) : '';
                    const existing = checkpointStore.get(key);
                    if (!existing) return Promise.resolve({ data: null, error: { message: 'not found' } });
                    const merged = { ...existing, ...p };
                    checkpointStore.set(key, merged);
                    return Promise.resolve({ data: merged, error: null });
                  },
                  maybeSingle: () => {
                    const key = c === 'campaign_id' ? ckKey(v as string, v2 as number, v3 as number) : '';
                    const existing = checkpointStore.get(key);
                    if (!existing) return Promise.resolve({ data: null, error: null });
                    const merged = { ...existing, ...p };
                    checkpointStore.set(key, merged);
                    return Promise.resolve({ data: merged, error: null });
                  },
                }),
              }),
            }),
          }),
        }),
      };
    }

    if (table === 'content_assets') {
      return {
        select: () => ({
          eq: (col: string, val: string | number) => ({
            single: () => {
              if (col === 'asset_id') {
                const meta = contentStore.get(val as string);
                return Promise.resolve({
                  data: meta ? { asset_id: val, ...meta } : null,
                  error: meta ? null : { message: 'not found' },
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
            order: () => ({
              then: (resolve: any) => {
                const matches = Array.from(contentStore.entries())
                  .filter(([, m]) => m.campaign_id === val)
                  .map(([id, m]) => ({ asset_id: id, ...m }));
                return Promise.resolve({ data: matches, error: null }).then(resolve);
              },
            }),
          }),
        }),
      };
    }

    return {};
  });

  return { stateStore, checkpointStore, contentStore };
}

function setupContentAssetMock(contentStore: Map<string, { campaign_id: string; week_number: number; day: string }>) {
  (getContentAssetById as jest.Mock).mockImplementation((assetId: string) => {
    const meta = contentStore.get(assetId);
    return Promise.resolve(meta ? { asset_id: assetId, ...meta } : null);
  });
  (listContentAssets as jest.Mock).mockImplementation((input: { campaignId: string; weekNumber?: number }) => {
    const matches = Array.from(contentStore.entries())
      .filter(([, m]) => m.campaign_id === input.campaignId && (!input.weekNumber || m.week_number === input.weekNumber))
      .map(([id, m]) => ({ asset_id: id, ...m }));
    return Promise.resolve(matches);
  });
}

describe('campaign_exactly_once_execution', () => {
  let contentStore: Map<string, { campaign_id: string; week_number: number; day: string }>;

  beforeEach(() => {
    jest.clearAllMocks();
    const mocks = createMocks();
    contentStore = mocks.contentStore;
    setupContentAssetMock(contentStore);
  });

  it('1. Crash after content generation but before markDayComplete: resume does NOT duplicate content', async () => {
    await startCampaign(CAMPAIGN, 4);
    await createCheckpoint(CAMPAIGN, 1, 1);

    const contentId = `content-${Date.now()}`;
    contentStore.set(contentId, { campaign_id: CAMPAIGN, week_number: 1, day: 'Monday' });

    const { finalized, abandoned } = await resolveOrphanedCheckpoints(CAMPAIGN);

    expect(finalized).toContainEqual({ week: 1, day: 1 });
    expect(abandoned).not.toContainEqual({ week: 1, day: 1 });

    const state = await getCampaignState(CAMPAIGN);
    expect(state?.completed_days).toContainEqual({ week: 1, day: 1 });
    expect(state?.current_day).toBe(2);
  });

  it('2. Crash before content save: content regenerates safely', async () => {
    await startCampaign(CAMPAIGN, 4);
    await createCheckpoint(CAMPAIGN, 1, 1);

    const { finalized, abandoned } = await resolveOrphanedCheckpoints(CAMPAIGN);

    expect(abandoned).toContainEqual({ week: 1, day: 1 });
    expect(finalized).not.toContainEqual({ week: 1, day: 1 });

    const state = await getCampaignState(CAMPAIGN);
    expect(state?.current_week).toBe(1);
    expect(state?.current_day).toBe(1);

    const cp = await createCheckpoint(CAMPAIGN, 1, 1);
    expect(cp?.status).toBe('in_progress');
  });

  it('3. Repeated retries do not create duplicates', async () => {
    await startCampaign(CAMPAIGN, 4);
    await createCheckpoint(CAMPAIGN, 1, 1);

    const contentId = 'content-retry-1';
    contentStore.set(contentId, { campaign_id: CAMPAIGN, week_number: 1, day: 'Monday' });

    await completeCheckpoint(CAMPAIGN, 1, 1, contentId);
    const result2 = await completeCheckpoint(CAMPAIGN, 1, 1, contentId);
    const result3 = await completeCheckpoint(CAMPAIGN, 1, 1, contentId);

    expect(result2).not.toBeNull();
    expect(result3).not.toBeNull();

    const state = await getCampaignState(CAMPAIGN);
    const day1Count = state?.completed_days.filter((d) => d.week === 1 && d.day === 1).length ?? 0;
    expect(day1Count).toBe(1);
  });

  it('4. Progression advances only once', async () => {
    await startCampaign(CAMPAIGN, 4);
    await createCheckpoint(CAMPAIGN, 1, 1);

    const contentId = 'content-prog-1';
    contentStore.set(contentId, { campaign_id: CAMPAIGN, week_number: 1, day: 'Monday' });

    await completeCheckpoint(CAMPAIGN, 1, 1, contentId);

    const state1 = await getCampaignState(CAMPAIGN);
    expect(state1?.current_week).toBe(1);
    expect(state1?.current_day).toBe(2);

    await completeCheckpoint(CAMPAIGN, 1, 1, contentId);
    await completeCheckpoint(CAMPAIGN, 1, 1, contentId);

    const state2 = await getCampaignState(CAMPAIGN);
    expect(state2?.current_week).toBe(1);
    expect(state2?.current_day).toBe(2);
  });

  it('edge: resolveOrphanedCheckpoints with no orphaned checkpoints returns empty', async () => {
    await startCampaign(CAMPAIGN, 4);
    const { finalized, abandoned } = await resolveOrphanedCheckpoints(CAMPAIGN);
    expect(finalized).toEqual([]);
    expect(abandoned).toEqual([]);
  });

  it('edge: createCheckpoint for completed day returns null', async () => {
    await startCampaign(CAMPAIGN, 4);
    await createCheckpoint(CAMPAIGN, 1, 1);
    const contentId = 'content-completed-1';
    contentStore.set(contentId, { campaign_id: CAMPAIGN, week_number: 1, day: 'Monday' });
    await completeCheckpoint(CAMPAIGN, 1, 1, contentId);

    const cp = await createCheckpoint(CAMPAIGN, 1, 1);
    expect(cp).toBeNull();
  });
});
