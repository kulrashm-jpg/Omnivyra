/**
 * GET/POST /api/cron/subscription-credit-expiry
 *
 * Daily sweep that expires SUBSCRIPTION-issued FREE credits for terminated subscriptions
 * (EXPIRED/CANCELED), capped at the subscription-allocated amount so signup credits are not
 * early-expired. Delegates to subscriptionCreditExpiryService.runSubscriptionCreditExpirySweep.
 * Idempotent per org per day; paid + incentive structurally preserved (DB-enforced). Run AFTER
 * subscription-status-expiry. Cron-only wiring.
 *
 * Auth: CRON_SECRET bearer OR super-admin session OR SUPER_ADMIN role.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { runSubscriptionCreditExpirySweep } from '../../../backend/services/subscriptionCreditExpiryService';
import { runJob } from '../../../backend/services/jobRunner';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const triggeredByCronSecret = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const dayWindow = Math.floor(Date.now() / (24 * 60 * 60 * 1000));

  const outcome = await runJob(
    {
      jobName: 'cron:subscription-credit-expiry',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId: null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:subscription-credit-expiry:${dayWindow}`,
    },
    async () => runSubscriptionCreditExpirySweep(),
  );

  if (outcome.status === 'completed') return res.status(200).json({ ok: true, summary: outcome.result, executionId: outcome.ctx.executionId });
  if (outcome.status === 'dead_letter_skip') return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  return res.status(500).json({ ok: false, error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status) });
}
