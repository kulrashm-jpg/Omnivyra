/**
 * Phase A — autonomousFeatureFlag regression tests.
 *
 * The flag is the kill-switch that prevents the dormant autonomous-
 * feature cron stack from doing anything before the Phase B canonical
 * migration ships. If the default flips from "off" or the structured
 * skip report shape regresses, production cron behavior could change
 * silently — these tests fail-fast on that.
 */

import {
  isAutonomousCronEnabled,
  mintCronCorrelationId,
  buildCronSkipReport,
  logCronSkipped,
  logCronFatal,
  probeAutonomousTables,
  _resetAutonomousTablesProbeCache,
  AUTONOMOUS_FEATURE_FLAG_ENV_VAR,
} from '../../services/autonomousFeatureFlag';

beforeEach(() => {
  delete process.env.AUTONOMOUS_CRON_ENABLED;
  _resetAutonomousTablesProbeCache();
});

describe('AUTONOMOUS_FEATURE_FLAG_ENV_VAR exported name', () => {
  it('is the literal string operators set in env', () => {
    expect(AUTONOMOUS_FEATURE_FLAG_ENV_VAR).toBe('AUTONOMOUS_CRON_ENABLED');
  });
});

describe('isAutonomousCronEnabled — default-closed semantics', () => {
  it('returns false when env var is unset', () => {
    expect(isAutonomousCronEnabled()).toBe(false);
  });

  it('returns false for empty string, "1", "yes", "TRUE", any non-literal-true value', () => {
    for (const v of ['', '1', 'yes', 'on', 'TRUE', 'True', 'enabled', '0', 'false']) {
      process.env.AUTONOMOUS_CRON_ENABLED = v;
      expect(isAutonomousCronEnabled()).toBe(false);
    }
  });

  it('returns true ONLY for the literal string "true"', () => {
    process.env.AUTONOMOUS_CRON_ENABLED = 'true';
    expect(isAutonomousCronEnabled()).toBe(true);
  });
});

describe('mintCronCorrelationId — telemetry handle shape', () => {
  it('produces a deterministically-prefixed opaque id', () => {
    const id = mintCronCorrelationId('cron');
    expect(id).toMatch(/^cron_[0-9a-f]{12}$/);
  });

  it('honors a custom prefix', () => {
    const id = mintCronCorrelationId('cron-autosched');
    expect(id).toMatch(/^cron-autosched_[0-9a-f]{12}$/);
  });

  it('produces unique ids on repeated calls', () => {
    const a = mintCronCorrelationId();
    const b = mintCronCorrelationId();
    expect(a).not.toEqual(b);
  });
});

describe('buildCronSkipReport — response shape contract', () => {
  it('returns the exact discriminator fields downstream consumers can parse', () => {
    const r = buildCronSkipReport('cron/foo', 'cron_abc123');
    expect(r).toEqual({
      success:       true,
      skipped:       true,
      reason:        'autonomous_cron_disabled',
      flag:          'AUTONOMOUS_CRON_ENABLED',
      handler:       'cron/foo',
      correlationId: 'cron_abc123',
    });
  });
});

describe('logCronSkipped — structured log emission', () => {
  it('emits a JSON log line with event=cron_disabled_by_flag', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logCronSkipped('cron/foo', 'cron_abc123');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(warn.mock.calls[0][0]);
    expect(line.event).toBe('cron_disabled_by_flag');
    expect(line.handler).toBe('cron/foo');
    expect(line.correlationId).toBe('cron_abc123');
    expect(line.flag).toBe('AUTONOMOUS_CRON_ENABLED');
    warn.mockRestore();
  });
});

describe('logCronFatal — failure log emission', () => {
  it('emits a JSON log line with event=cron_fatal + error context', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    logCronFatal('cron/foo', 'cron_abc123', new Error('boom'));
    expect(err).toHaveBeenCalledTimes(1);
    const line = JSON.parse(err.mock.calls[0][0]);
    expect(line.event).toBe('cron_fatal');
    expect(line.handler).toBe('cron/foo');
    expect(line.correlationId).toBe('cron_abc123');
    expect(line.errorMessage).toBe('boom');
    expect(line.errorName).toBe('Error');
    err.mockRestore();
  });
});

describe('probeAutonomousTables — startup safety probe', () => {
  function fakeSupabaseAllPresent() {
    return {
      from: () => ({
        select: () => Promise.resolve({ error: null }),
      }),
    };
  }

  function fakeSupabaseMissingTables(missingTables: string[]) {
    return {
      from: (table: string) => ({
        select: () => Promise.resolve(
          missingTables.includes(table)
            ? { error: { message: `relation "${table}" does not exist` } }
            : { error: null },
        ),
      }),
    };
  }

  it('reports tablesPresent=true when all autonomous tables exist', async () => {
    const result = await probeAutonomousTables(fakeSupabaseAllPresent() as any, 'cron/foo', 'cron_abc');
    expect(result.tablesPresent).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports missing tables AND emits a structured warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await probeAutonomousTables(
      fakeSupabaseMissingTables(['company_settings', 'pending_campaigns']) as any,
      'cron/foo',
      'cron_abc',
    );
    expect(result.tablesPresent).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['company_settings', 'pending_campaigns']));
    expect(warn).toHaveBeenCalled();
    const line = JSON.parse(warn.mock.calls[0][0]);
    expect(line.event).toBe('autonomous_tables_missing_while_flag_enabled');
    expect(line.missing).toEqual(expect.arrayContaining(['company_settings', 'pending_campaigns']));
    warn.mockRestore();
  });

  it('memoizes the probe within a single process — second call returns cached=true', async () => {
    const fromSpy = jest.fn().mockReturnValue({
      select: () => Promise.resolve({ error: null }),
    });
    const supabase = { from: fromSpy };
    await probeAutonomousTables(supabase as any, 'cron/foo', 'cron_abc');
    const second = await probeAutonomousTables(supabase as any, 'cron/foo', 'cron_def');
    expect(second.cached).toBe(true);
    // First call probed 4 tables; second should have probed 0.
    expect(fromSpy.mock.calls.length).toBe(4);
  });
});
