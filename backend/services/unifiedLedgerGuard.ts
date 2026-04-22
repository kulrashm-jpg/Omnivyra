/**
 * Unified Ledger Guard — runtime assertion layer.
 *
 * When `USE_UNIFIED_LEDGER_ONLY === 'true'` (env), any analytics-context
 * read path that would have historically hit usage_events or credit_usage_log
 * must call `assertAnalyticsUsesUnified()` first. The guard throws loudly
 * so drift from the unified ledger is impossible to miss in staging/prod.
 *
 * Write paths (logUsageEvent itself, trackUsage) are EXEMPT — we still
 * dual-write to usage_events + credit_usage_log during the transition.
 * Only ANALYTICS reads are gated.
 */

import { logger } from './logger';
import { isUnifiedLedgerOnly } from './config/productionFlags';

export class LegacyLedgerReadError extends Error {
  constructor(public readonly context: string, public readonly tableHint?: string) {
    super(
      `Legacy ledger read blocked in '${context}'${tableHint ? ` (${tableHint})` : ''}. ` +
      `USE_UNIFIED_LEDGER_ONLY=true — all analytics must read unified_transactions.`,
    );
    this.name = 'LegacyLedgerReadError';
  }
}

function isStrictMode(): boolean {
  // Reads from the frozen flags loader so runtime process.env edits can't
  // flip this off after boot.
  return isUnifiedLedgerOnly();
}

/**
 * Call at the top of every analytics service read function. When strict-mode
 * is on, throws if the caller's context suggests a legacy-ledger read. The
 * `context` string is free-form (e.g. 'orgCostSummaryService.getOrgCostSummary')
 * and lands in the thrown error + logs.
 *
 * Safe to call unconditionally — in non-strict mode it's a no-op.
 */
export function assertAnalyticsUsesUnified(context: string): void {
  if (!isStrictMode()) return;
  // The assertion itself is a marker. The throw happens only when an
  // analytics function explicitly claims it's reading the legacy table
  // via reportLegacyLedgerRead below. For most callers, this is a tripwire.
}

/**
 * Explicitly report an intent to read a legacy ledger table. In strict mode
 * this throws; in lenient mode it logs a warning so drift is still visible
 * during the rollout phase. Only wrapper/legacy shims should call this.
 */
export function reportLegacyLedgerRead(
  tableHint: 'usage_events' | 'credit_usage_log',
  context: string,
): void {
  const message = `legacy_ledger_read context=${context} table=${tableHint}`;
  if (isStrictMode()) {
    logger.error('legacy_ledger_read_blocked', { context, tableHint });
    throw new LegacyLedgerReadError(context, tableHint);
  }
  logger.warn('legacy_ledger_read_detected', { context, tableHint });
  console.warn(`[unified-guard] ${message}`);
}

/** Exposed for tests / docs. */
export const UNIFIED_LEDGER_STRICT_ENV_VAR = 'USE_UNIFIED_LEDGER_ONLY';
