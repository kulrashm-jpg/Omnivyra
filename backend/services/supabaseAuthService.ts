/**
 * Legacy facade — preserved for callers that haven't been migrated to
 * resolveAuthenticatedUser yet. ALL behavior delegates to the canonical
 * resolver in ./authResolver.ts. NO duplicate logic lives here.
 *
 * Migration guidance: new code should import resolveAuthenticatedUser
 * directly. This facade exists only because moving every call site at
 * once would balloon the spine-consolidation diff.
 */

import type { NextApiRequest } from 'next';
import {
  extractAccessToken as canonicalExtractAccessToken,
  resolveAuthenticatedUser,
} from './authResolver';

/** @deprecated — use {@link extractAccessToken} from ./authResolver. */
export const extractAccessToken = canonicalExtractAccessToken;

/**
 * @deprecated — use {@link resolveAuthenticatedUser} from ./authResolver.
 * Adapter preserves the legacy `{user: {id, email}, error}` shape; the
 * underlying logic lives in authResolver.ts.
 *
 * Note: legacy callers expected error codes `MISSING_AUTH`, `INVALID_AUTH`,
 * and `ACCOUNT_DELETED`. The canonical resolver now distinguishes
 * NO_TOKEN/INVALID_TOKEN/NO_EMAIL/USER_NOT_FOUND/ACCOUNT_DELETED. The
 * mapping below preserves the legacy surface.
 */
export const getSupabaseUserFromRequest = async (
  req: NextApiRequest,
): Promise<{ user: { id: string; email?: string | null } | null; error: string | null }> => {
  const result = await resolveAuthenticatedUser(req);
  if (result.error === null) {
    // Phase 2.B — invited users surface to legacy callers as INVALID_AUTH so
    // the existing 401 → re-auth UX kicks in. Routes that want to allow
    // invited principals must use resolveAuthenticatedUser directly.
    if (result.user.status === 'invited') {
      return { user: null, error: 'ACCOUNT_INVITED' };
    }
    return { user: { id: result.user.id, email: result.user.email }, error: null };
  }
  if (result.error === 'NO_TOKEN') return { user: null, error: 'MISSING_AUTH' };
  if (result.error === 'ACCOUNT_DELETED') return { user: null, error: 'ACCOUNT_DELETED' };
  if (result.error === 'ACCOUNT_SUSPENDED') return { user: null, error: 'ACCOUNT_SUSPENDED' };
  if (result.error === 'SESSION_REVOKED') return { user: null, error: 'SESSION_REVOKED' };
  return { user: null, error: 'INVALID_AUTH' };
};
