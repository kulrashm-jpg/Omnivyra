/**
 * Report deadline execution context.
 *
 * THE PROBLEM THIS SOLVES
 * `runDedupedReport` races composition against a 45s boundary and REJECTS. It never cancelled
 * anything, so when a Report 2 run was failed at the boundary the work behind it kept going.
 * The proven consumer (capture 3878545e) is `provider_and_snapshot`:
 *
 *   getAnalyticsEnterpriseSnapshot → computeAnalyticsEnterpriseSnapshot
 *     → discoverAndPersistCompetitorDomains / bootstrapCompetitorDataset
 *       → getProfile(companyId)            (no options ⇒ autoRefine defaults ON)
 *         → refineProfileWithAI → runProfileRefinement
 *             ├─ cleanEvidenceWithAi            (profileEnrichment)
 *             ├─ profileExtraction
 *             ├─ generateMissingFieldQuestions  (profileEnrichment)
 *             └─ discoverRefineCompetitorCandidates → SERP
 *
 * Eight intermediate functions separate the boundary from the AI and SERP calls that actually
 * hold the budget, and none of them has any business knowing about report deadlines.
 *
 * WHY ASYNCLOCALSTORAGE
 * This reuses the repository's established convention (`scanBudgetContext.ts`, `requestContext.ts`,
 * `executionContext.ts`) — and specifically the SAME convention the SERP fetch already reads from,
 * via `getActiveScanId()`, for exactly this reason: a report-scoped fact has to reach a deep
 * provider call without a signature change on every frame in between. The report enters this
 * context once; nested async work inherits the signal automatically.
 *
 * The signal is created by, and only by, the existing 45,000 ms boundary in
 * `reportConcurrencyService`. This module owns NO timer and starts NO clock — reading it outside a
 * report scope returns null, and every consumer treats null as "no deadline", which is the
 * pre-existing behaviour.
 */

import { AsyncLocalStorage } from 'async_hooks';

const reportDeadlineStore = new AsyncLocalStorage<{ signal: AbortSignal }>();

/**
 * Run `fn` inside the report's deadline scope. Every async call spawned inside `fn` inherits
 * `signal` via `getReportDeadlineSignal()`. Returns `fn`'s value unchanged.
 */
export function runWithReportDeadline<T>(signal: AbortSignal, fn: () => T): T {
  return reportDeadlineStore.run({ signal }, fn);
}

/** The active report's deadline signal, or null when called outside a report scope. */
export function getReportDeadlineSignal(): AbortSignal | null {
  return reportDeadlineStore.getStore()?.signal ?? null;
}

/** Thrown when work is stopped because the report that asked for it has already been failed. */
export class ReportDeadlineExceededError extends Error {
  readonly stage: string;

  constructor(stage: string) {
    super(`Report deadline exceeded before ${stage}`);
    this.name = 'ReportDeadlineExceededError';
    this.stage = stage;
  }
}

/**
 * Checkpoint for callers that swallow errors phase-by-phase (`computeAnalyticsEnterpriseSnapshot`
 * `.catch()`es each one). Without an explicit checkpoint such a caller would absorb the abort and
 * carry on to the next phase, which is precisely the abandoned work being fixed.
 *
 * An explicitly supplied `signal` wins over the ambient one, so a caller that holds a deadline but
 * has not opened a scope is still honoured. With neither, or before the deadline, this does nothing.
 */
export function throwIfReportDeadlineExceeded(stage: string, signal?: AbortSignal | null): void {
  if ((signal ?? getReportDeadlineSignal())?.aborted) throw new ReportDeadlineExceededError(stage);
}
