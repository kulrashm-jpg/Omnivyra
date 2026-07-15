/**
 * F-09 — Unified Retry & Timeout Budget (Foundation Batch C).
 *
 * The canonical abstraction for the ONE-RETRY-OWNER-PER-LOGICAL-OPERATION
 * standard. The audit's B-09: planner retry × gateway retry × provider
 * fallback compose multiplicatively (3–4 full model calls for one logical
 * request) because the layers cannot see each other. A budget object is the
 * shared ledger they will all consult.
 *
 * ADOPTION (certification-corrected): first consumer is the planner-draft
 * seam (boltPipelineServiceRunPlan, flag 'retry-budget-planner'). The other
 * legacy implementations (utils/retryWithBackoff, plannerExporters,
 * productionPrimitives.withRetry, the gateway fallback chain) remain
 * untouched pending their own flag-gated adoption.
 *
 * Promoted patterns: exponential backoff (utils/retryWithBackoff), bounded
 * withTimeout (intelligence/productionPrimitives), error-class heuristics
 * (route factory classifyError, retry-tuned).
 */
import { recordRawCounter, recordRawHistogram } from '../../backend/observability';

// ── Retry classification ──────────────────────────────────────────────────────

export type RetryClass =
  | 'retryable_transient'  // 429 / 5xx / connection reset — retry helps
  | 'timeout'              // the work may STILL BE RUNNING — retry multiplies cost
  | 'abort'                // caller cancelled — never retry
  | 'non_retryable'        // 4xx validation/auth/logic — retry cannot help
  | 'unknown';

/**
 * Classify an error for retry decisions. Heuristic and conservative: unknown
 * errors are NOT treated as retryable by `isRetryable` — the B-09 lesson is
 * that optimistic retries multiply cost.
 */
export function classifyForRetry(err: unknown): RetryClass {
  try {
    if (err === null || err === undefined) return 'unknown';
    const e = err as { name?: string; code?: string | number; message?: string; status?: number; statusCode?: number };
    const name = String(e.name ?? '');
    const code = String(e.code ?? '');
    const msg = String(e.message ?? '');
    const status = Number(e.status ?? e.statusCode ?? NaN);

    if (name === 'AbortError' || /aborted/i.test(msg)) return 'abort';
    if (/timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(`${name} ${code} ${msg}`)) return 'timeout';
    if (status === 429 || /rate.?limit/i.test(msg)) return 'retryable_transient';
    if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up/i.test(`${code} ${msg}`)) return 'retryable_transient';
    if (Number.isFinite(status)) {
      if (status >= 500) return 'retryable_transient';
      if (status >= 400) return 'non_retryable';
    }
    if (name === 'ZodError' || /validation/i.test(name)) return 'non_retryable';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The default retry predicate: transient only. Timeouts do NOT retry. */
export function isRetryable(err: unknown): boolean {
  return classifyForRetry(err) === 'retryable_transient';
}

// ── Operation budget ──────────────────────────────────────────────────────────

export interface OperationBudgetDef {
  /** Logical operation name — the metrics label (e.g. 'campaign-plan'). */
  name: string;
  /** Cumulative wall-clock ceiling across ALL layers/attempts. */
  maxTotalMs?: number;
  /** Cumulative attempt ceiling across ALL layers (first try counts as 1). */
  maxAttempts?: number;
}

export interface AttemptDecision {
  allowed: boolean;
  reason?: 'budget_ms_exhausted' | 'budget_attempts_exhausted';
  remainingMs: number | null;
  remainingAttempts: number | null;
}

export interface OperationBudget {
  readonly name: string;
  /** Ask permission before an attempt; denial is recorded to metrics. */
  tryConsumeAttempt(layer: string): AttemptDecision;
  remainingMs(): number | null;
  remainingAttempts(): number | null;
  /** Diagnostics: every attempt with its layer and elapsed offset. */
  ledger(): Array<{ layer: string; atMs: number }>;
}

/**
 * Create a budget shared by every retry layer of ONE logical operation. The
 * caller threads it through; each layer calls tryConsumeAttempt before work.
 * Time accounting is monotonic from creation.
 */
export function createOperationBudget(def: OperationBudgetDef): OperationBudget {
  const startedAt = Date.now();
  let attempts = 0;
  const entries: Array<{ layer: string; atMs: number }> = [];

  const remainingMs = (): number | null =>
    def.maxTotalMs === undefined ? null : Math.max(0, def.maxTotalMs - (Date.now() - startedAt));
  const remainingAttempts = (): number | null =>
    def.maxAttempts === undefined ? null : Math.max(0, def.maxAttempts - attempts);

  return {
    name: def.name,
    tryConsumeAttempt(layer: string): AttemptDecision {
      const ms = remainingMs();
      const att = remainingAttempts();
      if (ms !== null && ms <= 0) {
        try { recordRawCounter('retry_budget.denied', 1, { operation: def.name, layer, reason: 'ms' }); } catch { /* fail-safe */ }
        return { allowed: false, reason: 'budget_ms_exhausted', remainingMs: ms, remainingAttempts: att };
      }
      if (att !== null && att <= 0) {
        try { recordRawCounter('retry_budget.denied', 1, { operation: def.name, layer, reason: 'attempts' }); } catch { /* fail-safe */ }
        return { allowed: false, reason: 'budget_attempts_exhausted', remainingMs: ms, remainingAttempts: att };
      }
      attempts++;
      entries.push({ layer, atMs: Date.now() - startedAt });
      try { recordRawCounter('retry_budget.attempt', 1, { operation: def.name, layer }); } catch { /* fail-safe */ }
      return { allowed: true, remainingMs: ms, remainingAttempts: remainingAttempts() };
    },
    remainingMs,
    remainingAttempts,
    ledger: () => entries.slice(),
  };
}

// ── Canonical timeout + budgeted retry (future consolidation targets) ────────

export class BudgetTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'BudgetTimeoutError';
  }
}

/** Bounded await. The underlying work is NOT cancelled (document at call site). */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BudgetTimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryWithBudgetOptions<T> {
  budget: OperationBudget;
  layer: string;
  maxRetries?: number;               // per-layer cap (budget still governs)
  initialDelayMs?: number;           // exponential backoff base
  retryOn?: (err: unknown) => boolean; // default: isRetryable (transient only)
  onAttempt?: (info: { attempt: number; delayMs: number }) => void;
}

/**
 * The FUTURE canonical retry executor (W3-3 wires callers onto it). Exists in
 * Batch C so the interface freezes with its first tests; adopted nowhere yet.
 */
export async function retryWithBudget<T>(fn: () => Promise<T>, opts: RetryWithBudgetOptions<T>): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const initialDelayMs = opts.initialDelayMs ?? 1_000;
  const retryOn = opts.retryOn ?? isRetryable;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const decision = opts.budget.tryConsumeAttempt(opts.layer);
    if (!decision.allowed) {
      if (lastErr !== undefined) throw lastErr;
      throw new Error(`retry budget exhausted before first attempt (${opts.budget.name}/${opts.layer}: ${decision.reason})`);
    }
    const attemptStarted = Date.now();
    try {
      const result = await fn();
      try { recordRawHistogram('retry_budget.attempt_ms', Date.now() - attemptStarted, { operation: opts.budget.name, layer: opts.layer, outcome: 'ok' }); } catch { /* fail-safe */ }
      return result;
    } catch (err) {
      lastErr = err;
      const cls = classifyForRetry(err);
      try {
        recordRawCounter('retry_budget.attempt_failed', 1, { operation: opts.budget.name, layer: opts.layer, class: cls });
      } catch { /* fail-safe */ }
      if (attempt >= maxRetries || !retryOn(err)) throw err;
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      try { opts.onAttempt?.({ attempt: attempt + 1, delayMs }); } catch { /* fail-safe */ }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}
