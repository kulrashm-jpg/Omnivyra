import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import * as camp from '../../../backend/services/campaign/campaignService';
import * as ops from '../../../backend/services/operations/operationalCoreService';

/**
 * /api/lead-intelligence/campaigns — THE canonical Campaign API (LC-401 / W4).
 * One read model, one mutation model, one permission model. Campaigns REFERENCE
 * audiences (no recipient copy); operational mutations reuse /operations with
 * entity_type='gtm_campaign'. Recommend + simulate only — no execution.
 *
 * GET  ?company_id&list=1                       → campaigns
 * GET  ?company_id&messages=1[&channel=]        → reusable messaging assets
 * GET  ?company_id&campaign_id=..               → campaign + intelligence + operational overlay
 * POST { action: create|update|delete|recommend|preview_strategy|simulate|intelligence|create_message }
 */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String((req.method === 'GET' ? req.query.company_id : req.body?.company_id) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const actorId = user.userId;

  try {
    if (req.method === 'GET') {
      if (str(req.query.messages)) return res.status(200).json({ messages: await camp.listMessages(companyId, str(req.query.channel)) });
      const campaignId = str(req.query.campaign_id);
      if (str(req.query.list) || !campaignId) return res.status(200).json({ campaigns: await camp.listCampaigns(companyId) });
      const [campaign, intelligence, overlay] = await Promise.all([
        camp.getCampaign(companyId, campaignId),
        camp.getCampaignIntelligence(companyId, campaignId).catch(() => null),
        ops.getOperationalOverlay({ companyId, entityType: 'gtm_campaign', entityId: campaignId }),
      ]);
      if (!campaign) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ campaign, intelligence, operational: overlay });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      switch (str(b.action)) {
        case 'create':           return res.status(201).json(await camp.createCampaign(companyId, actorId, { name: String(b.name), description: str(b.description), objective: str(b.objective), audienceId: b.audience_id ?? null, channels: b.channels, kpis: b.kpis, schedule: b.schedule, metadata: b.metadata }));
        case 'update':           { await camp.updateCampaign(companyId, String(b.campaign_id), { name: str(b.name), description: str(b.description), objective: str(b.objective), status: str(b.status), audienceId: b.audience_id, channels: b.channels, kpis: b.kpis, schedule: b.schedule, metadata: b.metadata }); return res.status(200).json({ ok: true }); }
        case 'delete':           { await camp.deleteCampaign(companyId, String(b.campaign_id)); return res.status(200).json({ ok: true }); }
        case 'recommend':        return res.status(200).json(await camp.recommendCampaign(companyId, String(b.campaign_id)));
        case 'preview_strategy': return res.status(200).json(await camp.previewStrategy(companyId, String(b.audience_id), b.channels));
        case 'simulate':         return res.status(200).json(await camp.simulateCampaign(companyId, String(b.campaign_id)));
        case 'intelligence':     return res.status(200).json(await camp.getCampaignIntelligence(companyId, String(b.campaign_id)));
        case 'create_message':   return res.status(201).json(await camp.createMessage(companyId, actorId, { name: String(b.name), channel: String(b.channel), subject: str(b.subject), body: String(b.body), buyingStage: str(b.buying_stage), audienceFit: b.audience_fit, notes: str(b.notes) }));
        default: return res.status(400).json({ error: 'unknown_action' });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof camp.CampaignError) return res.status(err.httpStatus).json({ error: err.code });
    if (err instanceof ops.OperationalError) return res.status(err.httpStatus).json({ error: err.code });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'campaign_operation_failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/lead-intelligence/campaigns' });
