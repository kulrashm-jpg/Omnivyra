/**
 * Extension auth middleware: verify session token + HMAC signature on
 * protected /api/extension/* endpoints.
 *
 * Dev bypass: setting ALLOW_DEV_AUTH_BYPASS=true skips both session-token
 * and HMAC checks. Only honored when NODE_ENV === 'development'.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  verifyExtensionSessionToken,
  verifyExtensionRequestSignature,
} from '@/backend/services/extensionSessionService';
import { runWithServiceRole } from '@/backend/db/supabaseClient';

if (
  process.env.ALLOW_DEV_AUTH_BYPASS === 'true' &&
  process.env.NODE_ENV !== 'development'
) {
  throw new Error('CRITICAL: Dev auth bypass attempted outside development');
}

function take(h: string | string[] | undefined) {
  return (Array.isArray(h) ? h[0] : h) || '';
}

async function inferDevBypassOrgId(req: NextApiRequest): Promise<string | null> {
  const path = (req.url || '').split('?')[0] || '';
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
    commandId?: unknown;
    command_id?: unknown;
  };
  const commandId = String(body.commandId ?? body.command_id ?? req.query.commandId ?? req.query.command_id ?? '').trim();

  if (commandId) {
    const { data } = await runWithServiceRole(
      'Infer extension dev-bypass org from command id',
      (client) => client
        .from('community_ai_actions')
        .select('organization_id')
        .eq('id', commandId)
        .maybeSingle(),
    );
    return typeof data?.organization_id === 'string' ? data.organization_id : null;
  }

  if (req.method?.toUpperCase() === 'GET' && path === '/api/extension/commands') {
    const { data } = await runWithServiceRole(
      'Infer extension dev-bypass org from latest browser command',
      (client) => client
        .from('community_ai_actions')
        .select('organization_id')
        .eq('status', 'pending')
        .eq('execution_mode', 'browser')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    return typeof data?.organization_id === 'string' ? data.organization_id : null;
  }

  return null;
}

export async function requireExtensionAuth(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('Auth bypass is only allowed in development');
    }

    console.warn('[AUTH BYPASS ACTIVE - DEV ONLY]');

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      organization_id?: unknown;
      org_id?: unknown;
      orgId?: unknown;
    };
    const orgFromBody = String(body.organization_id ?? body.org_id ?? body.orgId ?? '').trim();
    const orgFromQuery = String(req.query.organization_id ?? req.query.org_id ?? req.query.orgId ?? '').trim();
    const orgId = orgFromBody || orgFromQuery || await inferDevBypassOrgId(req);
    if (!orgId) {
      res.status(400).json({ success: false, error: 'BYPASS_REQUIRES_ORG_ID' });
      return null;
    }

    return {
      session: {
        userId: '00000000-0000-4000-8000-000000000001',
        orgId,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        hmacNonce: 'dev-bypass',
      },
    };
  }

  const authHeader = take(req.headers.authorization);
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const session = verifyExtensionSessionToken(bearer);
  if (!session) {
    res.status(401).json({ success: false, error: 'INVALID_SESSION' });
    return null;
  }

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
