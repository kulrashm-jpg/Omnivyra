/**
 * POST /api/auth/passkeys/begin-authentication
 *
 * Body: { userId?: string }
 *
 * Step 1 of passkey verification. Two modes:
 *   - Userless ceremony (no body / no userId): server emits options with
 *     no allowCredentials list; the user is identified by the credential
 *     id they present at verify time. Used for sign-in flows where the
 *     user has not yet been identified.
 *   - User-scoped ceremony (userId set): server scopes the ceremony via
 *     allowCredentials. Used for step-up flows when the principal is
 *     already authenticated.
 *
 * The route does NOT require authentication: passkey login starts BEFORE
 * a session exists.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { beginAuthentication } from '../../../../backend/security/webauthn/WebAuthnAuthenticationService';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { logger } from '../../../../backend/services/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req);
  const explicitUserId = typeof body?.userId === 'string' && body.userId.length > 0 ? body.userId : null;

  // Authenticated step-up scope: principal id wins over body userId for
  // step-up ceremonies — a logged-in user binds the ceremony to themselves.
  let scopedUserId: string | null = explicitUserId;
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

function parseBody(req: NextApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') as Record<string, unknown>; } catch { return {}; }
  }
  return (req.body ?? {}) as Record<string, unknown>;
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
