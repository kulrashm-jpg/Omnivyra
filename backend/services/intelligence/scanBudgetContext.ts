/**
 * BETA-PHASE1-EXEC-001 — Canonical Scan Budget execution context.
 *
 * The one missing capability identified by BETA-PHASE0-AUDIT-003: paid provider adapters
 * need the report's already-existing `scanId` (created by `buildCanonicalReport` +
 * `startScanBudget`) to reach the canonical cost-governance ledger — WITHOUT any
 * lookup-signature change.
 *
 * This reuses the repository's established AsyncLocalStorage convention (see
 * `requestContext.ts`, `executionContext.ts`, `aiUsageCollector.ts`) — no new architecture,
 * no provider-specific context, no global mutable state. The report enters this context
 * once (`runWithScanBudget`) around the provider-calling section; nested async provider
 * calls inherit the scan id automatically and read it with `getActiveScanId()`.
 */

import { AsyncLocalStorage } from 'async_hooks';

const scanBudgetStore = new AsyncLocalStorage<{ scanId: string }>();

/**
 * Run `fn` within the canonical scan-budget context. Every async provider call spawned
 * inside `fn` inherits `scanId` via `getActiveScanId()`. Returns `fn`'s value unchanged.
 */
export function runWithScanBudget<T>(scanId: string, fn: () => T): T {
  return scanBudgetStore.run({ scanId }, fn);
}

/** Read the active scan id, or null when called outside a scan-budget context. */
export function getActiveScanId(): string | null {
  return scanBudgetStore.getStore()?.scanId ?? null;
}
