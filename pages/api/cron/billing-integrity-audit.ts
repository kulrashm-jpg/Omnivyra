import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/billing-integrity-audit
 *
 * Daily composite integrity check covering wallet drift, reservation
 * mismatches, usage orphans, stale approvals, and stuck fulfillments.
 * Feeds the Financial Integrity Dashboard and alerts on anomalies.
 *
 * Schedule: daily at 02:00 UTC recommended.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { runFinancialIntegrityAudit } from '../../../backend/services/billing/jobs/financialIntegrityAuditJob';
import { runJob } from '../../../backend/services/jobRunner';
import { getLegacySuperAdminSession } from '@/backend/services/superAdminSession';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  return false;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName:       'cron:billing-integrity-audit',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:billing-integrity-audit:${new Date().toISOString().slice(0, 10)}`,
    },
    async () => runFinancialIntegrityAudit(),
  );

  if (outcome.status === 'completed') {
    return res.status(200).json({ ok: true, report: outcome.result, executionId: outcome.ctx.executionId });
  }
  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  }
  return res.status(500).json({ ok: false, error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status) });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/billing-integrity-audit' });
