/**
 * Extension auth middleware — verify session token + HMAC signature on
 * protected /api/extension/* endpoints.
 *
 * Usage inside a Next.js API route:
 *   const auth = await requireExtensionAuth(req, res);
 *   if (!auth) return; // middleware already wrote the error response
 *   const { session } = auth;
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  verifyExtensionSessionToken,
  verifyExtensionRequestSignature,
} from '@/backend/services/extensionSessionService';

function take(h: string | string[] | undefined) { return (Array.isArray(h) ? h[0] : h) || ''; }

export async function requireExtensionAuth(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = take(req.headers.authorization);
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const session = verifyExtensionSessionToken(bearer);
  if (!session) {
    res.status(401).json({ success: false, error: 'INVALID_SESSION' });
    return null;
  }

  // Reconstruct raw body for signature verification. Next.js has already
  // parsed JSON into req.body; re-serialize with stable formatting. The
  // extension also serializes via JSON.stringify, so this matches for POST.
  // For GET the body is empty.
  const rawBody = req.method && req.method.toUpperCase() !== 'GET'
    ? (req.body ? JSON.stringify(req.body) : '')
    : '';

  const path = (req.url || '').split('?')[0] || '';
  const verify = verifyExtensionRequestSignature({
    method: req.method || 'GET',
    path,
    rawBody,
    timestampHeader: req.headers['x-omnivyra-timestamp'],
    nonceHeader: req.headers['x-omnivyra-nonce'],
    signatureHeader: req.headers['x-omnivyra-signature'],
    session,
  });

  if (!verify.ok) {
    res.status(401).json({ success: false, error: 'SIGNATURE_INVALID', reason: verify.reason });
    return null;
  }

  return { session };
}
