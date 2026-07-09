/**
 * Phase 6I-3 — cron sweeper wiring test.
 *
 * Proves sweepStaleExecutions (cron_stale_execution_sweep) stamps
 * campaign_type + pipeline_mode on each swept run via a per-row update,
 * using the real attribution authority. The inline (execute.ts) and
 * operator-script sweepers reuse this EXACT pattern + authority.
 *
 * Narrow unit: the DB write-owner is mocked; the attribution module runs
 * for real. No live DB, no broad integration.
 */

// Collected mock interactions.
const updateCalls: Array<Record<string, unknown>> = [];
// HARDEN-004: attribution stamping is now grouped — one `.in('id', ids)`
// update per distinct (campaign_type, pipeline_mode) tuple instead of one
// `.eq('id', …)` update per row. Capture (patch, ids) pairs.
const stampGroups: Array<{ patch: Record<string, unknown>; ids: unknown[] }> = [];
let bulkSelectResult: { data: unknown; error: unknown } = { data: [], error: null };

function makeBuilder() {
  let lastUpdate: Record<string, unknown> | null = null;
  const b: Record<string, (...a: unknown[]) => unknown> = {
    update: (v: unknown) => { lastUpdate = v as Record<string, unknown>; updateCalls.push(lastUpdate); return b; },
    in: (c: unknown, v: unknown) => {
      if (String(c) === 'id' && lastUpdate && 'campaign_type' in lastUpdate) {
        stampGroups.push({ patch: lastUpdate, ids: v as unknown[] });
        return Promise.resolve({ data: null, error: null });
      }
      return b;
    },
    lt: () => b,
    or: () => b,
    is: () => b,
    eq: () => Promise.resolve({ data: null, error: null }),
    select: () => Promise.resolve(bulkSelectResult),
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn(() => makeBuilder()) }));

import { sweepStaleExecutions } from '../../services/queueHealth';

describe('6I-3 — sweepStaleExecutions stamps attribution on swept runs', () => {
  beforeEach(() => {
    updateCalls.length = 0;
    stampGroups.length = 0;
  });

  test('per-row update carries campaign_type + pipeline_mode for each surface', async () => {
    bulkSelectResult = {
      error: null,
      data: [
        { id: 'run-combined', payload: { executionConfig: { campaign_mode: 'combined' }, outcomeView: 'schedule' } },
        { id: 'run-creator', payload: { executionConfig: { campaign_mode: 'creator' }, outcomeView: 'daily_plan' } },
        { id: 'run-text', payload: { executionConfig: { campaign_mode: 'text' }, outcomeView: 'week_plan' } },
      ],
    };

    const result = await sweepStaleExecutions(300_000);
    expect(result.ok).toBe(true);
    expect(result.reclaimed).toBe(3);

    // The bulk update (status=failed + abandonment_reason) must NOT carry
    // campaign_type — that's stamped per-row afterward.
    const bulkPatch = updateCalls.find((u) => u.abandonment_reason === 'cron_stale_execution_sweep');
    expect(bulkPatch).toBeTruthy();
    expect(bulkPatch).not.toHaveProperty('campaign_type');

    // One attribution stamp per distinct tuple (all three differ here),
    // two columns only — the semantic contract is unchanged.
    expect(stampGroups).toHaveLength(3);
    for (const g of stampGroups) {
      expect(Object.keys(g.patch).sort()).toEqual(['campaign_type', 'pipeline_mode']);
    }
    const byId = new Map<string, Record<string, unknown>>();
    for (const g of stampGroups) for (const id of g.ids) byId.set(String(id), g.patch);
    expect(byId.get('run-combined')).toEqual({ campaign_type: 'bolt-combined', pipeline_mode: 'schedule' });
    expect(byId.get('run-creator')).toEqual({ campaign_type: 'bolt-creator', pipeline_mode: 'daily_plan' });
    expect(byId.get('run-text')).toEqual({ campaign_type: 'bolt-text', pipeline_mode: 'week_plan' });
  });

  test('rows sharing a tuple are stamped in ONE grouped update (HARDEN-004)', async () => {
    bulkSelectResult = {
      error: null,
      data: [
        { id: 'r1', payload: { executionConfig: { campaign_mode: 'text' }, outcomeView: 'schedule' } },
        { id: 'r2', payload: { executionConfig: { campaign_mode: 'text' }, outcomeView: 'schedule' } },
        { id: 'r3', payload: { executionConfig: { campaign_mode: 'creator' }, outcomeView: 'schedule' } },
      ],
    };
    const result = await sweepStaleExecutions(300_000);
    expect(result.reclaimed).toBe(3);
    expect(stampGroups).toHaveLength(2); // text×2 grouped, creator×1
    const textGroup = stampGroups.find((g) => g.patch.campaign_type === 'bolt-text')!;
    expect(new Set(textGroup.ids as string[])).toEqual(new Set(['r1', 'r2']));
  });

  test('no swept rows → no attribution stamping', async () => {
    bulkSelectResult = { data: [], error: null };
    const result = await sweepStaleExecutions(300_000);
    expect(result.reclaimed).toBe(0);
    expect(updateCalls.filter((u) => 'campaign_type' in u)).toHaveLength(0);
  });
});
