import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/subscription-status-expiry
 *
 * Daily sweep that transitions lapsed subscriptions (period + grace passed, no renewal) to
 * status='expired' via billingSubscriptionService.markExpiredSubscriptions. This is what makes the
 * paid lock + subscription-credit expiry fire without a webhook. Idempotent (only flips active/
 * trialing/past_due rows that are genuinely past grace). Cron-only wiring.
 *
 * Auth: CRON_SECRET bearer OR super-admin session OR SUPER_ADMIN role.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { markExpiredSubscriptions } from '../../../backend/services/billingSubscriptionService';
import { runJob } from '../../../backend/services/jobRunner';
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
    reason: 'manual trigger cron:subscription-status-expiry',
    requirePlatformAuthority: true,
    requireStepUp: true,
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await authorize(req, res))) return;

  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);
  const dayWindow = Math.floor(Date.now() / (24 * 60 * 60 * 1000));

  const outcome = await runJob(
    {
      jobName: 'cron:subscription-status-expiry',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId: null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:subscription-status-expiry:${dayWindow}`,
    },
    async () => markExpiredSubscriptions({ db: supabase as any }),
  );

  if (outcome.status === 'completed') return res.status(200).json({ ok: true, summary: outcome.result, executionId: outcome.ctx.executionId });
  if (outcome.status === 'dead_letter_skip') return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  return res.status(500).json({ ok: false, error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status) });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/subscription-status-expiry' });
