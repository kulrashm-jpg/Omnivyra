import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/auth/passkeys/begin-authentication
 *
 * Body: ignored (a `userId` field is NOT honoured — see SEC91-B11 below)
 *
 * Step 1 of passkey verification. Two modes:
 *   - Userless ceremony (no body / no userId): server emits options with
 *     no allowCredentials list; the user is identified by the credential
 *     id they present at verify time. Used for sign-in flows where the
 *     user has not yet been identified.
 *   - User-scoped ceremony (authenticated principal only): server scopes the
 *     ceremony via allowCredentials. Used for step-up flows.
 *
 * The route does NOT require authentication: passkey login starts BEFORE
 * a session exists.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authRequestIpOrNull } from '../../../../backend/auth/requestClientIp';
import { beginAuthentication } from '../../../../backend/security/webauthn/WebAuthnAuthenticationService';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { logger } from '../../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SEC91-B11: a user-scoped ceremony (allowCredentials = that user's credential ids) is
  // only ever built for the AUTHENTICATED principal. A body `userId` without a session
  // used to be honoured, letting anyone learn whether an account has passkeys and read
  // its credential ids. Without a session the ceremony is always userless (the user is
  // identified by the credential presented at verify time) — which is what every in-repo
  // caller (pages/auth/mfa.tsx, lib/security/stepUpClient.ts) already requests with an
  // empty body. A body `userId` is ignored.
  let scopedUserId: string | null = null;
  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok === true && !principalResult.principal.legacyCookieSuperAdmin) {
    scopedUserId = principalResult.principal.userId;
  }

  try {
    const result = await beginAuthentication({
      userId:    scopedUserId,
      ip:        clientIp(req),
      userAgent: userAgent(req),
    });
    return res.status(200).json(result.options);
  } catch (err) {
    // Server-side breadcrumb so the actual exception is recoverable from
    // logs even if the client wrapper drops the `detail` field. Without
    // this, a 500 here is invisible — the wrapper text "Could not start
    // passkey authentication" tells you nothing about the underlying cause.
    logger.error('webauthn_begin_authentication_failed', {
      scopedUserId,
      message: err instanceof Error ? err.message : String(err),
      stack:   err instanceof Error ? err.stack : undefined,
    });
    return res.status(500).json({
      error: 'Could not start passkey authentication',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

// SEC91-W2B-3: platform-trusted client IP (lib/security/clientIp), never the
// client-written first X-Forwarded-For hop.
function clientIp(req: NextApiRequest): string | null {
  return authRequestIpOrNull(req);
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/passkeys/begin-authentication' });
