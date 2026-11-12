/**
 * Extension auth middleware — verify session token + HMAC signature on
 * protected /api/extension/* endpoints.
 *
 * Usage inside a Next.js API route:
 *   const auth = await requireExtensionAuth(req, res);
 *   if (!auth) return; // middleware already wrote the error response
 *   const { session } = auth;
 *
 * Dev bypass: setting DEV_EXTENSION_AUTH_BYPASS=1 skips both session-token
 * and HMAC checks — the request body's `organization_id` becomes the
 * tenant. Only honored when NODE_ENV is provably non-production
 * (isNonProduction(): exactly 'development' or 'test') AND the request is
 * addressed to a loopback host. Used to unblock
 * local DOM-scraper testing without grinding through the SW HMAC chain.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  verifyExtensionSessionToken,
  verifyExtensionRequestSignature,
} from '@/backend/services/extensionSessionService';
import { supabase } from '@/backend/db/supabaseClient';
import { isNonProduction } from '@/backend/services/config/productionFlags';

function take(h: string | string[] | undefined) { return (Array.isArray(h) ? h[0] : h) || ''; }

/** Hostname of a Host-style header value, port stripped ('[::1]:3000' -> '::1', 'localhost:3000' -> 'localhost'). */
function hostnameOf(raw: string): string {
  const v = raw.split(',')[0].trim().toLowerCase();
  if (v.startsWith('[')) return v.slice(1, v.indexOf(']') > 0 ? v.indexOf(']') : undefined);
  return v.replace(/:\d+$/, '');
}

function isLoopbackHostname(h: string): boolean {
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

/**
 * Second guard for the dev bypass: the request must be addressed to a loopback host. Host is required and must be
 * loopback; X-Forwarded-Host, when a proxy set one, must be loopback too (a deployment behind a proxy forwards the
 * public domain there). Absent or unparseable -> not loopback (fail-closed).
 */
function isLoopbackRequest(req: NextApiRequest): boolean {
  const host = hostnameOf(take(req.headers.host));
  if (!host || !isLoopbackHostname(host)) return false;
  const fwd = take(req.headers['x-forwarded-host']);
  return !fwd || isLoopbackHostname(hostnameOf(fwd));
}

async function inferDevBypassOrgId(req: NextApiRequest): Promise<string | null> {
  const path = (req.url || '').split('?')[0] || '';
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
    commandId?: unknown;
    command_id?: unknown;
  };
  const commandId = String(body.commandId ?? body.command_id ?? req.query.commandId ?? req.query.command_id ?? '').trim();

  if (commandId) {
    const { data } = await supabase
      .from('community_ai_actions')
      .select('organization_id')
      .eq('id', commandId)
      .maybeSingle();
    return typeof data?.organization_id === 'string' ? data.organization_id : null;
  }

  if (req.method?.toUpperCase() === 'GET' && path === '/api/extension/commands') {
    const { data } = await supabase
      .from('community_ai_actions')
      .select('organization_id')
      .eq('status', 'pending')
      .eq('execution_mode', 'browser')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return typeof data?.organization_id === 'string' ? data.organization_id : null;
  }

  return null;
}

export async function requireExtensionAuth(req: NextApiRequest, res: NextApiResponse) {
  // Dev bypass — short-circuit the entire HMAC/session chain when the
  // operator opts in via env. Refuses to run in production no matter what
  // the env says, so a stray flag in a deployed env can't disable auth.
  //
  // SECURITY (2026-11-13, e9 ruling): that promise used to rest on
  // `process.env.NODE_ENV !== 'production'`, which fails OPEN for any value
  // other than the exact string (unset, 'staging', 'Production'). Two guards,
  // both fail-closed, now hold it:
  //   1. isNonProduction(): NODE_ENV provably 'development' or 'test';
  //   2. the request is addressed to a LOOPBACK host (Host and, when present,
  //      X-Forwarded-Host) - the bypass exists only for local DOM-scraper
  //      testing, so any deployed domain is refused without a list to maintain.
  // Guard 1 is THE boundary; guard 2 is defence in depth only: Host is a
  // client-controlled header (anyone can send `Host: localhost`). Never drop
  // isNonProduction() on the grounds that loopback is already required.
  const bypassEnabled =
    isNonProduction()
    && (process.env.DEV_EXTENSION_AUTH_BYPASS === '1'
        || process.env.DEV_EXTENSION_AUTH_BYPASS === 'true')
    && isLoopbackRequest(req);
  if (bypassEnabled) {
    // Accept all three orgId casings — the codebase isn't consistent and
    // refusing one shape silently breaks the dev-bypass redeem chain
    // (authBridge sends `orgId` camelCase from the SW, while events/dms
    // sends `organization_id` snake_case from the scraper).
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
    // Use a deterministic sentinel UUID for the bypass user so downstream
    // writes that need a uuid-typed user_id (e.g. extension_sessions
    // heartbeat) succeed instead of erroring on type mismatch. The string
    // 'dev-bypass-user' was easier to read in logs but blocked uuid columns.
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
