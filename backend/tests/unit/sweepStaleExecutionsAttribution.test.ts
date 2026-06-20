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
const eqCalls: Array<[string, unknown]> = [];
let bulkSelectResult: { data: unknown; error: unknown } = { data: [], error: null };

function makeBuilder() {
  const b: Record<string, (...a: unknown[]) => unknown> = {
    update: (v: unknown) => { updateCalls.push(v as Record<string, unknown>); return b; },
    in: () => b,
    lt: () => b,
    or: () => b,
    is: () => b,
    eq: (c: unknown, v: unknown) => { eqCalls.push([String(c), v]); return Promise.resolve({ data: null, error: null }); },
    select: () => Promise.resolve(bulkSelectResult),
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn(() => makeBuilder()) }));

import { sweepStaleExecutions } from '../../services/queueHealth';

describe('6I-3 — sweepStaleExecutions stamps attribution on swept runs', () => {
  beforeEach(() => {
    updateCalls.length = 0;
    eqCalls.length = 0;
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

    // One attribution stamp per swept row, two columns only.
    const stamps = updateCalls.filter((u) => 'campaign_type' in u);
    expect(stamps).toHaveLength(3);
    for (const s of stamps) {
      expect(Object.keys(s).sort()).toEqual(['campaign_type', 'pipeline_mode']);
    }
    expect(stamps).toEqual(
      expect.arrayContaining([
        { campaign_type: 'bolt-combined', pipeline_mode: 'schedule' },
        { campaign_type: 'bolt-creator', pipeline_mode: 'daily_plan' },
        { campaign_type: 'bolt-text', pipeline_mode: 'week_plan' },
      ]),
    );

    // Each stamp targeted a specific run id.
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ['id', 'run-combined'],
        ['id', 'run-creator'],
        ['id', 'run-text'],
      ]),
    );
  });

  test('no swept rows → no attribution stamping', async () => {
    bulkSelectResult = { data: [], error: null };
    const result = await sweepStaleExecutions(300_000);
    expect(result.reclaimed).toBe(0);
    expect(updateCalls.filter((u) => 'campaign_type' in u)).toHaveLength(0);
  });
});
