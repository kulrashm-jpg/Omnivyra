/**
 * GET/POST /api/cron/billing-idempotency-expire
 *
 * Scheduled expiry of stuck idempotency operations across all tracking
 * surfaces. Run every 5 minutes recommended.
 *
 * Auth: CRON_SECRET bearer OR super-admin session OR SUPER_ADMIN role.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { runIdempotencyExpiryJob } from '../../../backend/services/billing/idempotency/idempotencyExpiryJob';
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

  const dryRun = req.query.dryRun === 'true';
  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName:       'cron:billing-idempotency-expire',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:billing-idempotency-expire:${Math.floor(Date.now() / (5 * 60 * 1000))}`,
    },
    async () => runIdempotencyExpiryJob({ dryRun }),
  );

  if (outcome.status === 'completed') {
    return res.status(200).json({ ok: true, summary: outcome.result, executionId: outcome.ctx.executionId, dryRun });
  }
  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  }
  return res.status(500).json({ ok: false, error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status) });
}
