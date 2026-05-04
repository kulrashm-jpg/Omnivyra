import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { config } from '@/config';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { jobQueue } from '../../../backend/queue/jobQueue';
import {
  createMarketPulseRun,
  resolveMarketPulseRunInput,
  syncLegacyJobIntoRun,
  type MarketPulseRunInput,
} from '../../../backend/services/marketPulseV2Service';
import { processMarketPulseJobV1 } from '../../../backend/services/marketPulseJobProcessor';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const companyId = typeof body.companyId === 'string' ? body.companyId : '';
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const access = await resolveCompanyAccess(req, res, companyId);
    if (!access) return;

    const input: MarketPulseRunInput = {
      mode: body.mode === 'automated' ? 'automated' : 'one_time',
      objective: (typeof body.objective === 'string' ? body.objective : 'growth') as MarketPulseRunInput['objective'],
      categories: Array.isArray(body.categories) ? body.categories.map((item) => String(item)).filter(Boolean) : [],
      region_scope: (typeof body.region_scope === 'string' ? body.region_scope : 'profile_markets') as MarketPulseRunInput['region_scope'],
      custom_regions: Array.isArray(body.custom_regions) ? body.custom_regions.map((item) => String(item)).filter(Boolean) : [],
      competitor_scope: (typeof body.competitor_scope === 'string' ? body.competitor_scope : 'combined') as MarketPulseRunInput['competitor_scope'],
      source_strategy: body.source_strategy === 'ai' || body.source_strategy === 'api' ? body.source_strategy : 'hybrid',
      custom_direction: typeof body.custom_direction === 'string' ? body.custom_direction : null,
      delivery_mode: body.delivery_mode === 'daily_digest' ? 'daily_digest' : 'page_only',
      credit_acknowledged: Boolean(body.credit_acknowledged),
    };

    if (input.mode === 'automated' && !input.credit_acknowledged) {
      return res.status(400).json({ error: 'Credit acknowledgement is required for automated monitoring' });
    }

    const { resolvedInput } = await resolveMarketPulseRunInput(companyId, input);

    const regionsNormalized =
      resolvedInput.custom_regions && resolvedInput.custom_regions.length > 0
        ? [...resolvedInput.custom_regions]
        : ['GLOBAL'];
    const contextPayload = {
      context_mode: 'FULL',
      additional_direction: resolvedInput.custom_direction ?? undefined,
      insight_source: resolvedInput.source_strategy ?? 'hybrid',
      selected_categories: resolvedInput.categories,
      objective: resolvedInput.objective,
      competitor_scope: resolvedInput.competitor_scope,
    };

    const { data: legacyJob, error: insertError } = await supabase
      .from('market_pulse_jobs_v1')
      .insert({
        company_id: companyId,
        regions: regionsNormalized,
        status: 'PENDING',
        confidence_index: 0,
        region_results: {},
        consolidated_result: null,
        error: null,
        context_payload: contextPayload,
      })
      .select('id, status')
      .single();

    if (insertError || !legacyJob) {
      return res.status(500).json({ error: insertError?.message || 'Failed to create legacy Market Pulse job' });
    }

    const run = await createMarketPulseRun(companyId, resolvedInput, legacyJob.id);
    const workersDisabled = !config.ENABLE_AUTO_WORKERS;

    if (workersDisabled) {
      await processMarketPulseJobV1(legacyJob.id);
      const syncedRun = await syncLegacyJobIntoRun(run.id, companyId);
      return res.status(201).json({
        runId: run.id,
        status: syncedRun.run.status,
        legacyJobId: legacyJob.id,
        workersDisabled: true,
      });
    }

    await jobQueue.add('market-pulse-job', {
      type: 'MARKET_PULSE',
      jobId: legacyJob.id,
    });

    return res.status(201).json({ runId: run.id, status: run.status, legacyJobId: legacyJob.id });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to start Market Pulse run' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

