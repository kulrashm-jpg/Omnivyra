import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { hasUsageAccess } from '../../../backend/services/usageAccessService';

const requireAuth = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ userId: string | null; isSuperAdmin: boolean } | null> => {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    return { userId: null, isSuperAdmin: true };
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    return { userId: user.id, isSuperAdmin: isAdmin };
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return null;
};

function maskCostInTotals(totals: Record<string, unknown>): Record<string, unknown> {
  const out = { ...totals };
  delete out.total_cost;
  return out;
}

function maskCostInProviderModel(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  delete out.total_cost;
  return out;
}

function maskCostInProcess(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  delete out.total_cost;
  return out;
}

function maskCostInCampaign(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  delete out.total_cost;
  return out;
}

function maskCostInEvent(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  delete out.unit_cost;
  delete out.total_cost;
  delete out.pricing_snapshot;
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const organizationId = req.query.organization_id as string | undefined;
  if (!organizationId) {
    return res.status(400).json({ error: 'organization_id is required' });
  }

  if (!auth.isSuperAdmin && auth.userId) {
    const allowed = await hasUsageAccess(auth.userId, organizationId, false);
    if (!allowed) {
      return res.status(403).json({ error: 'FORBIDDEN_NO_USAGE_ACCESS' });
    }
  }

  const campaignId = (req.query.campaign_id as string) || null;
  const processType = (req.query.process_type as string) || null;
  const sourceType = (req.query.source_type as string) || null;
  const providerName = (req.query.provider_name as string) || null;
  const modelName = (req.query.model_name as string) || null;
  const startDate = (req.query.start_date as string) || null;
  const endDate = (req.query.end_date as string) || null;
  const detail = req.query.detail === 'true' || req.query.detail === '1';

  try {
    const { data: raw, error } = await supabase.rpc('get_usage_report', {
      p_organization_id: organizationId,
      p_campaign_id: campaignId,
      p_process_type: processType,
      p_source_type: sourceType,
      p_provider_name: providerName,
      p_model_name: modelName,
      p_start_date: startDate ? new Date(startDate).toISOString() : null,
      p_end_date: endDate ? new Date(endDate).toISOString() : null,
      p_include_detail: detail,
    });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const payload = (raw ?? {}) as {
      totals?: Record<string, unknown>;
      by_provider_model?: Record<string, unknown>[];
      by_process?: Record<string, unknown>[];
      by_campaign?: Record<string, unknown>[];
      recent_events?: Record<string, unknown>[];
    };

    const totalsRaw = payload.totals ?? {};
    const byProviderModel = Array.isArray(payload.by_provider_model) ? payload.by_provider_model : [];
    const byProcess = Array.isArray(payload.by_process) ? payload.by_process : [];
    const byCampaign = Array.isArray(payload.by_campaign) ? payload.by_campaign : [];
    const recentEvents = Array.isArray(payload.recent_events) ? payload.recent_events : [];

    const totals = auth.isSuperAdmin ? totalsRaw : maskCostInTotals(totalsRaw as Record<string, unknown>);
    const byProviderModelOut = auth.isSuperAdmin ? byProviderModel : byProviderModel.map((r) => maskCostInProviderModel(r as Record<string, unknown>));
    const byProcessOut = auth.isSuperAdmin ? byProcess : byProcess.map((r) => maskCostInProcess(r as Record<string, unknown>));
    const byCampaignOut = auth.isSuperAdmin ? byCampaign : byCampaign.map((r) => maskCostInCampaign(r as Record<string, unknown>));
    const recentEventsOut = auth.isSuperAdmin ? recentEvents : recentEvents.map((r) => maskCostInEvent(r as Record<string, unknown>));

    const response: Record<string, unknown> = {
      success: true,
      scope: {
        organization_id: organizationId,
        campaign_id: campaignId || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
      totals,
      by_provider_model: byProviderModelOut,
      by_process: byProcessOut,
      by_campaign: byCampaignOut,
    };
    if (detail) {
      response.recent_events = recentEventsOut;
    }

    return res.status(200).json(response);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
