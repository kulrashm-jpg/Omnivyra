import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { jobQueue } from '../../../../backend/queue/jobQueue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, platforms, regions, keywords, mode: modeInput, context_mode, focused_modules, additional_direction } = req.body || {};

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

    const mode = modeInput === 'PREDICTIVE' ? 'PREDICTIVE' : 'REACTIVE';

    const platformList = Array.isArray(platforms)
      ? platforms.filter((p: unknown) => typeof p === 'string').map((p: string) => p.toLowerCase())
      : [];
    const regionList = Array.isArray(regions)
      ? regions.filter((r: unknown) => typeof r === 'string')
      : [];

    if (regionList.length > 15) {
      return res.status(400).json({ error: 'Maximum 15 regions allowed per execution.' });
    }

    if (platformList.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 platforms allowed per execution.' });
    }

    const regionListTrimmed = regionList.slice(0, 15);

    if (platformList.length === 0) {
      return res.status(400).json({ error: 'At least one platform is required' });
    }
    if (regionListTrimmed.length === 0) {
      return res.status(400).json({ error: 'At least one region is required' });
    }

    const keywordList = Array.isArray(keywords)
      ? keywords.filter((k: unknown) => typeof k === 'string')
      : [];

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dailyCount } = await supabase
      .from('lead_jobs_v1')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gt('created_at', twentyFourHoursAgo);

    if ((dailyCount ?? 0) > 20) {
      return res.status(429).json({
        error: 'Daily listening limit reached. Try again tomorrow.',
      });
    }

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('lead_jobs_v1')
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

    const contextPayload =
      context_mode != null || focused_modules != null || additional_direction != null
        ? {
            context_mode: context_mode ?? 'FULL',
            focused_modules: Array.isArray(focused_modules) ? focused_modules : undefined,
            additional_direction: typeof additional_direction === 'string' ? additional_direction : undefined,
          }
        : null;

    const { data: job, error: insertError } = await supabase
      .from('lead_jobs_v1')
      .insert({
        company_id: companyId,
        platforms: platformList,
        regions: regionListTrimmed,
        keywords: keywordList.length > 0 ? keywordList : null,
        mode,
        status: 'PENDING',
        total_found: 0,
        total_qualified: 0,
        context_payload: contextPayload,
      })
      .select('id, status')
      .single();

    if (insertError || !job) {
      return res.status(500).json({ error: 'Failed to create lead job' });
    }

    await jobQueue.add('lead-job', {
      type: 'LEAD',
      jobId: job.id,
    });

    return res.status(201).json({
      jobId: job.id,
      status: 'PENDING',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Internal server error' });
  }
}
