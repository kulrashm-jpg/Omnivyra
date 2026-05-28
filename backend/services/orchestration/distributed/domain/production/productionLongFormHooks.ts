/**
 * Phase 26A — Production long-form service hook factory.
 *
 * Wires `LongFormServiceHooks` into real backend long-form services
 * (under `backend/services/longForm/*`) without modifying those services.
 *
 * The factory accepts caller-supplied function references — operators
 * import the real services in their boot wiring and pass them through.
 * This keeps the substrate framework-only and the production wiring an
 * opt-in INTEGRATION layer.
 *
 * GUARANTEES:
 *   - Replay-safe generation: every hook invocation emits structured
 *     telemetry that the diagnostics aggregator correlates back to the
 *     execution. The substrate's idempotency governor + checkpoint chain
 *     handle deduplication.
 *   - Deterministic regeneration suppression: the LongFormBuilder attaches
 *     per-section idempotency hints (`cls=node_insert`, fingerprint
 *     `['lf', generationId, sectionId]`). Re-running the same section is
 *     a no-op via the governor.
 *   - No duplicate section generation: the hook itself is a thin shim;
 *     dedup happens AT THE STEP LEVEL via idempotency, not here.
 *
 * Telemetry:
 *   domain_long_form_live_execution_started
 *   domain_long_form_live_execution_completed
 *   domain_long_form_live_execution_failed
 */

import type {
  LongFormContext,
  LongFormServiceHooks,
} from '../domainWorkflowTypes';

// ────────────────────────────────────────────────────────────────────
// Service signatures (caller-supplied function refs)
// ────────────────────────────────────────────────────────────────────

/**
 * Caller-supplied implementations. Each function receives the live
 * LongFormContext + any per-call inputs and performs the actual
 * domain work (calling into backend/services/longForm/*).
 *
 * The signatures are intentionally NARROW so they don't leak the full
 * shape of the production services into the substrate — operators
 * adapt their existing service calls inside the function body.
 */
export interface LongFormServiceDeps {
  /**
   * Generate a single section. Operators wire this into the existing
   * long-form generation service (e.g. `backend/services/longForm/
   * generationCoordinator.generateSection(...)`).
   *
   * MUST be idempotent on (generationId, sectionId). The substrate's
   * idempotency governor provides defense in depth; the real service
   * SHOULD also be idempotent on its own keys (e.g. content fingerprint).
   */
  generateSection: (input: {
    executionId: string;
    generationId: string;
    sectionId: string;
    companyContext: Record<string, unknown>;
  }) => Promise<void>;

  /** Optional precheck — runs ONCE before any section. */
  precheck?: (input: {
    executionId: string;
    generationId: string;
    companyContext: Record<string, unknown>;
  }) => Promise<void>;

  /** Optional enrichment phase after all sections. */
  enrichContent?: (input: {
    executionId: string;
    generationId: string;
    companyContext: Record<string, unknown>;
  }) => Promise<void>;

  /** Optional recommendation card emission. */
  emitRecommendationCard?: (input: {
    executionId: string;
    generationId: string;
    companyContext: Record<string, unknown>;
  }) => Promise<void>;

  /** Optional finalize hook. */
  finalize?: (input: {
    executionId: string;
    generationId: string;
    companyContext: Record<string, unknown>;
  }) => Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ProductionLongFormTelemetryEvent =
  | 'domain_long_form_live_execution_started'
  | 'domain_long_form_live_execution_completed'
  | 'domain_long_form_live_execution_failed';

export interface ProductionLongFormTelemetrySink {
  emit(event: ProductionLongFormTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ProductionLongFormTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'domain_long_form_live_execution_failed') {
        console.warn(`[prod_long_form] ${line}`);
      } else {
        console.log(`[prod_long_form] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────

export interface CreateProductionLongFormHooksOptions {
  deps: LongFormServiceDeps;
  telemetry?: ProductionLongFormTelemetrySink;
}

/**
 * Build a `LongFormServiceHooks` instance that delegates to the
 * caller-supplied real services. Each hook is wrapped with telemetry
 * around the call so the diagnostics aggregator + forensic analyzer
 * can correlate live executions.
 */
export function createProductionLongFormHooks(
  options: CreateProductionLongFormHooksOptions,
): LongFormServiceHooks {
  if (!options || !options.deps || typeof options.deps.generateSection !== 'function') {
    throw new Error('[createProductionLongFormHooks] deps.generateSection required');
  }
  const deps = options.deps;
  const telemetry = options.telemetry ?? defaultTelemetrySink;

  async function withTelemetry<T>(
    op: 'precheck' | 'section' | 'enrichment' | 'recommendation' | 'finalize',
    ctx: LongFormContext,
    extra: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    telemetry.emit('domain_long_form_live_execution_started', {
      executionId: ctx.executionId,
      generationId: ctx.generationId,
      op, ...extra,
    });
    try {
      const result = await fn();
      telemetry.emit('domain_long_form_live_execution_completed', {
        executionId: ctx.executionId,
        generationId: ctx.generationId,
        op, ...extra,
      });
      return result;
    } catch (err) {
      telemetry.emit('domain_long_form_live_execution_failed', {
        executionId: ctx.executionId,
        generationId: ctx.generationId,
        op, ...extra,
        error: (err as Error)?.message ?? String(err),
      });
      throw err;
    }
  }

  return {
    runPrecheck: deps.precheck
      ? (ctx) => withTelemetry('precheck', ctx, {}, () => deps.precheck!({
          executionId: ctx.executionId,
          generationId: ctx.generationId,
          companyContext: ctx.companyContext,
        }))
      : undefined,
    runGenerationSection: (ctx, sectionId) => withTelemetry(
      'section', ctx, { sectionId },
      () => deps.generateSection({
        executionId: ctx.executionId,
        generationId: ctx.generationId,
        sectionId,
        companyContext: ctx.companyContext,
      }),
    ),
    runEnrichment: deps.enrichContent
      ? (ctx) => withTelemetry('enrichment', ctx, {}, () => deps.enrichContent!({
          executionId: ctx.executionId,
          generationId: ctx.generationId,
          companyContext: ctx.companyContext,
        }))
      : undefined,
    runRecommendationCard: deps.emitRecommendationCard
      ? (ctx) => withTelemetry('recommendation', ctx, {}, () => deps.emitRecommendationCard!({
          executionId: ctx.executionId,
          generationId: ctx.generationId,
          companyContext: ctx.companyContext,
        }))
      : undefined,
    runFinalize: deps.finalize
      ? (ctx) => withTelemetry('finalize', ctx, {}, () => deps.finalize!({
          executionId: ctx.executionId,
          generationId: ctx.generationId,
          companyContext: ctx.companyContext,
        }))
      : undefined,
  };
}
