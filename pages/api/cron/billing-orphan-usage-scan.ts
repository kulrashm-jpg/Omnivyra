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
import { runOrphanUsageReconciliation } from '../../../backend/services/billing/jobs/orphanUsageReconciliationJob';
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
    reason: 'manual trigger cron:billing-orphan-usage-scan',
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

  const windowMin = numberFromQuery(req.query.windowMinutes) ?? 60;
  const limit     = numberFromQuery(req.query.limit) ?? 1000;

  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);

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
