import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/rpa/auth/complete
 *
 * Zero-manual-step session registration. The Chrome extension (or a
 * first-party desktop helper) captures cookies + localStorage after the
 * user completes platform login and POSTs the raw payload here. The
 * server converts it to a Playwright storageState and persists via
 * rpaSessionStore (encrypted at rest, no filesystem copy). The session_token
 * is single-use and user-bound; `account_tier` is ignored (never trusted).
 *
 * Body:
 *   {
 *     session_token: string,                       // from /api/rpa/auth/start
 *     capture: {
 *       cookies: Array<chrome.cookies.Cookie | {...}>,
 *       origins?: Array<{ origin, localStorage: [{name,value}] }>
 *     },
 *     account_tier?: 'business' | 'creator' | 'personal' | null,
 *     expires_at?: ISO string
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { RPA_LOGIN_DISABLED, rejectRpaLogin } from '../../../../backend/services/rpaWorker/rpaLoginBlock';

import { consumeRpaAuthToken, verifyRpaAuthToken } from '../../../../backend/services/rpaWorker/rpaAuthTokens';
import { saveRpaSession } from '../../../../backend/services/rpaWorker/rpaSessionStore';
import {
  importSessionCapture,
  parseSessionExpiresAt,
  scopeStorageStateToPlatform,
} from '../../../../backend/services/rpaWorker/rpaSessionImporter';

type Body = {
  session_token?: string;
  capture?: { cookies?: unknown; origins?: unknown };
  account_tier?: string | null;
  expires_at?: string | null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Owner decision #17 (2026-11-10): RPA logins are disabled before anything else runs.
  if (RPA_LOGIN_DISABLED) return rejectRpaLogin(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as Body;
    const token = (body.session_token ?? '').toString();
    const capture = body.capture;

    if (!token) return res.status(400).json({ error: 'session_token required' });
    if (!capture || typeof capture !== 'object') {
      return res.status(400).json({ error: 'capture object required' });
    }
    const cookies = (capture as { cookies?: unknown }).cookies;
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({ error: 'capture.cookies must be a non-empty array' });
    }

    // Validate the payload BEFORE consuming the single-use token.
    const storageState = importSessionCapture({
      cookies: cookies as any,
      origins: Array.isArray((capture as { origins?: unknown }).origins)
        ? ((capture as { origins?: unknown }).origins as any)
        : [],
    });

    if (!storageState.cookies || storageState.cookies.length === 0) {
      return res.status(400).json({ error: 'capture yielded zero valid cookies' });
    }
    const expiresAt = parseSessionExpiresAt(body.expires_at);
    if (expiresAt.ok === false) {
      return res.status(400).json({ error: 'expires_at must be an ISO 8601 date' });
    }
    // The platform lives in the token. A plain verify consumes nothing, so a
    // capture with no cookie for that platform does not burn the token.
    const peeked = verifyRpaAuthToken(token);
    if (peeked.ok === true && !scopeStorageStateToPlatform(storageState, peeked.payload.platform).cookies?.length) {
      return res.status(400).json({ error: 'capture has no cookies for this platform' });
    }

    // Single-use, user-bound redemption: signature + expiry, the issuing user
    // must still hold the connector-management role for the organization, and
    // the token nonce is consumed durably BEFORE anything is written. A replay
    // (or a concurrent second submission) is refused.
    const verified = await consumeRpaAuthToken(token);
    if (verified.ok === false) {
      return res.status(verified.status).json({
        error: verified.status === 403 ? 'FORBIDDEN_ROLE' : verified.status === 503 ? 'TOKEN_REDEMPTION_UNAVAILABLE' : 'INVALID_SESSION_TOKEN',
        reason: verified.reason,
      });
    }

    const { organization_id, platform } = verified.payload;
    // A client-declared account_tier is never stored or trusted (see save-session).
    const scopedState = scopeStorageStateToPlatform(storageState, platform);
    await saveRpaSession(organization_id, platform, scopedState, {
      account_tier: null,
      last_login_at: new Date().toISOString(),
      expires_at: expiresAt.value,
    });

    return res.status(200).json({
      success: true,
      organization_id,
      platform,
      cookie_count: scopedState.cookies?.length ?? 0,
      origin_count: (scopedState.origins ?? []).length,
      account_tier: null,
      account_tier_status: 'unverified',
      declared_account_tier_ignored: body.account_tier != null,
    });
  } catch (err) {
    console.error('[rpa/auth/complete]', err);
    return res.status(500).json({ error: 'Failed to complete RPA auth' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/rpa/auth/complete' });
