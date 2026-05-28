/**
 * Phase 26D — Production reconciliation hook factory.
 *
 * Wires `ReconciliationServiceHooks` into the real `reconcileRow()`
 * service. Same opt-in factory pattern.
 *
 * GUARANTEES:
 *   - Reconciliation execution becomes queue-driven + resumable.
 *   - The hook is a thin shim that calls the caller-supplied service
 *     references; no semantic drift vs the existing reconcileRow path.
 */

import type {
  ReconciliationContext,
  ReconciliationServiceHooks,
  SocialPlatform,
} from '../domainWorkflowTypes';

export interface ReconciliationServiceDeps {
  /**
   * Apply reconciliation to a single row. Operators wire this to the
   * existing `reconcileRow()` service. MUST be idempotent on
   * (rowId, provider).
   */
  reconcileRow: (input: {
    executionId: string;
    rowId: string;
    provider: SocialPlatform;
  }) => Promise<void>;
  /** Optional provider-state fetch. */
  fetchProviderState?: (input: {
    executionId: string;
    rowId: string;
    provider: SocialPlatform;
  }) => Promise<void>;
  /** Optional drift analysis. */
  runDriftAnalysis?: (input: {
    executionId: string;
    rowId: string;
    provider: SocialPlatform;
  }) => Promise<void>;
  /** Optional reconciliation snapshot for forensic archive. */
  recordReconciliationSnapshot?: (input: {
    executionId: string;
    rowId: string;
    provider: SocialPlatform;
  }) => Promise<void>;
}

export type ProductionReconciliationTelemetryEvent =
  | 'domain_reconciliation_live_execution_started'
  | 'domain_reconciliation_live_execution_completed'
  | 'domain_reconciliation_live_execution_failed';

export interface ProductionReconciliationTelemetrySink {
  emit(event: ProductionReconciliationTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ProductionReconciliationTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'domain_reconciliation_live_execution_failed') console.warn(`[prod_recon] ${line}`);
      else console.log(`[prod_recon] ${line}`);
    } catch { /* ignore */ }
  },
};

export interface CreateProductionReconciliationHooksOptions {
  deps: ReconciliationServiceDeps;
  telemetry?: ProductionReconciliationTelemetrySink;
}

export function createProductionReconciliationHooks(
  options: CreateProductionReconciliationHooksOptions,
): ReconciliationServiceHooks {
  if (!options || !options.deps || typeof options.deps.reconcileRow !== 'function') {
    throw new Error('[createProductionReconciliationHooks] deps.reconcileRow required');
  }
  const deps = options.deps;
  const telemetry = options.telemetry ?? defaultTelemetrySink;

  async function withTelemetry<T>(
    op: 'fetch' | 'drift' | 'reconcile' | 'snapshot',
    ctx: ReconciliationContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    telemetry.emit('domain_reconciliation_live_execution_started', {
      executionId: ctx.executionId, rowId: ctx.rowId, provider: ctx.provider, op,
    });
    try {
      const r = await fn();
      telemetry.emit('domain_reconciliation_live_execution_completed', {
        executionId: ctx.executionId, rowId: ctx.rowId, provider: ctx.provider, op,
      });
      return r;
    } catch (err) {
      telemetry.emit('domain_reconciliation_live_execution_failed', {
        executionId: ctx.executionId, rowId: ctx.rowId, provider: ctx.provider, op,
        error: (err as Error)?.message ?? String(err),
      });
      throw err;
    }
  }

  return {
    runFetchProviderState: deps.fetchProviderState
      ? (ctx) => withTelemetry('fetch', ctx, () => deps.fetchProviderState!({
          executionId: ctx.executionId, rowId: ctx.rowId, provider: ctx.provider,
        }))
      : undefined,
    runDriftAnalysis: deps.runDriftAnalysis
      ? (ctx) => withTelemetry('drift', ctx, () => deps.runDriftAnalysis!({
          executionId: ctx.executionId, rowId: ctx.rowId, provider: ctx.provider,
        }))
      : undefined,
    runReconcileRow: (ctx) => withTelemetry('reconcile', ctx, () => deps.reconcileRow({
      executionId: ctx.executionId, rowId: ctx.rowId, provider: ctx.provider,
    })),
    runReconciliationSnapshot: deps.recordReconciliationSnapshot
      ? (ctx) => withTelemetry('snapshot', ctx, () => deps.recordReconciliationSnapshot!({
          executionId: ctx.executionId, rowId: ctx.rowId, provider: ctx.provider,
        }))
      : undefined,
  };
}
