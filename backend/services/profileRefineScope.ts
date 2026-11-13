/**
 * Explicit, scoped opt-in for getProfile's staleness auto-refine (e9 2026-11-13).
 *
 * autoRefine is OPT-IN (every AI action is priced). Report 2 (the performance report) refreshes the company profile
 * BY DESIGN, through competitiveDatasetBootstrapService / competitorDiscoveryEngineService. But those same services
 * are also reached from unpriced paths (analytics health, the dashboard, the growth report, reports/performance), so
 * a call-site flag cannot tell billed from unbilled. The PRICED entry point - the report-card pipeline's
 * performance compose, which runs inside runWithUsageCollection (token-actual settlement) - opens this scope; the two
 * services read it. Outside the scope they never refine.
 */
import { AsyncLocalStorage } from 'async_hooks';

const profileRefineOptIn = new AsyncLocalStorage<true>();

/** Run `fn` with profile auto-refine allowed. Only a PRICED unit of work may call this. */
export function runWithProfileRefineOptIn<T>(fn: () => T): T {
  return profileRefineOptIn.run(true, fn);
}

/** true only inside runWithProfileRefineOptIn. */
export function isProfileRefineOptedIn(): boolean {
  return profileRefineOptIn.getStore() === true;
}
