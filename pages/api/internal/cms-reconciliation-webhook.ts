import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { verifyWebhookSignature } from '../../../backend/services/webhookSecurityService';
import { recordInboundCmsEvent } from '../../../backend/services/intelligence/cmsReconciliationService';
import { isCmsProvider } from '../../../backend/services/cms/registry';
import type { CmsProvider } from '../../../backend/services/cms/types';

/**
 * ISOLATED CMS reconciliation webhook handoff (inbound only). Append-only
 * lineage; idempotent on `event_id`. Double-gated: RBAC + HMAC over the
 * canonical body using CMS_RECONCILIATION_WEBHOOK_SECRET.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  const secret = process.env.CMS_RECONCILIATION_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ status: 'not_configured', detail: 'CMS_RECONCILIATION_WEBHOOK_SECRET unset' });

  const signature = typeof req.body?.signature === 'string' ? req.body.signature : undefined;
  const body = JSON.stringify({
    company_id: companyId,
    provider: req.body?.provider,
    event_id: req.body?.event_id,
    event_type: req.body?.event_type,
    external_id: req.body?.external_id,
  });
  if (!verifyWebhookSignature(body, secret, signature)) {
    return res.status(401).json({ status: 'unauthorized', detail: 'invalid handoff signature' });
  }

  const provider = req.body?.provider as string | undefined;
  if (!provider || !isCmsProvider(provider)) {
    return res.status(400).json({ error: 'provider is required and must be a known CMS provider' });
  }
  const eventId = typeof req.body?.event_id === 'string' ? req.body.event_id : null;
  const eventType = typeof req.body?.event_type === 'string' ? req.body.event_type : null;
  if (!eventId || !eventType) return res.status(400).json({ error: 'event_id and event_type are required' });

  const result = await recordInboundCmsEvent({
    companyId,
    provider: provider as CmsProvider,
    eventId,
    eventType,
    externalId: typeof req.body?.external_id === 'string' ? req.body.external_id : null,
    detail: typeof req.body?.detail === 'object' && req.body.detail !== null ? req.body.detail : undefined,
  });
  const code = result.status === 'recorded' || result.status === 'deduped' ? 200 : 500;
  return res.status(code).json(result);
}
