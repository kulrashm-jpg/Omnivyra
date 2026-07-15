import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/extension/redeem
 *
 * Called by the extension service worker with ONLY a claim code. Redeems
 * the one-time code and returns the session token + HMAC secret. No
 * Authorization header is required or honored on this endpoint — the
 * single-use claim code IS the authentication factor for this one call.
 *
 * Response shape (the extension worker consumes this directly):
 * {
 *   success: true,
 *   data: {
 *     session_token: string,
 *     hmac_secret:   string,
 *     user_id:       string,
 *     org_id:        string,
 *     expires_at:    number,       // epoch ms
 *     polling_interval: number,    // seconds
 *     sync_mode:     'batch'
 *   }
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { redeemClaimCode } from '@/backend/services/extensionClaimCodeService';
import {
  issueExtensionSessionToken,
  deriveExtensionHmacSecret,
  generateHmacNonce,
} from '@/backend/services/extensionSessionService';
import { CAPABILITY_MAP_VERSION } from '@/backend/services/engagementCapabilityMap';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = (req.body || {}) as { claim_code?: string; claimCode?: string; runtime_id?: string };
  const claimCode = (body.claim_code ?? body.claimCode ?? '').toString().trim();
  if (!claimCode) {
    return res.status(400).json({ success: false, error: 'claim_code required' });
  }

  try {
    const claim = redeemClaimCode(claimCode);
    if (!claim) {
      return res.status(400).json({ success: false, error: 'INVALID_OR_EXPIRED_CLAIM_CODE' });
    }

    const expiresAt = Date.now() + 12 * 60 * 60 * 1000; // 12 h
    const hmacNonce = generateHmacNonce();

    // Session token carries the hmacNonce so every future request can
    // re-derive the secret server-side without DB lookup.
    const sessionToken = issueExtensionSessionToken({
      userId: claim.userId,
      orgId: claim.orgId,
      expiresAt,
      hmacNonce,
    });

    const hmacSecret = deriveExtensionHmacSecret({
      userId: claim.userId,
      orgId: claim.orgId,
      expiresAt,
      nonce: hmacNonce,
    });

    return res.status(200).json({
      success: true,
      data: {
        session_token: sessionToken,
        hmac_secret: hmacSecret,
        user_id: claim.userId,
        org_id: claim.orgId,
        expires_at: expiresAt,
        polling_interval: 60,
        sync_mode: 'batch',
        capability_map_version: CAPABILITY_MAP_VERSION,
      },
    });
  } catch (error) {
    console.error('[extension/redeem]', error);
    return res.status(500).json({ success: false, error: (error as Error)?.message || 'redeem failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/extension/redeem' });
