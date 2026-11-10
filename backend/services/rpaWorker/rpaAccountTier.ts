import { getRpaAccountTier } from './rpaSessionStore';

/**
 * Resolve the caller's account tier for an (organization, platform).
 *
 * Only a SERVER-VERIFIED tier is returned (see getRpaAccountTier: the
 * session envelope must carry account_tier_verified === true, which no
 * client request can set). A client-declared tier — from the RPA auth
 * routes' `account_tier` field or from an action row's metadata — is never
 * trusted: it gated the Instagram business-only DM path, so trusting it let
 * any caller bypass the gate. `action_metadata` is accepted for call-site
 * compatibility and deliberately ignored.
 *
 * Consumers must treat `null` as "unknown" — the Instagram DM guard
 * rejects unknown + instagram + dm; other (platform, action) pairs
 * continue to allow unknown.
 */
export async function resolveAccountTier(input: {
  organization_id: string;
  platform: string;
  action_metadata?: unknown;
}): Promise<string | null> {
  const fromSession = await getRpaAccountTier(input.organization_id, input.platform.toLowerCase());
  return fromSession ? fromSession.toLowerCase() : null;
}
