import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { getUnifiedCampaignBlueprint } from '../../../../backend/services/campaignBlueprintService';
import {
  generateCampaignRecommendations,
  fetchRecommendationWeeks,
} from '../../../../backend/services/campaignRecommendationExtensionService';

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
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  const companyId =
    (await getCompanyId(campaignId)) ??
    (typeof req.body?.companyId === 'string' ? req.body.companyId : null) ??
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

  if (req.method === 'GET') {
    try {
      const { sessionId, status } = req.query;
      let resolvedSessionId: string | undefined = typeof sessionId === 'string' ? sessionId : undefined;

      // Fetch committed plan for base week structure
      const blueprint = await getUnifiedCampaignBlueprint(campaignId);
      const rawWeeks = blueprint?.weeks ?? [];
      // Normalize week_number for consistent matching (handles string/number from JSON/DB)
      const committedWeeks = rawWeeks.map((w: any) => ({
        ...w,
        week_number: Number(w.week_number ?? w.week ?? 0),
      }));
      const { data: camp } = await supabase.from('campaigns').select('duration_weeks').eq('id', campaignId).maybeSingle();
      const resolved = (blueprint as any)?.duration_weeks ?? camp?.duration_weeks ?? committedWeeks.length;
      const durationWeeks = resolved && resolved > 0 ? resolved : 12;

      // Fetch recommendations — use latest session if none specified to avoid duplicate weeks
      let recs = await fetchRecommendationWeeks({
        campaignId,
        sessionId: resolvedSessionId,
        status: (status as 'pending' | 'agreed' | 'applied') || 'pending',
      });

      if (recs.length > 0 && !resolvedSessionId) {
        const latestSessionId = recs[recs.length - 1]?.session_id || recs[0]?.session_id;
        if (latestSessionId) {
          resolvedSessionId = latestSessionId;
          recs = await fetchRecommendationWeeks({
            campaignId,
            sessionId: resolvedSessionId,
            status: (status as 'pending' | 'agreed' | 'applied') || 'pending',
          });
        }
      }

      const recByWeek = new Map(recs.map((r: any) => [r.week_number, r]));

      return res.status(200).json({
        recommendations: recs,
        sessionId: resolvedSessionId ? resolvedSessionId : (recs[0]?.session_id ?? null),
        committedWeeks,
        durationWeeks: typeof durationWeeks === 'number' ? durationWeeks : 12,
        recByWeek: Object.fromEntries(recByWeek),
      });
    } catch (error: any) {
      console.error('Error fetching recommendations:', error);
      return res.status(500).json({ error: error?.message || 'Failed to fetch recommendations' });
    }
  }

  if (req.method === 'POST') {
    try {
      const result = await generateCampaignRecommendations({ campaignId, companyId });
      return res.status(200).json({
        sessionId: result.sessionId,
        weeks: result.weeks,
      });
    } catch (error: any) {
      console.error('Error generating recommendations:', error);
      return res.status(500).json({ error: error?.message || 'Failed to generate recommendations' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
