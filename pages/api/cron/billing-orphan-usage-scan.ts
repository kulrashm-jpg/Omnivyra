import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/billing-orphan-usage-scan
 *
 * Detects LLM cost (usage_events) that has no matching credit CONFIRM —
 * i.e. real AI spend that wasn't billed. Phase 2 detector for audit risk G-1.
 *
 * Schedule: every hour recommended.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { runOrphanUsageReconciliation } from '../../../backend/services/billing/jobs/orphanUsageReconciliationJob';
import { runJob } from '../../../backend/services/jobRunner';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (req.cookies?.super_admin_session === '1') return true;
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

  const windowMin = numberFromQuery(req.query.windowMinutes) ?? 60;
  const limit     = numberFromQuery(req.query.limit) ?? 1000;

  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName:       'cron:billing-orphan-usage-scan',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:billing-orphan-usage-scan:${Math.floor(Date.now() / (60 * 60 * 1000))}`,
    },
    async () => runOrphanUsageReconciliation({ windowMinutes: windowMin, limit }),
  );

  if (outcome.status === 'completed') {
    return res.status(200).json({ ok: true, result: outcome.result, executionId: outcome.ctx.executionId });
  }
  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  }
  return res.status(500).json({ ok: false, error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status) });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/billing-orphan-usage-scan' });
