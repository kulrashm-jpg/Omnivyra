/**
 * Browser (extension) sync is suspended — owner decision R-3, 2026-11-03.
 * Client-side counterpart of backend/services/extensionIngestionSuspension.ts:
 * the Command Center never asks the extension to sync while this is true, and
 * says so plainly instead of reporting a failure.
 */
export const BROWSER_SYNC_SUSPENDED = true;

export const BROWSER_SYNC_SUSPENDED_NOTICE =
  'Browser sync is suspended. The Chrome extension no longer collects LinkedIn, X, Facebook or Instagram messages and comments, so new items from those platforms will not appear here until a reviewed sync is approved.';
