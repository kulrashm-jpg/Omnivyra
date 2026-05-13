/**
 * Pins the schema-health-check contract.
 *
 * This check exists to convert silent migration drift into a loud
 * structured warning. The Phase 2.B login-loop incident root-caused to
 * three columns missing — the test set below ensures the boot probe
 * (a) detects each one,
 * (b) names the migration file that adds it,
 * (c) caches its result so subsequent requests don't hit information_schema,
 * (d) emits a structured log on first miss.
 */

const supabaseMock = {
  from: jest.fn(),
};
jest.mock('../../db/supabaseClient', () => ({
  supabase: supabaseMock,
}));

const loggerInfo  = jest.fn();
const loggerWarn  = jest.fn();
const loggerError = jest.fn();
jest.mock('../../services/logger', () => ({
  logger: { info: loggerInfo, warn: loggerWarn, error: loggerError },
}));

import {
  getSchemaHealth,
  resetSchemaHealthCache,
  REQUIRED_LIFECYCLE_COLUMNS,
} from '../../security/startup/schemaHealthCheck';

function buildInfoSchemaChain(result: { data?: unknown[]; error?: { message: string } | null }) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq:     jest.fn(() => chain),
    in:     jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
  return chain;
}

function buildProbeChain(result: { error: { message: string; code?: string } | null }) {
  const chain: any = {
    select: jest.fn(() => chain),
    limit:  jest.fn().mockResolvedValue({ data: [], error: result.error }),
  };
  return chain;
}

beforeEach(() => {
  resetSchemaHealthCache();
  jest.clearAllMocks();
});

describe('REQUIRED_LIFECYCLE_COLUMNS', () => {
  it('names the migration file for every required column', () => {
    for (const c of REQUIRED_LIFECYCLE_COLUMNS) {
      expect(c.migration).toMatch(/^2026\d{4}_.+\.sql$/);
      expect(c.consumer).toBeTruthy();
    }
  });

  it('covers the four spine columns', () => {
    const names = REQUIRED_LIFECYCLE_COLUMNS.map((c) => `${c.table}.${c.column}`);
    expect(names).toEqual(expect.arrayContaining([
      'users.status',
      'users.session_revoked_after',
      'users.activated_at',
      'companies.deleted_at',
    ]));
  });
});

describe('getSchemaHealth', () => {
  it('reports ok when information_schema returns all required columns', async () => {
    supabaseMock.from.mockReturnValueOnce(buildInfoSchemaChain({
      data: REQUIRED_LIFECYCLE_COLUMNS.map((c) => ({
        table_name: c.table,
        column_name: c.column,
      })),
    }));

    const out = await getSchemaHealth();
    expect(out.ok).toBe(true);
    expect(out.missing).toEqual([]);
    expect(loggerInfo).toHaveBeenCalledWith('schema_health_check_ok', expect.any(Object));
  });

  it('reports degraded with structured details when columns are missing', async () => {
    supabaseMock.from.mockReturnValueOnce(buildInfoSchemaChain({
      data: [
        { table_name: 'users', column_name: 'status' },
        // session_revoked_after, activated_at, companies.deleted_at missing
      ],
    }));

    const out = await getSchemaHealth();
    expect(out.ok).toBe(false);
    const missingNames = out.missing.map((m) => `${m.table}.${m.column}`);
    expect(missingNames).toEqual(expect.arrayContaining([
      'users.session_revoked_after',
      'users.activated_at',
      'companies.deleted_at',
    ]));
    expect(missingNames).not.toContain('users.status');
    // Each entry exposes the migration that would fix it.
    for (const m of out.missing) {
      expect(m.migration).toMatch(/\.sql$/);
    }
    expect(loggerError).toHaveBeenCalledWith('schema_health_check_failed', expect.any(Object));
  });

  it('caches the result and does not re-query on subsequent calls', async () => {
    supabaseMock.from.mockReturnValueOnce(buildInfoSchemaChain({
      data: REQUIRED_LIFECYCLE_COLUMNS.map((c) => ({ table_name: c.table, column_name: c.column })),
    }));
    await getSchemaHealth();
    await getSchemaHealth();
    await getSchemaHealth();
    // information_schema queried exactly once across the three calls.
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('falls back to per-column probes when information_schema is unreadable', async () => {
    // information_schema fails — caller will probe each column individually.
    supabaseMock.from.mockReturnValueOnce(buildInfoSchemaChain({
      error: { message: 'permission denied for table columns' },
    }));
    // Then four per-column probes — first three succeed, last reports
    // missing 'activated_at'.
    for (const c of REQUIRED_LIFECYCLE_COLUMNS) {
      if (c.column === 'activated_at') {
        supabaseMock.from.mockReturnValueOnce(buildProbeChain({
          error: { code: 'PGRST204', message: "Could not find the 'activated_at' column of 'users' in the schema cache" },
        }));
      } else {
        supabaseMock.from.mockReturnValueOnce(buildProbeChain({ error: null }));
      }
    }

    const out = await getSchemaHealth();
    expect(out.ok).toBe(false);
    expect(out.missing.map((m) => m.column)).toEqual(['activated_at']);
  });
});
