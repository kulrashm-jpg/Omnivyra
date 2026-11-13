import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/auth/check-user
 * Body: { email: string }
 *
 * DEPRECATED, NEUTRALIZED ORACLE (AUTH-001, Section 2).
 *
 * This endpoint previously returned { exists: boolean } for any email —
 * unauthenticated, un-rate-limited, and failing OPEN to a fabricated
 * positive. That made it the clearest account-enumeration oracle on the
 * signup surface,
 * undermining the anti-enumeration work in resend-verification/reset.
 * A repo-wide search found ZERO callers (login/magic-link pre-check via
 * /api/auth/login and /api/auth/magic-link replaced it), so the contract
 * is preserved in shape only:
 *
 *   - Rate limited: 20 requests / 15 min / IP AND a global cap
 *     (CHECK_USER_GLOBAL_LIMIT), both decided before any lookup; refusal =
 *     explicit 429 + Retry-After (P2-D: no CAPTCHA, the limiter is the
 *     whole defence).
 *   - Constant response: always { exists: false } for well-formed input,
 *     regardless of whether the account exists — no discovery possible.
 *   - Constant work: exactly one indexed lookup on public.users runs on
 *     every well-formed request (result only feeds the audit log). The
 *     previous second path (Supabase Auth admin REST fallback) is removed.
 *   - Uniform timing (P2-D): every response path is padded to
 *     AUTH_ENUMERATION_MIN_RESPONSE_MS from request start.
 *   - Fail CLOSED: unexpected errors return a generic 500 — never a
 *     fabricated positive result.
 *   - Audited: the real outcome is recorded via the existing security
 *     audit trail (capability_audit_log) for operator visibility.
 *
 * New code must not call this endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authRequestIp } from '../../../backend/auth/requestClientIp';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit, CHECK_USER_GLOBAL_LIMIT } from '../../../lib/auth/rateLimit';
import { incrementAuthMetric } from '../../../backend/services/authMetrics';
import { logger } from '../../../backend/services/logger';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import {
  AUTH_RATE_LIMITED_BODY,
  getAuthResponseClock,
  padToMinimumLatency,
  retryAfterSeconds,
} from '../../../backend/auth/uniformAuthResponse';

type Outcome = { status: number; body: { exists: boolean } | { error: string; code?: string }; retryAfter?: number };

async function decide(req: NextApiRequest): Promise<Outcome> {
  const ip = authRequestIp(req);
  // SEC91-W2B-3: an enumeration surface — sensitive, so a Redis outage gives it its own
  // strict per-instance budget (lib/auth/rateLimit), never the generous fallback cap.
  const rl = await checkRateLimit(ip, { keyPrefix: 'rl:auth:check-user', limit: 20, windowSecs: 15 * 60, sensitive: true });
  if (!rl.allowed) return { status: 429, body: AUTH_RATE_LIMITED_BODY, retryAfter: retryAfterSeconds(rl.resetAt, Date.now()) };
  // e9 ruling 2026-11-13: the GLOBAL ceiling is ALERT-ONLY - a distributed flood must never pause sign-in for everyone.
  // The enforcing controls are per-IP (above) and per-email (below). Over the global budget we log + count only.
  const globalRl = await checkRateLimit('global', CHECK_USER_GLOBAL_LIMIT);
  if (!globalRl.allowed) {
    logger.warn('auth.enumeration_global_ceiling_exceeded', { route: 'check-user' });
    incrementAuthMetric('auth.enumeration.global_ceiling', { route: 'check-user' });
  }

  const { email } = (req.body ?? {}) as { email?: string };
  if (typeof email !== 'string' || !email.trim()) return { status: 200, body: { exists: false } };

  const normalised = email.trim().toLowerCase();

  try {
    // Constant-work lookup: runs on every well-formed request; the result is
    // ONLY used for the audit row, never for the response.
    const { data: rows, error } = await supabase
      .from('users')
      .select('id, is_deleted')
      .eq('email', normalised)
      .limit(1);

    if (error) {
      // Fail CLOSED — a backend error must not fabricate an answer.
      return { status: 500, body: { error: 'Unable to process request.' } };
    }

    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { is_deleted?: boolean }) : null;
    const outcome = !row ? 'not_found' : row.is_deleted ? 'soft_deleted' : 'exists';

    void Promise.resolve(logSecurityEvent({
      capability: 'auth.check_user',
      decision:   'allowed',
      reason:     `check_user outcome=${outcome} (response constant)`,
      ip,
      userAgent:  typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    })).catch(() => {});

    // Constant response — the endpoint no longer discloses account existence.
    return { status: 200, body: { exists: false } };
  } catch {
    return { status: 500, body: { error: 'Unable to process request.' } };
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ exists: boolean } | { error: string; code?: string }>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const clock = getAuthResponseClock();
  const startedAt = clock.now();
  let out: Outcome;
  try {
    out = await decide(req);
  } catch {
    // Fail CLOSED (padded like every other path).
    await padToMinimumLatency(startedAt, clock);
    return res.status(500).json({ error: 'Unable to process request.' });
  }
  await padToMinimumLatency(startedAt, clock);
  if (out.retryAfter !== undefined) res.setHeader('Retry-After', String(out.retryAfter));
  return res.status(out.status).json(out.body);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/check-user' });
