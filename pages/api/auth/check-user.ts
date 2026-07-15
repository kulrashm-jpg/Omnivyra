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
 *   - Rate limited: 20 requests / 15 min / IP (Redis, shared limiter).
 *   - Constant response: always { exists: false } for well-formed input,
 *     regardless of whether the account exists — no discovery possible.
 *   - Constant work: exactly one indexed lookup on public.users runs on
 *     every well-formed request (result only feeds the audit log), so
 *     response timing does not depend on account existence. The previous
 *     second path (Supabase Auth admin REST fallback) is removed.
 *   - Fail CLOSED: unexpected errors return a generic 500 — never a
 *     fabricated positive result.
 *   - Audited: the real outcome is recorded via the existing security
 *     audit trail (capability_audit_log) for operator visibility.
 *
 * New code must not call this endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ exists: boolean } | { error: string }>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();
  const rl = await checkRateLimit(ip, { keyPrefix: 'rl:auth:check-user', limit: 20, windowSecs: 15 * 60 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const { email } = (req.body ?? {}) as { email?: string };
  if (!email?.trim()) return res.status(200).json({ exists: false });

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
      return res.status(500).json({ error: 'Unable to process request.' });
    }

    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { is_deleted?: boolean }) : null;
    const outcome = !row ? 'not_found' : row.is_deleted ? 'soft_deleted' : 'exists';

    void logSecurityEvent({
      capability: 'auth.check_user',
      decision:   'allowed',
      reason:     `check_user outcome=${outcome} (response constant)`,
      ip,
      userAgent:  typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });

    // Constant response — the endpoint no longer discloses account existence.
    return res.status(200).json({ exists: false });
  } catch {
    return res.status(500).json({ error: 'Unable to process request.' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/check-user' });
