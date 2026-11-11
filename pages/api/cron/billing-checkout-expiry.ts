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
 * Auth: CRON_SECRET bearer, OR BILLING_PLATFORM_MANAGE + platform authority + step-up (manual trigger).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { expireStalePendingPurchases } from '../../../backend/services/billing/purchaseClosureService';
import { runJob } from '../../../backend/services/jobRunner';
import { logger } from '../../../backend/services/logger';
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';
import { requireCapability } from '../../../backend/security/requireCapability';
import { BILLING_PLATFORM_MANAGE } from '../../../shared/contracts/security';

/**
 * Scheduler: the CRON_SECRET bearer. A person triggering it manually: the
 * BILLING_PLATFORM_MANAGE capability on a platform SUPER_ADMIN principal, with step-up
 * (requireCapability writes the 401/403 itself). 2026-11-11: the legacy
 * super-admin cookie and the bare platform-role check
 * (no step-up) are gone.
 */
async function authorize(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && bearerTokenMatches(req.headers.authorization, cronSecret)) return true;
  const guard = await requireCapability(req, res, {
    capability: BILLING_PLATFORM_MANAGE,
    reason: 'manual trigger cron:billing-checkout-expiry',
    requirePlatformAuthority: true,
    requireStepUp: true,
  });
  return guard.ok === true;
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
  if (!(await authorize(req, res))) return;

  const ttl = numberFromQuery(req.query.ttlMinutes);
  const scanLimit = numberFromQuery(req.query.scanLimit);

  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);

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
