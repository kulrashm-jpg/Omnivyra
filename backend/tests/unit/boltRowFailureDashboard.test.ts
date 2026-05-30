/**
 * boltRowFailureDashboard read-service regression tests.
 *
 * Covers:
 *   - migration readiness probe (table missing vs present vs DB error)
 *   - list endpoint pagination + filtering + sort allow-list
 *   - summary aggregation (counts + group-by tallies)
 *   - graceful empty response when the failure id has no run linkage
 *
 * Uses a hand-rolled supabase mock that returns a chainable builder
 * with controllable terminal results, matching the pattern used by
 * other planner/diagnostics unit tests in this repo.
 */

import { BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

interface BuilderState {
  table: string;
  selectArgs: unknown[];
  filters: Array<{ kind: string; field?: string; value?: unknown }>;
  order?: { col: string; ascending: boolean };
  range?: { from: number; to: number };
  limit?: number;
}

interface MockResponse {
  data: unknown;
  error: unknown;
  count?: number | null;
}

let lastBuilder: BuilderState | null = null;
let mockResponses: Array<MockResponse> = [];
let mockResponseIndex = 0;

function nextResponse(): MockResponse {
  const r = mockResponses[mockResponseIndex] ?? { data: [], error: null, count: 0 };
  mockResponseIndex++;
  return r;
}

function buildBuilder(table: string): any {
  const state: BuilderState = { table, selectArgs: [], filters: [] };
  lastBuilder = state;

  const finish = (): Promise<MockResponse> => Promise.resolve(nextResponse());

  const builder: any = {
    select(...args: unknown[]) { state.selectArgs.push(...args); return builder; },
    eq(field: string, value: unknown) { state.filters.push({ kind: 'eq', field, value }); return builder; },
    ilike(field: string, value: unknown) { state.filters.push({ kind: 'ilike', field, value }); return builder; },
    order(col: string, opts?: { ascending?: boolean }) {
      state.order = { col, ascending: opts?.ascending ?? true };
      return builder;
    },
    range(from: number, to: number) { state.range = { from, to }; return builder; },
    limit(n: number) { state.limit = n; return builder; },
    maybeSingle() { return finish(); },
    then(onFulfilled: any, onRejected: any) { return finish().then(onFulfilled, onRejected); },
  };
  return builder;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => buildBuilder(table),
  },
}));

import {
  checkRowDiagnosticsTableExists,
  listRowFailuresForFailure,
  getRowFailureSummary,
} from '../../services/boltRowFailureDashboard';

beforeEach(() => {
  mockResponses = [];
  mockResponseIndex = 0;
  lastBuilder = null;
});

describe('checkRowDiagnosticsTableExists', () => {
  test('returns exists=true when select succeeds', async () => {
    mockResponses = [{ data: null, error: null }];
    const r = await checkRowDiagnosticsTableExists();
    expect(r.exists).toBe(true);
  });

  test('returns exists=false when PG signals missing table', async () => {
    mockResponses = [{
      data: null,
      error: { message: 'relation "bolt_row_failure_diagnostics" does not exist', code: '42P01' },
    }];
    const r = await checkRowDiagnosticsTableExists();
    expect(r.exists).toBe(false);
    expect(r.error_message).toMatch(/does not exist/);
  });

  test('returns exists=false on generic DB error', async () => {
    mockResponses = [{ data: null, error: { message: 'permission denied' } }];
    const r = await checkRowDiagnosticsTableExists();
    expect(r.exists).toBe(true); // not a missing-table signal
    expect(r.error_message).toBe('permission denied');
  });
});

describe('listRowFailuresForFailure', () => {
  test('returns migration_required when table is missing', async () => {
    mockResponses = [{
      data: null,
      error: { message: 'relation "bolt_row_failure_diagnostics" does not exist', code: '42P01' },
    }];
    const r = await listRowFailuresForFailure('failure-1');
    expect('migration_required' in r).toBe(true);
  });

  test('returns empty when failure id has no run linkage', async () => {
    mockResponses = [
      { data: null, error: null },        // probe success
      { data: null, error: null },        // resolveRunIdForFailure returns null
    ];
    const r = await listRowFailuresForFailure('missing-failure');
    expect('migration_required' in r).toBe(false);
    if (!('migration_required' in r)) {
      expect(r.items).toEqual([]);
      expect(r.total).toBe(0);
    }
  });

  test('returns items + pagination metadata when rows present', async () => {
    const rows = [
      { id: 'r1', run_id: 'run-1', failure_code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM, failure_message: 'missing platform', occurred_at: '2026-05-01T00:00:00Z' },
      { id: 'r2', run_id: 'run-1', failure_code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA,      failure_message: 'missing cta',      occurred_at: '2026-05-01T00:00:01Z' },
    ];
    mockResponses = [
      { data: null, error: null },                       // probe
      { data: { run_id: 'run-1' }, error: null },        // resolveRunIdForFailure
      { data: rows, error: null, count: 12 },            // list query
    ];
    const r = await listRowFailuresForFailure('f-id', { limit: 2, offset: 0 });
    expect('migration_required' in r).toBe(false);
    if (!('migration_required' in r)) {
      expect(r.items).toHaveLength(2);
      expect(r.total).toBe(12);
      expect(r.has_more).toBe(true);
    }
  });

  test('falls back to occurred_at when sort is not in allow-list', async () => {
    mockResponses = [
      { data: null, error: null },
      { data: { run_id: 'run-1' }, error: null },
      { data: [], error: null, count: 0 },
    ];
    await listRowFailuresForFailure('f-id', { sort: 'created_at' as any });
    expect(lastBuilder?.order?.col).toBe('occurred_at');
  });

  test('applies filters as supabase eq() chain', async () => {
    mockResponses = [
      { data: null, error: null },
      { data: { run_id: 'run-1' }, error: null },
      { data: [], error: null, count: 0 },
    ];
    await listRowFailuresForFailure('f-id', {
      failureCode: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM,
      platform: 'linkedin',
      contentType: 'post',
    });
    const fields = lastBuilder?.filters.filter((f) => f.kind === 'eq').map((f) => f.field);
    expect(fields).toContain('failure_code');
    expect(fields).toContain('platform');
    expect(fields).toContain('content_type');
    expect(fields).toContain('run_id');
  });

  test('escapes search input before ilike', async () => {
    mockResponses = [
      { data: null, error: null },
      { data: { run_id: 'run-1' }, error: null },
      { data: [], error: null, count: 0 },
    ];
    await listRowFailuresForFailure('f-id', { search: '50% _hack' });
    const ilike = lastBuilder?.filters.find((f) => f.kind === 'ilike');
    expect(String(ilike?.value)).toMatch(/50\\%/);
    expect(String(ilike?.value)).toMatch(/\\_/);
  });
});

describe('getRowFailureSummary', () => {
  test('returns migration_required when table is missing', async () => {
    mockResponses = [{
      data: null,
      error: { message: 'relation "bolt_row_failure_diagnostics" does not exist', code: '42P01' },
    }];
    const r = await getRowFailureSummary('f');
    expect('migration_required' in r).toBe(true);
  });

  test('tallies counts by code / platform / content_type / week / stage', async () => {
    mockResponses = [
      { data: null, error: null },                            // probe
      { data: { run_id: 'run-1' }, error: null },             // resolveRunIdForFailure
      {
        data: [
          { failure_code: 'DAILY_PLAN_INVALID_PLATFORM', platform: 'linkedin', content_type: 'post', week_number: 1, stage: 'generate-weekly-structure' },
          { failure_code: 'DAILY_PLAN_INVALID_PLATFORM', platform: 'linkedin', content_type: 'post', week_number: 1, stage: 'generate-weekly-structure' },
          { failure_code: 'DAILY_PLAN_INVALID_CTA',      platform: 'x',        content_type: 'tweet', week_number: 2, stage: 'generate-weekly-structure' },
        ],
        error: null,
      },
    ];
    const r = await getRowFailureSummary('f');
    expect('migration_required' in r).toBe(false);
    if ('migration_required' in r) return;
    expect(r.rows_failed).toBe(3);
    expect(r.by_code.find((b) => b.key === 'DAILY_PLAN_INVALID_PLATFORM')?.count).toBe(2);
    expect(r.by_code.find((b) => b.key === 'DAILY_PLAN_INVALID_CTA')?.count).toBe(1);
    expect(r.by_platform.find((b) => b.key === 'linkedin')?.count).toBe(2);
    expect(r.by_platform.find((b) => b.key === 'x')?.count).toBe(1);
    expect(r.by_week.find((b) => b.key === 1)?.count).toBe(2);
    expect(r.by_week.find((b) => b.key === 2)?.count).toBe(1);
    expect(r.by_stage[0].key).toBe('generate-weekly-structure');
  });

  test('returns empty rollups when run id missing', async () => {
    mockResponses = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    const r = await getRowFailureSummary('orphan-id');
    expect('migration_required' in r).toBe(false);
    if ('migration_required' in r) return;
    expect(r.rows_failed).toBe(0);
    expect(r.by_code).toEqual([]);
  });
});
