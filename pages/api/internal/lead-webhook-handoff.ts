import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { verifyWebhookSignature } from '../../../backend/services/webhookSecurityService';
import { verifyAttributionToken } from '../../../backend/services/intelligence/crossDomainAttributionService';
import { recordEmbeddedFormHandoff } from '../../../backend/services/intelligence/embeddedFormIntegrationService';
import { recordComplianceAudit } from '../../../backend/services/audit/complianceAuditService';

/**
 * ISOLATED lead-webhook handoff (lineage-only). NEVER writes leads; that
 * remains owned by the hardened public `/api/leads` route. This endpoint
 * records the attribution↔conversion linkage append-only so a webhook-only
 * lead provider can reconcile back into attribution lineage WITHOUT
 * refactoring the public ingestion path. Double-gated: RBAC + internal HMAC
 * (LEAD_WEBHOOK_HANDOFF_SECRET).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  const secret = process.env.LEAD_WEBHOOK_HANDOFF_SECRET;
  if (!secret) {
    return res.status(503).json({ status: 'not_configured', detail: 'LEAD_WEBHOOK_HANDOFF_SECRET unset' });
  }
  const signature = typeof req.body?.signature === 'string' ? req.body.signature : undefined;
  const body = JSON.stringify({
    company_id: companyId,
    provider: req.body?.provider,
    form_external_id: req.body?.form_external_id,
    conversion_id: req.body?.conversion_id,
    attribution_token: req.body?.attribution_token,
  });
  if (!verifyWebhookSignature(body, secret, signature)) {
    return res.status(401).json({ status: 'unauthorized', detail: 'invalid handoff signature' });
  }

  const token = typeof req.body?.attribution_token === 'string' ? req.body.attribution_token : null;
  let attrNonce: string | undefined;
  if (token) {
    const v = await verifyAttributionToken({ companyId, token });
    if (v.state === 'verified' || v.state === 'replayed') attrNonce = v.payload?.n;
    if (v.state === 'tampered' || v.state === 'company_mismatch') {
      return res.status(400).json({ status: v.state, detail: v.detail });
    }
  }

  await recordEmbeddedFormHandoff({
    companyId,
    provider: (req.body?.provider ?? 'generic') as any,
    formExternalId: String(req.body?.form_external_id ?? 'unknown'),
    attributionNonce: attrNonce,
    conversionId: typeof req.body?.conversion_id === 'string' ? req.body.conversion_id : undefined,
    detail: { source: 'webhook_handoff' },
  });

  await recordComplianceAudit({
    companyId,
    actor: { userId: roleGate.userId, type: 'user', label: 'lead-webhook-handoff' },
    action: 'lead_webhook_handoff.recorded',
    resourceType: 'lead_webhook_handoff',
    resourceId: String(req.body?.conversion_id ?? attrNonce ?? Date.now()),
    severity: 'info',
    entityLineage: ['company', 'lead_webhook_handoff'],
    detail: { provider: req.body?.provider ?? null, attrNonce: attrNonce ?? null },
  }).catch(() => undefined);

  return res.status(200).json({ status: 'recorded', attrNonce: attrNonce ?? null });
}
