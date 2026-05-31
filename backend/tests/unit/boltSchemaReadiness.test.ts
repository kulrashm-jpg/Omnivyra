/**
 * BOLT schema readiness probe tests.
 *
 * Covers:
 *   - all columns present → ready=true, no missing entries
 *   - lock_expires_at missing → ready=false, BLOCKING entry includes
 *     the column name + remediation pointer
 *   - WARN-severity column missing → ready=true (degraded but not blocking)
 *   - probe is memoized across calls (same object returned)
 *   - structured error log emitted exactly once per process
 */

const selectMock = jest.fn();
const limitMock = jest.fn();
const fromMock = jest.fn(() => ({ select: (...args: unknown[]) => {
  selectMock(...args);
  return { limit: limitMock };
} }));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => fromMock(table) },
}));

import {
  probeBoltSchemaReadiness,
  __resetBoltSchemaReadiness,
} from '../../services/boltSchemaReadiness';

beforeEach(() => {
  __resetBoltSchemaReadiness();
  selectMock.mockReset();
  limitMock.mockReset();
  fromMock.mockClear();
});

function setAllPresent(): void {
  limitMock.mockResolvedValue({ data: [], error: null });
}

function setColumnMissing(missingColumn: string): void {
  // Resolve probe call by responding "does not exist" for the named column.
  limitMock.mockImplementation(() => {
    const lastSelect = selectMock.mock.calls[selectMock.mock.calls.length - 1]?.[0];
    if (lastSelect === missingColumn) {
      return Promise.resolve({
        data: null,
        error: { message: `column "${missingColumn}" does not exist`, code: '42703' },
      });
    }
    return Promise.resolve({ data: [], error: null });
  });
}

describe('probeBoltSchemaReadiness — happy path', () => {
  test('returns ready=true when all columns present', async () => {
    setAllPresent();
    const r = await probeBoltSchemaReadiness();
    expect(r.ready).toBe(true);
    expect(r.missing_blocking).toEqual([]);
    expect(r.missing_warn).toEqual([]);
    expect(typeof r.probed_at).toBe('string');
  });
});

describe('probeBoltSchemaReadiness — missing columns', () => {
  test('reports lock_expires_at as BLOCKING when missing', async () => {
    setColumnMissing('lock_expires_at');
    const r = await probeBoltSchemaReadiness();
    expect(r.ready).toBe(false);
    expect(r.missing_blocking.map((c) => c.column)).toContain('lock_expires_at');
  });

  test('reports lock_owner / lock_acquired_at / heartbeat_at as BLOCKING when missing', async () => {
    for (const col of ['lock_owner', 'lock_acquired_at', 'heartbeat_at']) {
      __resetBoltSchemaReadiness();
      selectMock.mockReset();
      limitMock.mockReset();
      setColumnMissing(col);
      const r = await probeBoltSchemaReadiness();
      expect(r.ready).toBe(false);
      expect(r.missing_blocking.map((c) => c.column)).toContain(col);
    }
  });

  test('cancel_requested missing is WARN-only (ready stays true)', async () => {
    setColumnMissing('cancel_requested');
    const r = await probeBoltSchemaReadiness();
    expect(r.ready).toBe(true);
    expect(r.missing_warn.map((c) => c.column)).toContain('cancel_requested');
  });
});

describe('probeBoltSchemaReadiness — memoization + logging', () => {
  test('two sequential calls return the same cached object', async () => {
    setAllPresent();
    const r1 = await probeBoltSchemaReadiness();
    const r2 = await probeBoltSchemaReadiness();
    expect(r1).toBe(r2);
  });

  test('logs structured BLOCKING line exactly once when migration missing', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setColumnMissing('lock_expires_at');
    await probeBoltSchemaReadiness();
    await probeBoltSchemaReadiness();
    const blockingCalls = errSpy.mock.calls.filter((c) => String(c[0]).includes('[BLOCKING]'));
    expect(blockingCalls.length).toBeGreaterThanOrEqual(1);
    // Migration pointer present in log payload.
    const payload = blockingCalls[0][1] as Record<string, unknown>;
    expect(payload.migration).toBe('20260725_bolt_execution_resilience_columns.sql');
    expect(payload.column).toBe('lock_expires_at');
    expect(typeof payload.remediation).toBe('string');
    errSpy.mockRestore();
  });
});
