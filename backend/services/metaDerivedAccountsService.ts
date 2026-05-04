/**
 * @deprecated REMOVED — Meta IG/Threads derivation now runs transactionally
 * inside the OAuth callback at pages/api/auth/facebook/callback.ts via the
 * meta_oauth_apply Postgres RPC.
 *
 * The previous implementation:
 *   - Wrote social_accounts rows non-transactionally (partial-state risk)
 *   - Stored the FB user id in instagram rows' platform_user_id (broken IG routing)
 *   - Read scopes from the OAuth response (Meta does not return them; field was always empty)
 *
 * No exports remain. Importing from this module is a build error.
 */

export {};
