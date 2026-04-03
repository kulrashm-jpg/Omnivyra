
/**
 * GET /api/campaigns/[id]/health
 * Returns persisted report_json only. No fallback reconstruction.
 * If older than 24h (evaluated_at), triggers background refresh.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { evaluateAndPersistCampaignHealth } from '../../../../backend/jobs/campaignHealthEvaluationJob';

const HEALTH_TTL_MS = 24 * 60 * 60 * 1000;

async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data: ver } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (ver?.company_id) return ver.company_id as string;
  const { data: camp } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  return camp?.company_id ? (camp.company_id as string) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  try {
    const companyId =
      (await getCompanyId(campaignId)) ??
      (typeof req.query.companyId === 'string' ? req.query.companyId : null);
    if (!companyId) {
      return res.status(400).json({ error: 'Campaign must be linked to a company' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!access) return;

    const { data: row, error } = await supabase
      .from('campaign_health_reports')
      .select('report_json, evaluated_at, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[campaigns/health]', error);
      return res.status(500).json({ error: 'Failed to fetch campaign health' });
    }

    const evalAt = row?.evaluated_at ?? row?.created_at;
    const isStale = evalAt && (Date.now() - new Date(evalAt as string).getTime() > HEALTH_TTL_MS);
    if (isStale && companyId) {
      evaluateAndPersistCampaignHealth(campaignId, companyId).catch((e) =>
        console.warn('[campaigns/health] TTL refresh failed:', e)
      );
    }

    const reportJson = row?.report_json as Record<string, unknown> | null | undefined;
    if (!reportJson || typeof reportJson !== 'object') {
      return res.status(404).json({
        error: 'No health report',
        message: 'No persisted report_json. Save or update the campaign plan to generate one.',
      });
    }

    return res.status(200).json(reportJson);
  } catch (err) {
    console.error('[campaigns/health]', err);
    return res.status(500).json({
      error: 'Failed to fetch campaign health',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
