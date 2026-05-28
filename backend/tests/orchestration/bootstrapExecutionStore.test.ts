/**
 * Phase 17 — bootstrapThreadRuntimeExecutionStore integration tests.
 *
 * Covers:
 *   1. memory-mode startup
 *   2. supabase-mode startup
 *   3. failed supabase initialization (hard-fail policy)
 *   4. duplicate registration prevention
 *   5. invalid env mode handling
 *   6. startup ordering guarantees
 *
 * Tests are hermetic: no DB, no Next.js, no real workers. Mocks the
 * supabase store factory + fatal handler.
 */

import {
  bootstrapThreadRuntimeExecutionStore,
  _resetBootstrapState,
  type FatalHandler,
} from '../../services/orchestration/persistence/bootstrapExecutionStore';
import {
  _resetExecutionStoreRegistration,
} from '../../services/orchestration/persistence/registerExecutionStore';
import { SupabaseExecutionStore } from '../../services/orchestration/persistence/supabaseExecutionStore';
import {
  getDefaultExecutionStore,
  createInMemoryExecutionStore,
  setDefaultExecutionStore,
} from '../../services/threadRuntime/executionStore';

// Throwing-fatal: instead of process.exit, throws so the test can observe
// the fatal trigger without killing the test runner.
function throwingFatal(): FatalHandler {
  return (reason, payload) => {
    const err = new Error(`FATAL:${reason}:${JSON.stringify(payload)}`) as Error & { reason?: string };
    err.reason = reason;
    throw err;
  };
}

/** Build a SupabaseExecutionStore stub whose method coverage matches what
 *  the smoke test exercises (getExecutionById). */
function buildStubSupabaseStore(options: { failsWith?: Error } = {}): SupabaseExecutionStore {
  const stub = {
    getExecutionById: jest.fn(async (_id: string) => {
      if (options.failsWith) throw options.failsWith;
      return null;
    }),
    // Required-by-interface methods we don't exercise in bootstrap; provide noop stubs.
    createExecution: jest.fn(),
    getExecution: jest.fn(),
    updateExecution: jest.fn(),
    listExecutions: jest.fn(),
    recordCheckpoint: jest.fn(),
    listCheckpoints: jest.fn(),
    getCheckpoint: jest.fn(),
    acquireLease: jest.fn(),
    renewLease: jest.fn(),
    releaseLease: jest.fn(),
    currentLease: jest.fn(),
    listExpiredLeases: jest.fn(),
  };
  return stub as unknown as SupabaseExecutionStore;
}

beforeEach(() => {
  // Reset both layers' module-level state so each test boots cleanly.
  _resetBootstrapState();
  _resetExecutionStoreRegistration();
  // Reset the default store to a fresh in-memory instance so the
  // "supabase-installed" tests can detect the change.
  setDefaultExecutionStore(createInMemoryExecutionStore());
});

// ── 1. memory-mode startup ───────────────────────────────────────────

describe('bootstrap — memory mode', () => {
  test('default mode is memory and store is the in-memory default', async () => {
    const beforeStore = getDefaultExecutionStore();
    const result = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'memory',
      silent: true,
    });
    expect(result.mode).toBe('memory');
    expect(result.storeName).toBe('InMemoryExecutionStore');
    expect(result.smokeTestPassed).toBeNull(); // skipped in memory mode
    // Memory mode does NOT replace the default store.
    expect(getDefaultExecutionStore()).toBe(beforeStore);
  });

  test('memory mode does not invoke any supabase factory', async () => {
    const factory = jest.fn();
    await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'memory',
      supabaseStoreFactory: factory,
      silent: true,
    });
    expect(factory).not.toHaveBeenCalled();
  });
});

// ── 2. supabase-mode startup ─────────────────────────────────────────

describe('bootstrap — supabase mode', () => {
  test('replaces the default store and runs smoke test', async () => {
    const stub = buildStubSupabaseStore();
    const beforeStore = getDefaultExecutionStore();
    const result = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'supabase',
      supabaseStoreFactory: () => stub,
      skipWriteSmoke: true, // Phase 18: covered by its own dedicated tests
      silent: true,
    });
    expect(result.mode).toBe('supabase');
    expect(result.storeName).toBe('SupabaseExecutionStore');
    expect(result.status).toBe('registered');
    expect(result.smokeTestPassed).toBe(true);
    expect(getDefaultExecutionStore()).not.toBe(beforeStore);
    expect(stub.getExecutionById).toHaveBeenCalledTimes(1);
  });

  test('skipSmokeTest skips the probe', async () => {
    const stub = buildStubSupabaseStore();
    const result = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'supabase',
      supabaseStoreFactory: () => stub,
      skipSmokeTest: true,
      silent: true,
    });
    expect(result.smokeTestPassed).toBeNull();
    expect(stub.getExecutionById).not.toHaveBeenCalled();
  });
});

// ── 3. failed supabase initialization (hard-fail policy) ─────────────

describe('bootstrap — supabase failure hard-fails', () => {
  test('smoke-test failure invokes fatal handler', async () => {
    const stub = buildStubSupabaseStore({ failsWith: new Error('connection refused') });
    const fatal = jest.fn(throwingFatal());
    await expect(
      bootstrapThreadRuntimeExecutionStore({
        processKind: 'test',
        modeOverride: 'supabase',
        supabaseStoreFactory: () => stub,
        fatalHandler: fatal as unknown as FatalHandler,
        skipWriteSmoke: true,
        silent: true,
      }),
    ).rejects.toThrow(/FATAL:SUPABASE_SMOKE_TEST_FAILED/);
    expect(fatal).toHaveBeenCalledWith(
      'SUPABASE_SMOKE_TEST_FAILED',
      expect.objectContaining({ reason: 'connection refused' }),
    );
  });

  test('supabase mode never silently downgrades to memory on failure', async () => {
    const stub = buildStubSupabaseStore({ failsWith: new Error('boom') });
    const fatal = jest.fn(throwingFatal());
    await expect(
      bootstrapThreadRuntimeExecutionStore({
        processKind: 'test',
        modeOverride: 'supabase',
        supabaseStoreFactory: () => stub,
        fatalHandler: fatal as unknown as FatalHandler,
        skipWriteSmoke: true,
        silent: true,
      }),
    ).rejects.toThrow(/FATAL:/);
    // Default store should have been REPLACED with the (broken) supabase
    // store before the smoke test fired — i.e. no silent revert to memory.
    expect(getDefaultExecutionStore()).toBe(stub);
  });
});

// ── 4. duplicate registration prevention ─────────────────────────────

describe('bootstrap — duplicate registration', () => {
  test('second call with same supabase mode returns status=reused', async () => {
    const stub = buildStubSupabaseStore();
    const first = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test', modeOverride: 'supabase',
      supabaseStoreFactory: () => stub, skipWriteSmoke: true, silent: true,
    });
    expect(first.status).toBe('registered');

    const second = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test', modeOverride: 'supabase',
      supabaseStoreFactory: () => stub, skipWriteSmoke: true, silent: true,
    });
    expect(second.status).toBe('reused');
  });

  test('memory mode after memory mode is reused', async () => {
    const first = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test', modeOverride: 'memory', silent: true,
    });
    expect(first.status).toBe('default');
    const second = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test', modeOverride: 'memory', silent: true,
    });
    expect(second.status).toBe('reused');
  });
});

// ── 5. invalid env mode handling ─────────────────────────────────────

describe('bootstrap — invalid env mode', () => {
  test('unknown env value falls back to memory (no throw, no surprise mode)', async () => {
    const original = process.env.THREAD_RUNTIME_PERSISTENCE_MODE;
    process.env.THREAD_RUNTIME_PERSISTENCE_MODE = 'turbo_blockchain_quantum';
    try {
      const result = await bootstrapThreadRuntimeExecutionStore({
        processKind: 'test',
        silent: true,
      });
      expect(result.mode).toBe('memory');
      expect(result.storeName).toBe('InMemoryExecutionStore');
    } finally {
      if (original === undefined) delete process.env.THREAD_RUNTIME_PERSISTENCE_MODE;
      else process.env.THREAD_RUNTIME_PERSISTENCE_MODE = original;
    }
  });

  test('absent env falls back to memory', async () => {
    const original = process.env.THREAD_RUNTIME_PERSISTENCE_MODE;
    delete process.env.THREAD_RUNTIME_PERSISTENCE_MODE;
    try {
      const result = await bootstrapThreadRuntimeExecutionStore({
        processKind: 'test', silent: true,
      });
      expect(result.mode).toBe('memory');
    } finally {
      if (original !== undefined) process.env.THREAD_RUNTIME_PERSISTENCE_MODE = original;
    }
  });
});

// ── 6. startup ordering guarantees ───────────────────────────────────

describe('bootstrap — startup ordering', () => {
  test('registration completes before bootstrap resolves (callers can rely on default store)', async () => {
    const stub = buildStubSupabaseStore();
    let storeAtSmokeTestTime: unknown = null;
    const smokeTest = async () => {
      // At smoke-test time the store should already be registered.
      storeAtSmokeTestTime = getDefaultExecutionStore();
    };
    await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'supabase',
      supabaseStoreFactory: () => stub,
      smokeTest,
      skipWriteSmoke: true,
      silent: true,
    });
    expect(storeAtSmokeTestTime).toBe(stub);
  });

  test('memory-mode bootstrap is synchronous-ish (no waits on supabase init)', async () => {
    const start = Date.now();
    await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test', modeOverride: 'memory', silent: true,
    });
    const elapsed = Date.now() - start;
    // Empirically <50ms; allow 500ms to be safe on cold module loads.
    expect(elapsed).toBeLessThan(500);
  });
});

// ── 7. Phase 18 — write-side smoke verification ──────────────────────

describe('bootstrap — Phase 18 write-smoke', () => {
  test('runs write-smoke and reports success', async () => {
    const stub = buildStubSupabaseStore();
    const result = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'supabase',
      supabaseStoreFactory: () => stub,
      writeSmokeTest: async () => ({
        passed: true,
        executionId: '_writesmoke_test',
        checkpointId: '_writesmoke_cp_test',
        leaseId: '_writesmoke_lease_test',
        durationMs: 42,
        stagesCompleted: ['insert_execution', 'update_execution', 'append_checkpoint', 'acquire_lease', 'release_lease'],
        cleanupSucceeded: true,
      }),
      silent: true,
    });
    expect(result.writeSmokeTestPassed).toBe(true);
    expect(result.writeSmokeDurationMs).toBe(42);
    expect(result.registeredStoreNames).toEqual(expect.arrayContaining(['execution', 'checkpoint', 'lease']));
  });

  test('write-smoke failure invokes fatal handler with SUPABASE_WRITE_SMOKE_TEST_FAILED', async () => {
    const stub = buildStubSupabaseStore();
    const fatal = jest.fn(throwingFatal());
    await expect(
      bootstrapThreadRuntimeExecutionStore({
        processKind: 'test',
        modeOverride: 'supabase',
        supabaseStoreFactory: () => stub,
        writeSmokeTest: async () => { throw new Error('write probe blew up'); },
        fatalHandler: fatal as unknown as FatalHandler,
        silent: true,
      }),
    ).rejects.toThrow(/FATAL:SUPABASE_WRITE_SMOKE_TEST_FAILED/);
    expect(fatal).toHaveBeenCalledWith(
      'SUPABASE_WRITE_SMOKE_TEST_FAILED',
      expect.objectContaining({ reason: expect.stringContaining('write probe') }),
    );
  });

  test('skipWriteSmoke skips just the write probe but runs the read probe', async () => {
    const stub = buildStubSupabaseStore();
    const writeProbe = jest.fn();
    const result = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'supabase',
      supabaseStoreFactory: () => stub,
      writeSmokeTest: writeProbe,
      skipWriteSmoke: true,
      silent: true,
    });
    expect(writeProbe).not.toHaveBeenCalled();
    expect(result.smokeTestPassed).toBe(true);
    expect(result.writeSmokeTestPassed).toBeNull();
  });

  test('memory mode never runs write-smoke', async () => {
    const writeProbe = jest.fn();
    const result = await bootstrapThreadRuntimeExecutionStore({
      processKind: 'test',
      modeOverride: 'memory',
      writeSmokeTest: writeProbe,
      silent: true,
    });
    expect(writeProbe).not.toHaveBeenCalled();
    expect(result.writeSmokeTestPassed).toBeNull();
    expect(result.registeredStoreNames).toEqual(['memory']);
  });
});
