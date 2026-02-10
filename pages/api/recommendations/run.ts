import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  parseRegions,
  executeRecommendationJob,
} from '../../../backend/services/recommendationExecutionService';
import { getExternalApiSourcesForUser } from '../../../backend/services/externalApiService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId,
      selected_api_ids,
      regions: regionsInput,
      keyword,
      goal,
      use_company_profile,
    } = req.body || {};

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

    const regions = parseRegions(regionsInput ?? 'GLOBAL');
    if (regions.length === 0) {
      return res.status(400).json({ error: 'At least one valid region or GLOBAL is required' });
    }

    const selectedIds = Array.isArray(selected_api_ids)
      ? selected_api_ids.filter((id: unknown) => typeof id === 'string')
      : [];
    const assignedSources = await getExternalApiSourcesForUser(
      companyId,
      access.userId ?? null,
      selectedIds.length > 0 ? selectedIds : undefined
    );
    const allowedApiIds = assignedSources.map((s) => s.id);
    const finalApiIds =
      selectedIds.length > 0 ? selectedIds.filter((id: string) => allowedApiIds.includes(id)) : allowedApiIds;

    if (finalApiIds.length === 0) {
      return res.status(400).json({
        error: 'No assigned external APIs for this company. Configure APIs in settings.',
      });
    }

    const { data: job, error: insertError } = await supabase
      .from('recommendation_jobs')
      .insert({
        company_id: companyId,
        created_by_user_id: access.userId ?? null,
        selected_api_ids: finalApiIds,
        regions,
        keyword: keyword ?? null,
        goal: goal ?? null,
        use_company_profile: use_company_profile !== false,
        status: 'QUEUED',
      })
      .select('id, status, created_at')
      .single();

    if (insertError || !job) {
      console.error('RECOMMENDATIONS_RUN_INSERT', insertError);
      return res.status(500).json({ error: 'Failed to create recommendation job' });
    }

    res.status(201).json({
      jobId: job.id,
      status: job.status,
      created_at: job.created_at,
    });

    executeRecommendationJob(job.id).catch((err) => {
      console.error('RECOMMENDATION_JOB_BACKGROUND_ERROR', { jobId: job.id, error: err });
    });
  } catch (err) {
    console.error('RECOMMENDATIONS_RUN_ERROR', err);
    res.status(500).json({ error: (err as Error).message || 'Internal server error' });
  }
}
