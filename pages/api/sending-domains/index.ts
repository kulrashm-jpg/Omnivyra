import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET  /api/sending-domains?companyId=…  — list the tenant's sending domains.
 * POST /api/sending-domains?companyId=…  — register one (body: { domain }).
 *
 * W4 (Model A). Tenant-authorized: `integration.manage` on the tenant named in
 * the request, checked before any read or write. Registration creates the SES
 * identity through the identity port; the SESv2 adapter is used only when
 * `SENDING_DOMAINS_SES_PROVIDER=sesv2`, otherwise every registration fails
 * closed. POST is rate-limited per (authorized) tenant, after the guard.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTEGRATION_MANAGE } from '../../../shared/contracts/security';
import { listSendingDomains, registerSendingDomain } from '../../../backend/services/sendingDomains/sendingDomainService';
import { gateSendingDomainSesCall } from '../../../backend/services/sendingDomains/sendingDomainRateLimit';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const REFUSAL_STATUS: Readonly<Record<string, number>> = {
  tenant_required: 400,
  invalid_domain: 400,
  domain_reserved: 422,
  domain_not_owned: 422,
  domain_unavailable: 409,
};

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const organizationId = str(req.query?.companyId) ?? str((req.body as Record<string, unknown> | undefined)?.companyId);
  if (!organizationId) {
    res.status(400).json({ error: 'companyId is required' });
    return;
  }

  const guard = await requireCapability(req, res, {
    capability: INTEGRATION_MANAGE,
    organizationId,
    reason: req.method === 'GET' ? 'list sending domains' : 'register sending domain',
  });
  if (guard.ok !== true) return;

  if (req.method === 'GET') {
    const listed = await listSendingDomains(organizationId);
    if (!listed.ok) {
      res.status(503).json({ error: 'sending_domains_unavailable' });
      return;
    }
    res.status(200).json({ domains: listed.domains });
    return;
  }

  const gate = await gateSendingDomainSesCall(organizationId);
  if (gate.allowed !== true) {
    if (gate.reason === 'rate_limited') {
      res.setHeader('Retry-After', String(gate.retryAfterSecs));
      res.status(429).json({ error: 'Too many requests. Try again later.' });
    } else {
      res.status(503).json({ error: 'temporarily_unavailable' });
    }
    return;
  }

  const result = await registerSendingDomain({
    organizationId,
    domain: (req.body as Record<string, unknown> | undefined)?.domain,
    actorUserId: guard.principal.userId,
  });
  switch (result.status) {
    case 'registered':
      res.status(201).json({ domain: result.domain });
      return;
    case 'already_registered':
      res.status(200).json({ domain: result.domain });
      return;
    case 'refused':
      res.status(REFUSAL_STATUS[String(result.reason)] ?? 422).json({ error: result.reason });
      return;
    case 'retryable_failure':
      res.status(503).json({ error: result.reason, domain: result.domain });
      return;
    default:
      res.status(502).json({ error: result.reason, domain: result.domain });
  }
}

export default __createApiRoute(handler, { route: '/api/sending-domains' });
