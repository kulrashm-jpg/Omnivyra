/**
 * Phase 16 — Execution store boot registration.
 *
 * Call once at app boot (Next.js server-side init, Railway worker entry,
 * cron entry). Reads THREAD_RUNTIME_PERSISTENCE_MODE and either:
 *
 *   - 'supabase' → install SupabaseExecutionStore as the default
 *   - 'memory'   → no-op (in-memory store is the default)
 *   - undefined / anything else → no-op + warn
 *
 * Idempotent: calling twice is safe; the second call is a no-op when the
 * desired mode is already active.
 *
 * No runtime behavior changes unless mode === 'supabase'.
 */

import {
  setDefaultExecutionStore,
} from '@/backend/services/threadRuntime/executionStore';
import { SupabaseExecutionStore } from './supabaseExecutionStore';
import { SupabaseCheckpointStore } from './supabaseCheckpointStore';
import { SupabaseLeaseStore } from './supabaseLeaseStore';

export type ThreadRuntimePersistenceMode = 'memory' | 'supabase';

let _registeredMode: ThreadRuntimePersistenceMode | null = null;
let _registeredCheckpointStore: SupabaseCheckpointStore | null = null;
let _registeredLeaseStore: SupabaseLeaseStore | null = null;
let _registeredExecutionStore: SupabaseExecutionStore | null = null;

export interface RegisterExecutionStoreResult {
  mode: ThreadRuntimePersistenceMode;
  changed: boolean;
  reason?: string;
  /** Phase 18: the registered dedicated stores (supabase mode only). */
  checkpointStore?: SupabaseCheckpointStore;
  leaseStore?: SupabaseLeaseStore;
  executionStore?: SupabaseExecutionStore;
}

export function readPersistenceModeFromEnv(): ThreadRuntimePersistenceMode {
  const raw = (typeof process !== 'undefined' ? process.env?.THREAD_RUNTIME_PERSISTENCE_MODE : undefined) ?? 'memory';
  if (raw === 'supabase') return 'supabase';
  return 'memory';
}

export function registerThreadRuntimeExecutionStore(input?: {
  mode?: ThreadRuntimePersistenceMode;
  /** Override the SupabaseExecutionStore constructor args (tests). */
  supabaseStoreFactory?: () => InstanceType<typeof SupabaseExecutionStore>;
  /** Override the SupabaseCheckpointStore factory (tests). */
  checkpointStoreFactory?: () => InstanceType<typeof SupabaseCheckpointStore>;
  /** Override the SupabaseLeaseStore factory (tests). */
  leaseStoreFactory?: () => InstanceType<typeof SupabaseLeaseStore>;
}): RegisterExecutionStoreResult {
  const mode = input?.mode ?? readPersistenceModeFromEnv();

  if (_registeredMode === mode) {
    return {
      mode,
      changed: false,
      reason: 'already_registered',
      checkpointStore: _registeredCheckpointStore ?? undefined,
      leaseStore: _registeredLeaseStore ?? undefined,
      executionStore: _registeredExecutionStore ?? undefined,
    };
  }

  if (mode === 'supabase') {
    // Phase 18: register all three stores together. The execution store
    // composes the checkpoint + lease stores so the ExecutionStore interface
    // delegation paths resolve through the dedicated implementations.
    const checkpointStore = input?.checkpointStoreFactory
      ? input.checkpointStoreFactory()
      : new SupabaseCheckpointStore();
    const leaseStore = input?.leaseStoreFactory
      ? input.leaseStoreFactory()
      : new SupabaseLeaseStore();

    // If the caller supplied an executionStore factory, trust it — it's
    // responsible for composing its own checkpoint/lease delegates (or
    // not). Otherwise build a fresh SupabaseExecutionStore that delegates
    // to the dedicated stores we just constructed.
    const executionStore = input?.supabaseStoreFactory
      ? input.supabaseStoreFactory()
      : new SupabaseExecutionStore({ checkpointStore, leaseStore });

    setDefaultExecutionStore(executionStore);

    _registeredMode = 'supabase';
    _registeredCheckpointStore = checkpointStore;
    _registeredLeaseStore = leaseStore;
    _registeredExecutionStore = executionStore;

    try {
      console.log(`[execution_store] registered mode=supabase stores=[execution,checkpoint,lease]`);
    } catch { /* ignore */ }

    return {
      mode,
      changed: true,
      checkpointStore,
      leaseStore,
      executionStore,
    };
  }

  // mode === 'memory' — preserve in-memory default (no setDefault call needed).
  _registeredMode = 'memory';
  _registeredCheckpointStore = null;
  _registeredLeaseStore = null;
  _registeredExecutionStore = null;
  try {
    console.log(`[execution_store] registered mode=memory (in-process default preserved)`);
  } catch { /* ignore */ }
  return { mode, changed: false, reason: 'memory_is_default' };
}

/** Get the currently-registered checkpoint store (supabase mode only). */
export function getRegisteredCheckpointStore(): SupabaseCheckpointStore | null {
  return _registeredCheckpointStore;
}

/** Get the currently-registered lease store (supabase mode only). */
export function getRegisteredLeaseStore(): SupabaseLeaseStore | null {
  return _registeredLeaseStore;
}

/** Get the currently-registered execution store (supabase mode only). */
export function getRegisteredExecutionStore(): SupabaseExecutionStore | null {
  return _registeredExecutionStore;
}

/** Test helper: reset the cached registration so re-registration takes effect. */
export function _resetExecutionStoreRegistration(): void {
  _registeredMode = null;
  _registeredCheckpointStore = null;
  _registeredLeaseStore = null;
  _registeredExecutionStore = null;
}
