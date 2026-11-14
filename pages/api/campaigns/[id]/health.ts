import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/campaigns/[id]/health
 * Returns persisted report_json only. No fallback reconstruction.
 * If older than 24h (evaluated_at), triggers background refresh.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ownerCompanyOfRow, tenantTable, tenantContextFor, TenantSeamError, type TenantContext } from '../../../../backend/db/tenantTable';
import { seamDenial } from '../../../../backend/db/seamDenial';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { evaluateAndPersistCampaignHealth } from '../../../../backend/jobs/campaignHealthEvaluationJob';

const HEALTH_TTL_MS = 24 * 60 * 60 * 1000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    // S2 derive-then-authorize (e9 ruling, as campaigns/[id]/source-recommendation): ownerCompanyOfRow answers ONLY
    // which company owns the campaign (campaigns.company_id, NOT NULL since 20270217000025), no longer "any
    // campaign_versions row" (an unordered .limit(1) read). SOURCE-OF-TRUTH MOVE: versions -> campaigns; C36: 0
    // mismatches in prod. The ?companyId= fallback for a campaign with no owner is unchanged, and the access check
    // still binds the campaign to whichever company it authorizes (checkCampaignOwnership).
    const ownerCompanyId = await ownerCompanyOfRow('campaigns', campaignId, 'campaign health: owner of the campaign');
    const queryCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    const companyId = ownerCompanyId ?? queryCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'Campaign must be linked to a company' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: ownerCompanyId ?? queryCompanyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!access) return;

    // S2 tenant seam: the tenant is the company enforceCompanyAccess just authorized for access.userId. A company
    // that cannot form a context gets the route's existing no-report 404.
    let tenant: TenantContext;
    try {
      tenant = tenantContextFor(access, companyId);
    } catch (err) {
      if (err instanceof TenantSeamError) {
        return seamDenial(res, err, 404, {
          error: 'No health report',
          message: 'No persisted report_json. Save or update the campaign plan to generate one.',
        });
      }
      throw err;
    }

    const { data: row, error } = await tenantTable('campaign_health_reports', tenant)
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/health' });
