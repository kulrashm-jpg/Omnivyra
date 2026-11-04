import type { NextApiResponse } from 'next';

/**
 * Browser (extension) ingestion is suspended — owner decision R-3, 2026-11-03.
 *
 * Extension 1.4.0 collects DMs, comments and feeds in the background and
 * uploads them; 1.4.1 removed that collection. Until every install has
 * updated, this server-side block makes sure nothing collected in a browser
 * is stored, and that the server neither queues nor hands out collection
 * commands.
 *
 * Blocked (410, nothing read or stored):
 *   POST /api/extension/events
 *   POST /api/extension/events/dms
 *   POST /api/extension/events/comments
 *   POST /api/engagement/platform-sync   (queues sync_*_inbox browser commands)
 * Never offered to an extension: sync_dm_inbox / sync_comments_inbox commands
 *   (pages/api/extension/commands.ts).
 *
 * Not affected: official-API ingestion, the inbox read paths,
 * GET /api/engagement/platform-sync (freshness read), /api/engagement/sync
 * (stores nothing), and every action/command route.
 *
 * This is a code constant, not an environment flag, on purpose: re-enabling
 * browser ingestion requires a reviewed code change after the separate
 * privacy, legal and platform-terms approval (F-1).
 */
export const EXTENSION_BROWSER_INGESTION_SUSPENDED = true;

export const BROWSER_SYNC_SUSPENDED_CODE = 'BROWSER_SYNC_SUSPENDED';

export const BROWSER_SYNC_SUSPENDED_MESSAGE =
  'Omnivyra browser sync is suspended. Nothing collected in the browser was stored.';

/** Collection commands the server must not queue or hand to an extension. */
export const SUSPENDED_COLLECTION_COMMANDS: ReadonlySet<string> = new Set([
  'sync_dm_inbox',
  'sync_comments_inbox',
]);

export function refuseSuspendedIngestion(res: NextApiResponse) {
  return res.status(410).json({
    success: false,
    error: BROWSER_SYNC_SUSPENDED_CODE,
    message: BROWSER_SYNC_SUSPENDED_MESSAGE,
  });
}
