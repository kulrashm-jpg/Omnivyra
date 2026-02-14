import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { jobQueue } from '../../../../backend/queue/jobQueue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, regions, context_mode, focused_modules, additional_direction } = req.body || {};

    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const regionList = Array.isArray(regions)
      ? regions.filter((r: unknown) => typeof r === 'string').slice(0, 15)
      : [];
    const regionsNormalized = regionList.length > 0 ? [...regionList].sort() : ['GLOBAL'];

    if (regionList.length > 15) {
      return res.status(400).json({ error: 'Maximum 15 regions allowed per execution.' });
    }

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: candidates } = await supabase
      .from('market_pulse_jobs_v1')
      .select('id, status, regions')
      .eq('company_id', companyId)
      .in('status', ['PENDING', 'RUNNING'])
      .gt('created_at', twoMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(5);

    const existing = (candidates ?? []).find((c) => {
      const cRegions = Array.isArray(c.regions) ? [...(c.regions as string[])].sort() : ['GLOBAL'];
      return (
        cRegions.length === regionsNormalized.length &&
        cRegions.every((r, i) => r === regionsNormalized[i])
      );
    });

    if (existing) {
      return res.status(200).json({
        jobId: existing.id,
        status: existing.status,
        reused: true,
      });
    }

    const contextPayload =
      context_mode != null || focused_modules != null || additional_direction != null
        ? {
            context_mode: context_mode ?? 'FULL',
            focused_modules: Array.isArray(focused_modules) ? focused_modules : undefined,
            additional_direction: typeof additional_direction === 'string' ? additional_direction : undefined,
          }
        : null;

    const { data: job, error: insertError } = await supabase
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

    if (insertError || !job) {
      return res.status(500).json({ error: 'Failed to create market pulse job' });
    }

    await jobQueue.add('market-pulse-job', {
      type: 'MARKET_PULSE',
      jobId: job.id,
    });

    return res.status(201).json({
      jobId: job.id,
      status: job.status,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Internal server error' });
  }
}
