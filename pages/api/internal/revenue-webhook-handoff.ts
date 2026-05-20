import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { verifyWebhookSignature } from '../../../backend/services/webhookSecurityService';
import { recordRevenueEvent, type CrmProvider } from '../../../backend/services/intelligence/crmReconciliationService';

/**
 * ISOLATED revenue-webhook handoff (inbound only). Append-only lineage; no
 * outbound CRM API call. Double-gated: RBAC + internal HMAC over canonical
 * body (REVENUE_WEBHOOK_HANDOFF_SECRET).
 */
const VALID: CrmProvider[] = ['hubspot', 'salesforce', 'zoho', 'csv_import', 'generic'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  const secret = process.env.REVENUE_WEBHOOK_HANDOFF_SECRET;
  if (!secret) {
    return res.status(503).json({ status: 'not_configured', detail: 'REVENUE_WEBHOOK_HANDOFF_SECRET unset' });
  }
  const signature = typeof req.body?.signature === 'string' ? req.body.signature : undefined;
  const body = JSON.stringify({
    company_id: companyId,
    provider: req.body?.provider,
    dedupe_key: req.body?.dedupe_key,
    amount_usd: req.body?.amount_usd,
    stage: req.body?.stage,
    attribution_token: req.body?.attribution_token,
    lead_id: req.body?.lead_id,
    occurred_at: req.body?.occurred_at,
  });
  if (!verifyWebhookSignature(body, secret, signature)) {
    return res.status(401).json({ status: 'unauthorized', detail: 'invalid handoff signature' });
  }

  const provider = (req.body?.provider as CrmProvider | undefined) ?? 'generic';
  if (!VALID.includes(provider)) return res.status(400).json({ error: `provider must be one of: ${VALID.join(', ')}` });
  const dedupeKey = typeof req.body?.dedupe_key === 'string' ? req.body.dedupe_key : null;
  const amount = Number(req.body?.amount_usd);
  if (!dedupeKey) return res.status(400).json({ error: 'dedupe_key is required' });
  if (!Number.isFinite(amount)) return res.status(400).json({ error: 'amount_usd must be a number' });

  const result = await recordRevenueEvent({
    companyId,
    provider,
    dedupeKey,
    amountUsd: amount,
    currency: typeof req.body?.currency === 'string' ? req.body.currency : undefined,
    stage: typeof req.body?.stage === 'string' ? req.body.stage : undefined,
    attributionToken: typeof req.body?.attribution_token === 'string' ? req.body.attribution_token : undefined,
    leadId: typeof req.body?.lead_id === 'string' ? req.body.lead_id : undefined,
    occurredAt: typeof req.body?.occurred_at === 'string' ? req.body.occurred_at : undefined,
    detail: typeof req.body?.detail === 'object' && req.body.detail !== null ? req.body.detail : undefined,
  });

  const code = result.status === 'recorded' || result.status === 'deduped' ? 200
    : result.status === 'tampered' ? 400 : 500;
  return res.status(code).json(result);
}
