/**
 * Phase 17 — Execution-store boot wrapper.
 *
 * Call once at runtime startup from each authoritative boot entrypoint
 * (Next.js instrumentation, worker entry, cron entry). This wrapper:
 *
 *   1. Reads THREAD_RUNTIME_PERSISTENCE_MODE.
 *   2. Calls registerThreadRuntimeExecutionStore() (idempotent per process).
 *   3. For mode=supabase: runs a smoke test against the table.
 *      If the smoke test fails, HARD-FAILS the startup via the configured
 *      fatal handler (default: process.exit(1)). This is intentional per
 *      the Phase 17 spec — no silent downgrade.
 *   4. Emits structured startup diagnostics:
 *        runtime_execution_store_mode_selected
 *        runtime_execution_store_registration_complete
 *        runtime_execution_store_registration_failed
 *   5. Prints a multi-line startup banner.
 *
 * Idempotent: re-invocations within the same process re-print the banner
 * but do not re-register or re-smoke-test.
 *
 * All output is single-line JSON wrapped inside [thread-runtime.persistence]
 * for grep-friendly operator surfaces.
 */

import {
  registerThreadRuntimeExecutionStore,
  readPersistenceModeFromEnv,
  type ThreadRuntimePersistenceMode,
  type RegisterExecutionStoreResult,
} from './registerExecutionStore';
import {
  SupabaseExecutionStore,
  SupabaseExecutionStoreError,
} from './supabaseExecutionStore';
import { SupabaseCheckpointStore } from './supabaseCheckpointStore';
import { SupabaseLeaseStore } from './supabaseLeaseStore';
import {
  runWriteSideSmokeVerification,
  WriteSmokeVerificationError,
  type WriteSmokeVerificationResult,
} from './writeSideSmokeVerification';
import {
  maybeRunStartupRecoverySweep,
  type StartupSweepResult,
} from '@/backend/services/orchestration/recovery/startupRecoverySweep';

export type RuntimePersistenceProcessKind =
  | 'nextjs_server'
  | 'worker'
  | 'cron'
  | 'standalone'
  | 'test'
  | 'unknown';

export type FatalHandler = (reason: string, payload: Record<string, unknown>) => never;

const defaultFatalHandler: FatalHandler = (reason, payload) => {
  try {
    console.error(`[thread-runtime.persistence] FATAL ${reason} ${JSON.stringify(payload)}`);
  } catch { /* ignore log failures */ }
  process.exit(1);
};

export interface BootstrapExecutionStoreOptions {
  processKind?: RuntimePersistenceProcessKind;
  /**
   * Phase 17: read-side smoke-test override. Retained for tests that pin
   * the legacy probe behavior. When this is provided AND
   * `writeSmokeTest` is not, only the legacy probe runs.
   */
  smokeTest?: (store: SupabaseExecutionStore) => Promise<void>;
  /**
   * Phase 18C: write-side smoke-test override. Default runs
   * `runWriteSideSmokeVerification` against the registered stores.
   * When provided, this REPLACES the legacy read-only probe (the write
   * probe also exercises reads, so the legacy probe becomes redundant).
   */
  writeSmokeTest?: (input: {
    executionStore: SupabaseExecutionStore;
    checkpointStore: SupabaseCheckpointStore;
    leaseStore: SupabaseLeaseStore;
  }) => Promise<WriteSmokeVerificationResult>;
  /**
   * Override the fatal handler (tests). Defaults to process.exit(1).
   * Must NEVER return (declared `never`).
   */
  fatalHandler?: FatalHandler;
  /** Override mode for testing; defaults to env var lookup. */
  modeOverride?: ThreadRuntimePersistenceMode;
  /** Override the supabase store factory (tests). */
  supabaseStoreFactory?: () => SupabaseExecutionStore;
  /** Override the checkpoint store factory (tests). */
  checkpointStoreFactory?: () => SupabaseCheckpointStore;
  /** Override the lease store factory (tests). */
  leaseStoreFactory?: () => SupabaseLeaseStore;
  /** When true, skip ALL smoke tests for supabase mode (tests). */
  skipSmokeTest?: boolean;
  /** When true, skip the write-side smoke test (tests / partial deployments). */
  skipWriteSmoke?: boolean;
  /** When true, skip the banner. */
  silent?: boolean;
  /**
   * Phase 19J — explicitly disable the env-gated startup recovery sweep
   * for tests that want full control over recovery timing.
   */
  skipStartupRecoverySweep?: boolean;
}

export interface BootstrapExecutionStoreResult {
  mode: ThreadRuntimePersistenceMode;
  storeName: string;
  status: 'registered' | 'default' | 'reused';
  processKind: RuntimePersistenceProcessKind;
  serviceRoleAvailable: boolean;
  /** Legacy read-only smoke test outcome (Phase 17). null = skipped. */
  smokeTestPassed: boolean | null;
  /**
   * Phase 18C write-side smoke test outcome. null = skipped (memory mode,
   * skipSmokeTest, or skipWriteSmoke). undefined = not yet run.
   */
  writeSmokeTestPassed?: boolean | null;
  /** Phase 18C write-smoke probe duration in ms. Only set when run. */
  writeSmokeDurationMs?: number;
  /** Phase 18D — names of dedicated stores registered alongside execution. */
  registeredStoreNames: string[];
  /**
   * Phase 19J — startup recovery sweep result. Present only when the
   * env flag ENABLE_STARTUP_RECOVERY_SWEEP is on. Skipped sweeps are
   * still returned (with skipped=true) so observability can show "the
   * boot consciously chose not to sweep."
   */
  startupRecoverySweep?: StartupSweepResult;
}

// Per-process memoization. Keyed on process.pid so test sequences that fork
// reinit fresh; in production this resolves to one entry per process.
const _bootedProcesses = new Set<string>();

function processKey(kind: RuntimePersistenceProcessKind): string {
  return `${kind}:${process.pid}`;
}

function emitDiagnostic(event: string, payload: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
    if (event === 'runtime_execution_store_registration_failed') console.error(`[thread-runtime.persistence] ${line}`);
    else console.log(`[thread-runtime.persistence] ${line}`);
  } catch { /* ignore */ }
}

function printBanner(result: BootstrapExecutionStoreResult): void {
  const lines = [
    '[thread-runtime.persistence]',
    `  mode=${result.mode}`,
    `  store=${result.storeName}`,
    `  status=${result.status}`,
    `  process=${result.processKind}`,
    `  service_role_key=${result.serviceRoleAvailable ? 'present' : 'missing'}`,
    `  smoke_test=${result.smokeTestPassed === null ? 'skipped' : result.smokeTestPassed ? 'passed' : 'failed'}`,
    `  write_smoke=${result.writeSmokeTestPassed === undefined || result.writeSmokeTestPassed === null ? 'skipped' : result.writeSmokeTestPassed ? 'passed' : 'failed'}`,
    `  registered_stores=[${result.registeredStoreNames.join(',')}]`,
  ];
  try { console.log(lines.join('\n')); } catch { /* ignore */ }
}

function serviceRoleKeyPresent(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL);
}

async function defaultSmokeTest(store: SupabaseExecutionStore): Promise<void> {
  // Cheap "is the table reachable?" probe. Uses a guaranteed-missing
  // executionId so we get a fast {data: null, error: null} round-trip
  // when everything is healthy; any RLS / table / connectivity issue
  // surfaces as a thrown SupabaseExecutionStoreError.
  const probeId = `_smoke_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await store.getExecutionById(probeId);
}

/**
 * Boot the runtime persistence layer. Call once per process at startup.
 *
 * @returns the resolved boot result for diagnostics. Throws (via fatalHandler)
 * if mode=supabase AND registration / smoke test fails.
 */
export async function bootstrapThreadRuntimeExecutionStore(
  options: BootstrapExecutionStoreOptions = {},
): Promise<BootstrapExecutionStoreResult> {
  const processKind = options.processKind ?? 'unknown';
  const mode = options.modeOverride ?? readPersistenceModeFromEnv();
  const fatal = options.fatalHandler ?? defaultFatalHandler;
  const key = processKey(processKind);
  const alreadyBooted = _bootedProcesses.has(key);

  emitDiagnostic('runtime_execution_store_mode_selected', {
    mode,
    processKind,
    serviceRoleAvailable: serviceRoleKeyPresent(),
    alreadyBootedForProcess: alreadyBooted,
  });

  // Step 1 — registration (idempotent inside the helper).
  // Phase 18D: register execution + checkpoint + lease together.
  let regResult: RegisterExecutionStoreResult;
  try {
    regResult = registerThreadRuntimeExecutionStore({
      mode,
      supabaseStoreFactory: options.supabaseStoreFactory,
      checkpointStoreFactory: options.checkpointStoreFactory,
      leaseStoreFactory: options.leaseStoreFactory,
    });
  } catch (err) {
    const reason = (err as Error)?.message ?? 'unknown registration error';
    emitDiagnostic('runtime_execution_store_registration_failed', {
      mode, processKind, reason,
      hard_fail: mode === 'supabase',
    });
    if (mode === 'supabase') {
      fatal('SUPABASE_REGISTRATION_FAILED', { reason, processKind });
    }
    throw err;
  }

  // Phase 18E: per-store "ready" diagnostics so operators can see at a
  // glance which dedicated stores were installed.
  const registeredStoreNames: string[] = [];
  if (mode === 'supabase') {
    if (regResult.executionStore) {
      registeredStoreNames.push('execution');
      emitDiagnostic('execution_store_ready', { processKind, mode });
    }
    if (regResult.checkpointStore) {
      registeredStoreNames.push('checkpoint');
      emitDiagnostic('checkpoint_store_ready', { processKind, mode });
    }
    if (regResult.leaseStore) {
      registeredStoreNames.push('lease');
      emitDiagnostic('lease_store_ready', { processKind, mode });
    }
  } else {
    registeredStoreNames.push('memory');
  }

  // Step 2 — Phase 17 read-side smoke test (optional via skipSmokeTest).
  // Retained for backward compatibility with the Phase 17 contract.
  let smokeTestPassed: boolean | null = null;
  if (mode === 'supabase' && !options.skipSmokeTest) {
    const smokeTest = options.smokeTest ?? defaultSmokeTest;
    const probeStore = options.supabaseStoreFactory
      ? options.supabaseStoreFactory()
      : (regResult.executionStore ?? new SupabaseExecutionStore());
    try {
      await smokeTest(probeStore);
      smokeTestPassed = true;
    } catch (err) {
      smokeTestPassed = false;
      const code = err instanceof SupabaseExecutionStoreError ? err.code : (err as { code?: string })?.code ?? 'UNKNOWN';
      const reason = (err as Error)?.message ?? 'unknown smoke-test error';
      emitDiagnostic('runtime_execution_store_registration_failed', {
        mode, processKind, reason, code,
        stage: 'smoke_test',
        hard_fail: true,
      });
      fatal('SUPABASE_SMOKE_TEST_FAILED', { reason, code, processKind });
    }
  }

  // Step 3 — Phase 18C write-side smoke verification.
  // Skipped when: mode=memory, skipSmokeTest=true, or skipWriteSmoke=true.
  // Hard-fails on probe failure (matches the existing supabase-mode policy).
  let writeSmokeTestPassed: boolean | null = null;
  let writeSmokeDurationMs: number | undefined;
  const shouldRunWriteSmoke =
    mode === 'supabase' &&
    !options.skipSmokeTest &&
    !options.skipWriteSmoke;
  if (shouldRunWriteSmoke) {
    // Resolve the stores: prefer the just-registered ones (so the probe
    // runs against the EXACT objects in use), but fall back to freshly
    // built defaults if the registration result somehow lacked them.
    const checkpointStore = regResult.checkpointStore ?? new SupabaseCheckpointStore();
    const leaseStore = regResult.leaseStore ?? new SupabaseLeaseStore();
    const executionStore = regResult.executionStore ?? new SupabaseExecutionStore({ checkpointStore, leaseStore });
    const runner = options.writeSmokeTest ?? (async (i) => runWriteSideSmokeVerification({
      executionStore: i.executionStore,
      checkpointStore: i.checkpointStore,
      leaseStore: i.leaseStore,
    }));
    try {
      const wr = await runner({ executionStore, checkpointStore, leaseStore });
      writeSmokeTestPassed = wr.passed;
      writeSmokeDurationMs = wr.durationMs;
      emitDiagnostic('write_smoke_test_passed', {
        processKind, mode,
        durationMs: wr.durationMs,
        stagesCompleted: wr.stagesCompleted,
        cleanupSucceeded: wr.cleanupSucceeded,
      });
    } catch (err) {
      writeSmokeTestPassed = false;
      const code = err instanceof WriteSmokeVerificationError ? err.code
        : err instanceof SupabaseExecutionStoreError ? err.code
        : (err as { code?: string })?.code ?? 'UNKNOWN';
      const stage = err instanceof WriteSmokeVerificationError ? err.stage : 'unknown';
      const reason = (err as Error)?.message ?? 'unknown write-smoke error';
      emitDiagnostic('write_smoke_test_failed', {
        processKind, mode, stage, code, reason, hard_fail: true,
      });
      emitDiagnostic('runtime_execution_store_registration_failed', {
        mode, processKind, reason, code,
        stage: 'write_smoke_test',
        hard_fail: true,
      });
      fatal('SUPABASE_WRITE_SMOKE_TEST_FAILED', { reason, code, stage, processKind });
    }
  }

  // Step 4 — Phase 19J startup recovery sweep (env-gated, skipped by default).
  let startupRecoverySweep: StartupSweepResult | undefined;
  if (!options.skipStartupRecoverySweep && !alreadyBooted) {
    try {
      startupRecoverySweep = await maybeRunStartupRecoverySweep({
        processKind,
        // Default: detection only at boot. Operators opt into recovery
        // execution by passing recoveryInputBuilder + runRecoveryInline
        // via a custom call site (e.g. worker entry).
        options: { detectOnly: true },
      });
    } catch (err) {
      // Sweep is best-effort; failures here must NOT block boot. The
      // persistence layer is already up — recovery can run later.
      emitDiagnostic('runtime_execution_store_registration_failed', {
        mode, processKind,
        stage: 'startup_recovery_sweep',
        reason: (err as Error)?.message ?? 'sweep_unknown_error',
        hard_fail: false,
      });
    }
  }

  const result: BootstrapExecutionStoreResult = {
    mode,
    storeName: mode === 'supabase' ? 'SupabaseExecutionStore' : 'InMemoryExecutionStore',
    status: regResult.changed
      ? 'registered'
      : alreadyBooted
        ? 'reused'
        : mode === 'memory'
          ? 'default'
          : 'reused',
    processKind,
    serviceRoleAvailable: serviceRoleKeyPresent(),
    smokeTestPassed,
    writeSmokeTestPassed,
    writeSmokeDurationMs,
    registeredStoreNames,
    startupRecoverySweep,
  };

  emitDiagnostic('runtime_execution_store_registration_complete', {
    mode: result.mode,
    storeName: result.storeName,
    status: result.status,
    processKind: result.processKind,
    serviceRoleAvailable: result.serviceRoleAvailable,
    smokeTestPassed: result.smokeTestPassed,
    writeSmokeTestPassed: result.writeSmokeTestPassed,
    writeSmokeDurationMs: result.writeSmokeDurationMs,
    registeredStoreNames: result.registeredStoreNames,
  });

  emitDiagnostic('persistence_bootstrap_complete', {
    mode: result.mode,
    processKind: result.processKind,
    storesRegistered: result.registeredStoreNames.length,
    smokeTestPassed: result.smokeTestPassed,
    writeSmokeTestPassed: result.writeSmokeTestPassed,
  });

  if (!options.silent) printBanner(result);
  _bootedProcesses.add(key);
  return result;
}

// ─── Test helpers ─────────────────────────────────────────────────────

export function _resetBootstrapState(): void {
  _bootedProcesses.clear();
}

export { defaultFatalHandler };
