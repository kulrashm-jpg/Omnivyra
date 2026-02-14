import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { processRecommendationJobV2 } from '../../../../backend/services/recommendationJobProcessor';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, selectedPillars, strategicPayload, regions } = req.body || {};

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

    const pillarIds = Array.isArray(selectedPillars)
      ? selectedPillars.filter((id: unknown) => typeof id === 'string')
      : [];
    const regionList = Array.isArray(regions)
      ? regions.filter((r: unknown) => typeof r === 'string')
      : [];

    if (regionList.length > 15) {
      return res.status(400).json({
        error: 'Maximum 15 regions allowed per execution.',
      });
    }

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('recommendation_jobs_v2')
      .select('id, status')
      .eq('company_id', companyId)
      .in('status', ['PENDING', 'RUNNING'])
      .gt('created_at', twoMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        jobId: existing.id,
        status: existing.status,
        reused: true,
      });
    }

    const { data: job, error: insertError } = await supabase
      .from('recommendation_jobs_v2')
      .insert({
        company_id: companyId,
        status: 'PENDING',
        strategic_payload: strategicPayload ?? null,
        selected_pillars: pillarIds,
        regions: regionList,
        region_results: {},
        consolidated_result: null,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .select('id, status, created_at')
      .single();

    if (insertError || !job) {
      return res.status(500).json({ error: 'Failed to create recommendation job' });
    }

    res.status(201).json({
      jobId: job.id,
      status: job.status,
      created_at: job.created_at,
    });

    processRecommendationJobV2(job.id).catch(() => {
      // Logged inside processor; do not block response
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Internal server error' });
  }
}
