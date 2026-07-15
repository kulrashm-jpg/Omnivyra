import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { config } from '@/config';
import { ownedDbTable } from '../../../../../backend/db/writeOwner';
import { resolveCompanyAccess } from '../../../../../backend/services/contentArchitectService';
import { getMarketPulseRun, syncLegacyJobIntoRun } from '../../../../../backend/services/marketPulseV2Service';
import { processMarketPulseJobV1 } from '../../../../../backend/services/marketPulseJobProcessor';
import { isUuid } from '../../../../../lib/shared/uuid';

function shouldRecoverStaleMarketPulseInline(): boolean {
  if (!config.ENABLE_AUTO_WORKERS) return true;
  if (process.env.MARKET_PULSE_FORCE_QUEUE === '1') return false;
  const redisUrl = String(config.REDIS_URL ?? '');
  const appUrl = String(config.NEXT_PUBLIC_APP_URL ?? '');
  return (
    process.env.NODE_ENV !== 'production' ||
    /localhost|127\.0\.0\.1/i.test(redisUrl) ||
    /localhost|127\.0\.0\.1/i.test(appUrl)
  );
}

async function recoverLocalPendingJob(runId: string, companyId: string): Promise<void> {
  if (!shouldRecoverStaleMarketPulseInline()) return;

  const current = await getMarketPulseRun(runId, companyId);
  const legacyJobId = String(current.run?.context_snapshot?.legacy_job_id ?? '').trim();
  if (!legacyJobId) return;

  const { data: legacyJob } = await ownedDbTable('market_pulse_jobs_v1')
    .select('id, status, created_at')
    .eq('id', legacyJobId)
    .single();

  if (!legacyJob || String(legacyJob.status ?? '').toUpperCase() !== 'PENDING') return;

  const createdAt = new Date(String(legacyJob.created_at ?? '')).getTime();
  const staleEnough = Number.isFinite(createdAt) && Date.now() - createdAt > 20_000;
  if (!staleEnough) return;

  await processMarketPulseJobV1(legacyJobId);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const runId = typeof req.query.id === 'string' ? req.query.id : '';
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
    if (!runId || !companyId) {
      return res.status(400).json({ error: 'run id and companyId are required' });
    }
    if (!isUuid(runId)) {
      return res.status(400).json({ error: 'Invalid Market Pulse run id' });
    }

    const access = await resolveCompanyAccess(req, res, companyId);
    if (!access) return;

    const { data: runLookup, error: runLookupError } = await ownedDbTable('market_pulse_runs')
      .select('id, company_id')
      .eq('id', runId)
      .maybeSingle();

    if (runLookupError) {
      throw new Error(runLookupError.message || 'Failed to verify Market Pulse run');
    }
    if (!runLookup) {
      return res.status(404).json({ error: 'Market Pulse run not found', runId });
    }
    if (runLookup.company_id !== companyId) {
      return res.status(409).json({
        error: 'Market Pulse run belongs to a different company context',
        runId,
        requestedCompanyId: companyId,
      });
    }

    await recoverLocalPendingJob(runId, companyId);
    const synced = await syncLegacyJobIntoRun(runId, companyId);
    return res.status(200).json(synced);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to load Market Pulse run' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/market-pulse/runs/:id' });
