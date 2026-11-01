/**
 * DM dispatch safety — the single policy every DM path consults.
 *
 * PRODUCT DECISIONS (binding):
 *   1. DMs stay blocked without an AUTHORITATIVE person -> thread / recipient
 *      mapping.
 *   2. Instagram DMs stay blocked without server-side account-tier enforcement
 *      from an authoritative source.
 *
 * FINDING (inspected 2026-10-28, worktree base 0d043d10):
 *   - No authoritative mapping exists. Every LinkedIn / Instagram / Facebook /
 *     Twitter DM thread id is a string the browser extension scraped from the
 *     DOM (pages/api/extension/events/dms.ts) or a server-synthesised id
 *     (`linkedin_dm:<id>`, `preview:<id>` — extensionEventIngestionService
 *     buildThreadId; legacy "ember64"-style ids). engagement_threads has no
 *     provenance column; engagement_sources is one row per platform;
 *     engagement_authors is tenant-less and scraped; identity_claims maps
 *     accounts to persons (never to threads) and every writer records
 *     'unverified'. Send-time lookups (reply.ts resolveLinkedInDmDispatchTarget,
 *     participant names, profile URLs) are heuristics.
 *   - No authoritative Instagram account-type source exists: the Meta OAuth
 *     flows read `instagram_business_account` (a Page link — it does not tell
 *     business from creator) and never request `account_type` or a messaging
 *     scope (instagram_manage_messages / instagram_business_manage_messages);
 *     rpa_sessions.account_tier is never verified (nothing sets
 *     account_tier_verified = true).
 *
 * MISSING DATA CONTRACT (what would lift decision 1, per platform):
 *   A tenant-scoped record binding (organization_id, connected sending account,
 *   platform, recipient person / platform user id) -> platform-issued
 *   conversation id, written ONLY from a platform API response (not the DOM,
 *   not synthesised), carrying provenance (source = platform_api, the API call /
 *   webhook id, observed_at) and the recipient's platform user id as returned
 *   by the platform, unique per (organization, account, platform, recipient),
 *   revocable, and re-verified at send time.
 * MISSING INTEGRATION (what would lift decision 2):
 *   Instagram Graph `account_type` (BUSINESS / MEDIA_CREATOR) fetched server-side
 *   with the tenant's token for the exact IG account that will send, stored with
 *   provenance and observed_at, plus a granted messaging scope
 *   (instagram_business_manage_messages), re-checked before every IG DM.
 *
 * Until both exist, every DM send is refused, provably before any platform
 * contact (`may_have_acted: false`). Read-only inbox sync (sync_dm_inbox) is
 * not a send and is unaffected.
 */

export const DM_RECIPIENT_MAPPING_UNAVAILABLE = 'DM_RECIPIENT_MAPPING_UNAVAILABLE';
export const INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED = 'INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED';

/**
 * Whether an authoritative person -> thread mapping source exists. It does not
 * (see FINDING). This is a statement about the data model, not a switch: it
 * must only change together with the missing data contract above.
 */
export const AUTHORITATIVE_DM_MAPPING_SOURCE = null as null | { table: string };

/** Extension commands that open, address or send into a DM conversation. */
export const DM_SEND_COMMANDS: ReadonlySet<string> = new Set([
  'continue_thread',
  'start_new_dm',
  'open_thread',
  'send_dm',
  'search_user',
]);

/** Read-only DM commands (inbox scraping). Never a send. */
export const DM_READ_ONLY_COMMANDS: ReadonlySet<string> = new Set(['sync_dm_inbox']);

export function isDmActionType(actionType: unknown): boolean {
  const t = String(actionType ?? '').trim().toLowerCase();
  return t === 'dm' || t === 'direct_message';
}

/**
 * Whether dispatching `extensionCommand` for a row with `topActionType` would
 * address or send a DM. A DM row is a send unless the command is read-only
 * sync; a DM command on a non-DM row (forged chain) is a send too.
 */
export function wouldDispatchDm(topActionType: unknown, extensionCommand: unknown): boolean {
  const cmd = String(extensionCommand ?? '').trim().toLowerCase();
  if (DM_READ_ONLY_COMMANDS.has(cmd)) return false;
  if (isDmActionType(topActionType)) return true;
  return DM_SEND_COMMANDS.has(cmd);
}

/**
 * The refusal for a DM send, or null when it may proceed. Instagram is checked
 * first so its specific reason is reported. `verifiedInstagramTier` must come
 * from a SERVER-VERIFIED source (resolveAccountTier); client input is never
 * passed here.
 */
export function dmSendRefusal(input: { platform: unknown; verifiedInstagramTier?: string | null }): string | null {
  const platform = String(input.platform ?? '').trim().toLowerCase();
  if (platform === 'instagram' && String(input.verifiedInstagramTier ?? '').toLowerCase() !== 'business') {
    return INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED;
  }
  if (!AUTHORITATIVE_DM_MAPPING_SOURCE) return DM_RECIPIENT_MAPPING_UNAVAILABLE;
  return null;
}

export const DM_BLOCKED_MESSAGE =
  'Direct messages are disabled: there is no verified mapping from this person to a platform conversation, ' +
  'so the message could reach the wrong person. Nothing was sent.';
export const INSTAGRAM_DM_BLOCKED_MESSAGE =
  'Instagram direct messages are disabled: the Instagram account type (business) is not verified server-side. Nothing was sent.';
