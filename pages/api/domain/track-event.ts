import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/domain/track-event
 *
 * Lightweight client-side event sink for the domain-verification onboarding
 * UI. Maps an allow-listed UI event name to a domain_events row so analytics
 * dashboards can compute funnel metrics (view -> click -> success/fail).
 *
 * Auth: Supabase session required (we want events tied to a real user).
 * Rate limit: 30/min/IP — covers a noisy user without being so tight that
 * legitimate retry/back-tap behavior triggers it.
 *
 * Allow-listed events (rejected otherwise):
 *   - VIEW_DOMAIN_VERIFICATION
 *   - CLICK_VERIFY
 *   - VERIFICATION_SUCCESS    (UI-side mirror of the server event; treat as
 *                              telemetry, not authoritative success)
 *   - VERIFICATION_FAILED
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import { logDomainEvent } from '../../../backend/services/domainEventLogger';
import { logger } from '../../../backend/services/logger';

const REMINDER_DELAY_MS = 10 * 60 * 1000;

const TRACK_RATE_LIMIT = {
  keyPrefix: 'rl:domain_track',
  limit: 30,
  windowSecs: 60,
};

const ALLOWED_EVENTS = new Set([
  'VIEW_DOMAIN_VERIFICATION',
  'CLICK_VERIFY',
  'VERIFICATION_SUCCESS',
  'VERIFICATION_FAILED',
  'DOMAIN_VERIFICATION_SKIPPED',
  'DOMAIN_TOKEN_REGENERATED',
]);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const ip = String(
    req.headers['x-forwarded-for']
    ?? (req.socket as any)?.remoteAddress
    ?? 'unknown',
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, TRACK_RATE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'RATE_LIMITED' });

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  const supabaseUid: string = authResult.user.supabaseUid;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const event = String(body?.event ?? '').trim();
  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ error: 'INVALID_EVENT' });
  }

  // Resolve internal user id (best-effort; unauthenticated-like fallthrough
  // to NULL is acceptable since auth was just verified).
  const { data: userRow } = await supabase
    .from('users')
    .select('id, active_company_id')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();
  const userId        = (userRow as any)?.id ?? null;
  const companyId     = (userRow as any)?.active_company_id ?? body?.company_id ?? null;
  const final_domain  = body?.final_domain ? String(body.final_domain) : null;
  const metadata      = body?.metadata && typeof body.metadata === 'object' ? body.metadata : null;

  // event_type column accepts any TEXT; we type-narrow at the table read side.
  void logDomainEvent({
    event_type:   event as any,
    company_id:   companyId,
    final_domain,
    user_id:      userId,
    metadata,
  });

  // Reminder schedule: when a user skips verification, INSERT a durable row
  // into domain_reminders. The /api/internal/process-reminders cron (every
  // 5 min) drains due rows, skips already-verified domains, and sends the
  // email. No setTimeout, no in-process state — survives process recycles.
  if (event === 'DOMAIN_VERIFICATION_SKIPPED' && final_domain) {
    try {
      const scheduledAt = new Date(Date.now() + REMINDER_DELAY_MS).toISOString();
      const { error } = await supabase.from('domain_reminders').insert({
        user_id:       userId,
        company_id:    companyId,
        final_domain,
        reminder_type: 'domain_verification',
        scheduled_at:  scheduledAt,
      });
      if (error) {
        logger.warn('domain_verification_reminder_insert_failed', {
          user_id: userId,
          message: error.message,
        });
      } else {
        logger.info('domain_verification_skip_reminder_scheduled', {
          user_id:    userId,
          company_id: companyId,
          final_domain,
          due_at_iso: scheduledAt,
        });
      }
    } catch (err) {
      logger.warn('domain_verification_reminder_insert_threw', {
        user_id: userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.status(202).json({ ok: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/domain/track-event' });
