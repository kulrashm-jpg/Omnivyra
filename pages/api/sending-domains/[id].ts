import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET  /api/sending-domains/:id?companyId=…  — status, DKIM CNAME instructions
 *                                              and read-only SPF/DMARC diagnostics.
 * POST /api/sending-domains/:id?companyId=…  — refresh verification from SES.
 *
 * W4 (Model A). `integration.manage` on the named tenant is required before any
 * read. The id is only ever looked up TOGETHER with that tenant, so another
 * tenant's id answers 404, never its data. The refresh POST calls SES and is
 * rate-limited per (authorized) tenant, after the guard.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTEGRATION_MANAGE } from '../../../shared/contracts/security';
import { getSendingDomain, refreshSendingDomainStatus } from '../../../backend/services/sendingDomains/sendingDomainService';
import { gateSendingDomainSesCall } from '../../../backend/services/sendingDomains/sendingDomainRateLimit';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const organizationId = str(req.query?.companyId);
  const id = str(req.query?.id);
  if (!organizationId || !id) {
    res.status(400).json({ error: 'companyId and id are required' });
    return;
  }

  const guard = await requireCapability(req, res, {
    capability: INTEGRATION_MANAGE,
    organizationId,
    reason: req.method === 'GET' ? 'read sending domain' : 'refresh sending domain',
    resourceId: id,
  });
  if (guard.ok !== true) return;

  if (req.method === 'GET') {
    const found = await getSendingDomain(organizationId, id);
    if (found.status === 'retryable_failure') {
      res.status(503).json({ error: 'sending_domain_unavailable' });
      return;
    }
    if (found.status === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(200).json(found.detail);
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

  const refreshed = await refreshSendingDomainStatus(organizationId, id);
  switch (refreshed.status) {
    case 'refreshed':
      res.status(200).json({ domain: refreshed.domain, reason: refreshed.reason });
      return;
    case 'not_found':
      res.status(404).json({ error: 'not_found' });
      return;
    case 'retryable_failure':
      res.status(503).json({ error: refreshed.reason, domain: refreshed.domain });
      return;
    default:
      res.status(502).json({ error: refreshed.reason, domain: refreshed.domain });
  }
}

export default __createApiRoute(handler, { route: '/api/sending-domains/:id' });
