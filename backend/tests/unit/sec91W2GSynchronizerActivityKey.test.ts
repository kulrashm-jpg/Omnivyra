/**
 * SEC-91 W2-G (STEP 3AH-91, wave-2 residuals) — W2G-3: the orchestration state
 * synchronizer never interpolates an unsafe activity key into a PostgREST
 * filter.
 *
 * synchronizeByActivity() built
 *   .or(`id.eq.${activityId},execution_id.eq.${activityId}`)
 * from its argument — the same shape W2F-1a exploited in the canonical write
 * adapter, where "<uuid>,campaign_id.eq.<other campaign>" widened the match to
 * another tenant's rows. Today its callers pass keys the adapter already
 * validated (or read from a stored row), so this is defence in depth: it now
 * reuses the adapter's isSafeActivityKey and refuses (returns null, no query)
 * any key outside [A-Za-z0-9_-]{1,200}, exactly as the adapter does.
 */
type OrCall = { table: string; filter: string };
const mockOrCalls: OrCall[] = [];
const mockFromCalls: string[] = [];

jest.mock('../../db/supabaseClient', () => {
  const builder = (table: string): any => {
    const b: any = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'is', 'neq']) b[m] = () => b;
    b.or = (filter: string) => { mockOrCalls.push({ table, filter }); return b; };
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: null, error: null });
    b.then = (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err);
    return b;
  };
  const supabase = { from: (t: string) => { mockFromCalls.push(t); return builder(t); } };
  return { supabase, default: supabase, supabaseAdmin: supabase, getSupabase: () => supabase };
});
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: jest.fn(async () => null) }));
jest.mock('../../services/executionPlannerService', () => ({ getDailyPlans: jest.fn(async () => []) }));

import { synchronizeByActivity } from '../../services/orchestration/synchronization/orchestrationStateSynchronizer';
import { isSafeActivityKey } from '../../services/orchestration/canonicalExecutionAdapter';

const UUID = '3f2b9c1e-8a4d-4e2f-9b1a-0c5d6e7f8a9b';
const OTHER_CAMPAIGN = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

beforeEach(() => {
  mockOrCalls.length = 0;
  mockFromCalls.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const UNSAFE = [
  `${UUID},campaign_id.eq.${OTHER_CAMPAIGN}`, // widens the OR to another campaign
  `${UUID})`,
  'id.neq.0',
  `${UUID} `,
  'a'.repeat(201),
  'x:y',
  '"quoted"',
];

describe('unsafe keys are refused before any query', () => {
  it.each(UNSAFE.map((k) => [JSON.stringify(k).slice(0, 60), k] as const))('%s → null, no daily_content_plans query, no .or()', async (_label, key) => {
    const out = await synchronizeByActivity(key, 'test');
    expect(out).toBeNull();
    expect(mockOrCalls).toEqual([]);
    expect(mockFromCalls).not.toContain('daily_content_plans');
  });

  it('the refusal is logged without echoing the raw key', async () => {
    const log = console.log as jest.Mock;
    await synchronizeByActivity(`${UUID},campaign_id.eq.${OTHER_CAMPAIGN}`, 'test');
    const lines = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(lines).toContain('skipped:invalid_activity_id');
    expect(lines).not.toContain(OTHER_CAMPAIGN);
  });
});

describe('safe keys behave exactly as before', () => {
  it.each([UUID, 'wk1-exec-2', 'workspace_abc-123'])('%s → one exact id/execution_id lookup', async (key) => {
    await synchronizeByActivity(key, 'test');
    expect(mockOrCalls).toEqual([{ table: 'daily_content_plans', filter: `id.eq.${key},execution_id.eq.${key}` }]);
  });

  it('empty key → null, no query (unchanged)', async () => {
    expect(await synchronizeByActivity('', 'test')).toBeNull();
    expect(mockFromCalls).toEqual([]);
  });
});

describe('same semantics as the canonical write adapter', () => {
  it.each([...UNSAFE, UUID, 'wk1-exec-2'].map((k) => [JSON.stringify(k).slice(0, 60), k] as const))(
    '%s: synchronizer queries iff isSafeActivityKey',
    async (_label, key) => {
      await synchronizeByActivity(key, 'test');
      expect(mockOrCalls.length > 0).toBe(isSafeActivityKey(key));
    },
  );
});
