/**
 * Tests for the creator operational telemetry service.
 *
 *   - emit queues + flushes to creator_operational_events
 *   - withTrace propagates trace_id through ambient context
 *   - withTimedEvent captures start + complete with latency
 *   - severity affects logger method (info/warn/error)
 *   - emit NEVER throws even when DB insert errors
 */

const insertCalls: Array<Array<Record<string, unknown>>> = [];
let insertShouldThrow = false;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(async (rows: Array<Record<string, unknown>>) => {
        if (insertShouldThrow) throw new Error('db down');
        insertCalls.push(rows);
        return { data: rows, error: null };
      }),
    })),
  },
}));

jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('creatorOperationalTelemetryService', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    insertShouldThrow = false;
    jest.clearAllMocks();
    jest.isolateModules(() => undefined);
  });

  test('emit queues + flush persists batch', async () => {
    const t = await import('../../services/creatorOperationalTelemetryService');
    t.__resetCreatorTelemetryForTests();
    t.emitCreatorEvent({ event: 'upload_started', metadata: { a: 1 } });
    t.emitCreatorEvent({ event: 'upload_completed', latencyMs: 250 });
    await t.flushCreatorTelemetry();
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].length).toBe(2);
    expect((insertCalls[0][0] as any).event_type).toBe('upload_started');
    expect((insertCalls[0][1] as any).latency_ms).toBe(250);
  });

  test('withTrace propagates trace_id into ambient context', async () => {
    const t = await import('../../services/creatorOperationalTelemetryService');
    t.__resetCreatorTelemetryForTests();
    const TRACE = '00000000-0000-0000-0000-aaaaaaaaaaaa';
    await t.withTrace({ traceId: TRACE, source: 'cron' }, async () => {
      t.emitCreatorEvent({ event: 'upload_started' });
      t.emitCreatorEvent({ event: 'upload_completed' });
    });
    await t.flushCreatorTelemetry();
    expect(insertCalls[0]).toHaveLength(2);
    expect((insertCalls[0][0] as any).trace_id).toBe(TRACE);
    expect((insertCalls[0][1] as any).trace_id).toBe(TRACE);
  });

  test('withTimedEvent emits start + complete with latency', async () => {
    const t = await import('../../services/creatorOperationalTelemetryService');
    t.__resetCreatorTelemetryForTests();
    const value = await t.withTimedEvent(
      'upload_started',
      'upload_completed',
      { scheduledPostId: 'sp-1' },
      async () => 'ok',
    );
    await t.flushCreatorTelemetry();
    expect(value).toBe('ok');
    expect(insertCalls[0].length).toBe(2);
    expect((insertCalls[0][0] as any).event_type).toBe('upload_started');
    expect((insertCalls[0][1] as any).event_type).toBe('upload_completed');
    expect(typeof (insertCalls[0][1] as any).latency_ms).toBe('number');
  });

  test('emit DOES NOT throw when DB insert fails', async () => {
    insertShouldThrow = true;
    const t = await import('../../services/creatorOperationalTelemetryService');
    t.__resetCreatorTelemetryForTests();
    t.emitCreatorEvent({ event: 'upload_started' });
    // Force flush — must not throw.
    await expect(t.flushCreatorTelemetry()).resolves.toBeUndefined();
  });

  test('severity drives logger level', async () => {
    const t = await import('../../services/creatorOperationalTelemetryService');
    t.__resetCreatorTelemetryForTests();
    const { logger } = await import('../../services/logger');
    t.emitCreatorEvent({ event: 'publish_validation_failed', severity: 'critical' });
    t.emitCreatorEvent({ event: 'queue_lock_contention', severity: 'warning' });
    t.emitCreatorEvent({ event: 'upload_started', severity: 'info' });
    expect((logger as any).error).toHaveBeenCalledTimes(1);
    expect((logger as any).warn).toHaveBeenCalledTimes(1);
    expect((logger as any).info).toHaveBeenCalledTimes(1);
    await t.flushCreatorTelemetry();
  });
});

// PB-010: mark this suite as a MODULE for tsc.
// Without a top-level import/export, tsc treats the file as a global script, so
// its top-level `const`/`function` declarations collide with identically named
// declarations in sibling suites (TS2451/TS2393). Jest already loads every test
// file as its own CommonJS module, so this is a type-visibility fix only and
// changes no runtime behaviour.
export {};
