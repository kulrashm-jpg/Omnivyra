/**
 * Boot-time determinism tests for the auth subsystem boot orchestrator.
 *
 * Pins:
 *   - Single-flight: concurrent boot calls share the same Promise.
 *   - Cache: subsequent calls return the cached snapshot, no re-probe.
 *   - Healthy: ready=true and emits the fingerprint.
 *   - Degraded: ready=false, schemaHealthy=false, reasons array populated.
 *   - Boot fingerprint: deterministic and matches across calls.
 */

const supabaseFrom = jest.fn();
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (...args: unknown[]) => supabaseFrom(...args) },
}));

const loggerInfo = jest.fn();
const loggerWarn = jest.fn();
const loggerError = jest.fn();
jest.mock('../../services/logger', () => ({
  logger: { info: loggerInfo, warn: loggerWarn, error: loggerError },
}));

import {
  bootAuthSubsystem,
  resetAuthSubsystemBoot,
  getAuthReadiness,
} from '../../security/startup/authSubsystemBoot';
import { resetSchemaHealthCache, REQUIRED_LIFECYCLE_COLUMNS } from '../../security/startup/schemaHealthCheck';
import { resetBootFingerprint } from '../../security/startup/bootFingerprint';

function infoSchema(rows: Array<{ table_name: string; column_name: string }>) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq:     jest.fn(() => chain),
    in:     jest.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuthSubsystemBoot();
  resetSchemaHealthCache();
  resetBootFingerprint();
});

describe('bootAuthSubsystem', () => {
  it('reports ready when every required column is present', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(
      REQUIRED_LIFECYCLE_COLUMNS.map((c) => ({ table_name: c.table, column_name: c.column })),
    ));
    const readiness = await bootAuthSubsystem();
    expect(readiness.ready).toBe(true);
    expect(readiness.schemaHealthy).toBe(true);
    expect(readiness.reasons).toEqual([]);
    expect(readiness.fingerprint.authContractVersion).toBeTruthy();
    expect(readiness.fingerprint.fingerprint.length).toBeGreaterThan(8);
    expect(loggerInfo).toHaveBeenCalledWith('auth_subsystem_ready', expect.any(Object));
  });

  it('reports degraded with structured reasons when columns are missing', async () => {
    // Only return users.status — other lifecycle columns missing.
    supabaseFrom.mockReturnValueOnce(infoSchema([
      { table_name: 'users', column_name: 'status' },
    ]));
    const readiness = await bootAuthSubsystem();
    expect(readiness.ready).toBe(false);
    expect(readiness.schemaHealthy).toBe(false);
    expect(readiness.reasons.some((r) => r.startsWith('schema_missing_columns:'))).toBe(true);
    expect(readiness.schema.missing.length).toBeGreaterThan(0);
    expect(loggerError).toHaveBeenCalledWith('auth_subsystem_degraded', expect.any(Object));
  });

  it('is single-flight: concurrent callers share the same Promise', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(
      REQUIRED_LIFECYCLE_COLUMNS.map((c) => ({ table_name: c.table, column_name: c.column })),
    ));
    const [a, b, c] = await Promise.all([bootAuthSubsystem(), bootAuthSubsystem(), bootAuthSubsystem()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(supabaseFrom).toHaveBeenCalledTimes(1);
  });

  it('caches across sequential calls', async () => {
    supabaseFrom.mockReturnValueOnce(infoSchema(
      REQUIRED_LIFECYCLE_COLUMNS.map((c) => ({ table_name: c.table, column_name: c.column })),
    ));
    await bootAuthSubsystem();
    await bootAuthSubsystem();
    await bootAuthSubsystem();
    expect(supabaseFrom).toHaveBeenCalledTimes(1);
    expect(getAuthReadiness()).not.toBeNull();
  });
});
