/**
 * Campaign Execution State — fault tolerance / resilience tests.
 * Verifies: crash recovery, idempotency, completed campaign no restart, momentum preservation.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  startCampaign,
  markDayComplete,
  markWeekComplete,
  getCampaignState,
  resumeCampaign,
} from '../../services/campaignExecutionStateService';

const CAMPAIGN_1 = 'campaign-resilience-1';
const CAMPAIGN_2 = 'campaign-resilience-2';
const CAMPAIGN_3 = 'campaign-resilience-3';
const CAMPAIGN_4 = 'campaign-resilience-4';
const CAMPAIGN_5 = 'campaign-resilience-5';

type StateRow = Record<string, unknown>;

function createMockSupabase(store: Map<string, StateRow>) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table !== 'campaign_execution_state') {
      return {};
    }
    return {
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: () => Promise.resolve({ data: store.get(val) ?? null, error: null }),
          single: () => {
            const d = store.get(val);
            return Promise.resolve({ data: d ?? null, error: d ? null : { message: 'not found' } });
          },
        }),
      }),
      insert: (payload: StateRow) => {
        const cid = payload.campaign_id as string;
        if (store.has(cid)) {
          const existing = store.get(cid)!;
          return { select: () => ({ single: () => Promise.resolve({ data: existing, error: null }) }) };
        }
        const row: StateRow = {
          id: `gen-${cid}`,
          campaign_id: cid,
          duration_weeks: payload.duration_weeks ?? 4,
          current_week: payload.current_week ?? 1,
          current_day: payload.current_day ?? 1,
          completed_weeks: payload.completed_weeks ?? [],
          completed_days: payload.completed_days ?? [],
          momentum_snapshot: payload.momentum_snapshot ?? { week: 1, momentum_level: 'low', psychological_movement: 'Awareness' },
          last_generated_content_id: payload.last_generated_content_id ?? null,
          status: payload.status ?? 'active',
          started_at: payload.started_at ?? null,
          updated_at: payload.updated_at ?? new Date().toISOString(),
        };
        store.set(cid, row);
        return { select: () => ({ single: () => Promise.resolve({ data: store.get(cid), error: null }) }) };
      },
      update: (payload: StateRow) => ({
        eq: (col: string, val: string) => ({
          select: () => ({
            single: () => {
              const existing = store.get(val);
              if (!existing) return Promise.resolve({ data: null, error: { message: 'not found' } });
              const merged = { ...existing, ...payload };
              store.set(val, merged);
              return Promise.resolve({ data: store.get(val), error: null });
            },
          }),
        }),
      }),
    };
  });
}

describe('campaign_execution_resilience', () => {
  let store: Map<string, StateRow>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new Map();
    createMockSupabase(store);
  });

  it('1. Server crash mid-week → resume continues same week next day', async () => {
    await startCampaign(CAMPAIGN_1, 4);
    await markDayComplete(CAMPAIGN_1, 1, 1);
    await markDayComplete(CAMPAIGN_1, 1, 2);

    const stateBeforeCrash = await getCampaignState(CAMPAIGN_1);
    expect(stateBeforeCrash?.current_week).toBe(1);
    expect(stateBeforeCrash?.current_day).toBe(3);

    const resume = await resumeCampaign(CAMPAIGN_1);
    expect(resume?.next_week).toBe(1);
    expect(resume?.next_day).toBe(3);
    expect(resume?.is_completed).toBe(false);
  });

  it('2. Crash after week complete → resume starts next week', async () => {
    await startCampaign(CAMPAIGN_2, 4);
    for (let d = 1; d <= 7; d++) await markDayComplete(CAMPAIGN_2, 1, d);

    const resume = await resumeCampaign(CAMPAIGN_2);
    expect(resume?.next_week).toBe(2);
    expect(resume?.next_day).toBe(1);
  });

  it('3. Completed campaign does not restart', async () => {
    await startCampaign(CAMPAIGN_3, 2);
    for (let w = 1; w <= 2; w++) {
      for (let d = 1; d <= 7; d++) await markDayComplete(CAMPAIGN_3, w, d);
    }

    const resumeAfterComplete = await resumeCampaign(CAMPAIGN_3);
    expect(resumeAfterComplete?.status).toBe('completed');
    expect(resumeAfterComplete?.is_completed).toBe(true);

    const state = await getCampaignState(CAMPAIGN_3);
    expect(state?.status).toBe('completed');

    const startAgain = await startCampaign(CAMPAIGN_3, 2);
    expect(startAgain?.status).toBe('completed');
    expect(startAgain?.completed_weeks).toContain(1);
    expect(startAgain?.completed_weeks).toContain(2);
  });

  it('4. Duplicate markDayComplete does not corrupt state', async () => {
    await startCampaign(CAMPAIGN_4, 4);
    const first = await markDayComplete(CAMPAIGN_4, 1, 1);
    const dup = await markDayComplete(CAMPAIGN_4, 1, 1);

    expect(dup?.current_week).toBe(first?.current_week);
    expect(dup?.current_day).toBe(first?.current_day);
    expect(dup?.completed_days.filter((d) => d.week === 1 && d.day === 1)).toHaveLength(1);
  });

  it('5. Partial day completion does not reset momentum', async () => {
    await startCampaign(CAMPAIGN_5, 8);
    await markDayComplete(CAMPAIGN_5, 1, 1);
    await markDayComplete(CAMPAIGN_5, 1, 2);

    const stateMidWeek = await getCampaignState(CAMPAIGN_5);
    const momentumBefore = stateMidWeek?.momentum_snapshot.momentum_level;

    await markDayComplete(CAMPAIGN_5, 1, 3);

    const stateAfter = await getCampaignState(CAMPAIGN_5);
    expect(stateAfter?.momentum_snapshot.momentum_level).toBe(momentumBefore);
    expect(stateAfter?.momentum_snapshot.week).toBe(1);
  });

  it('edge: resumeCampaign twice is idempotent', async () => {
    await startCampaign(CAMPAIGN_1, 4);
    await markDayComplete(CAMPAIGN_1, 1, 1);

    const r1 = await resumeCampaign(CAMPAIGN_1);
    const r2 = await resumeCampaign(CAMPAIGN_1);

    expect(r1?.next_week).toBe(r2?.next_week);
    expect(r1?.next_day).toBe(r2?.next_day);
  });

  it('edge: markWeekComplete on completed campaign is no-op', async () => {
    await startCampaign(CAMPAIGN_2, 2);
    for (let w = 1; w <= 2; w++) {
      for (let d = 1; d <= 7; d++) await markDayComplete(CAMPAIGN_2, w, d);
    }

    const before = await getCampaignState(CAMPAIGN_2);
    await markWeekComplete(CAMPAIGN_2, 1);
    const after = await getCampaignState(CAMPAIGN_2);

    expect(before?.status).toBe('completed');
    expect(after?.status).toBe('completed');
  });
});
