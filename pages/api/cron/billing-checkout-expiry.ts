import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/billing-checkout-expiry
 *
 * B3 (P1) — close top-up purchases that have sat `pending` past the checkout
 * TTL, so an abandoned checkout cannot stay pending forever.
 *
 * This is NOT "expire anything old". Every candidate is checked against the
 * provider first (`expireStalePendingPurchases` → `resolveProviderOrderOutcome`):
 *
 *   provider paid       → FULFILLED, not expired (this is also the recovery
 *                         path for "customer paid, then closed the browser,
 *                         and no webhook arrived")
 *   provider unpaid     → closed, marked reopenable
 *   provider unreachable→ left pending, retried next sweep
 *
 * Runs AFTER the reconcile sweep in the same 15-minute slot so that anything
 * already recoverable from local state is repaired before the clock is applied.
 *
 * TTL: PAYMENT_CHECKOUT_TTL_MINUTES (default 30). Overridable per-call via
 * ?ttlMinutes= for controlled testing.
 *
 * Auth: CRON_SECRET bearer OR super_admin_session cookie OR SUPER_ADMIN role.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { expireStalePendingPurchases } from '../../../backend/services/billing/purchaseClosureService';
import { runJob } from '../../../backend/services/jobRunner';
import { getLegacySuperAdminSession } from '@/backend/services/superAdminSession';
import { logger } from '../../../backend/services/logger';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  return false;
}

function numberFromQuery(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const ttl = numberFromQuery(req.query.ttlMinutes);
  const scanLimit = numberFromQuery(req.query.scanLimit);

  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName:       'cron:billing-checkout-expiry',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:billing-checkout-expiry:${Math.floor(Date.now() / (15 * 60 * 1000))}`,
    },
    async () => expireStalePendingPurchases({ ttlMinutes: ttl, scanLimit }),
  );

  if (outcome.status === 'completed') {
    const result = outcome.result as { scanned: number; closed: number; fulfilled: number; deferred: number };
    // A stale-pending purchase the provider reports as PAID is the exact
    // "charged, browser gone, no webhook" case — loud on purpose.
    if (result.fulfilled > 0) {
      logger.warn('payment_recovered_from_stale_pending', {
        fulfilled: result.fulfilled, scanned: result.scanned,
      });
    }
    if (result.deferred > 0) {
      logger.warn('payment_close_deferred_batch', { deferred: result.deferred, scanned: result.scanned });
    }
    return res.status(200).json({ ok: true, result, executionId: outcome.ctx.executionId });
  }
  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  }
  logger.error('payment_pending_expiry_failed', {
    status: outcome.status,
    message: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status),
  });
  return res.status(500).json({
    ok: false,
    error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status),
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/billing-checkout-expiry' });
