import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * Public endpoint — no auth required.
 * Returns minimal form config for the embeddable JS snippet.
 * CORS enabled so external sites can fetch form config.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getForm } from '../../../../backend/services/leadService';
import { checkFormOrigin } from '../../../../backend/services/websiteDomainEnforcementService';

function setCors(req: NextApiRequest, res: NextApiResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const form = await getForm(id);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const originDecision = await checkFormOrigin(form, typeof req.headers.origin === 'string' ? req.headers.origin : undefined);
  if (!originDecision.allowed) return res.status(403).json({ error: originDecision.message });

  // Return public-safe fields including brand config for the embed script
  return res.status(200).json({
    id: form.id,
    company_id: form.company_id,
    website_id: form.website_id ?? null,
    name: form.name,
    fields: form.fields,
    brand: form.brand || {},
    origin: originDecision,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
// AUTH-ENFORCEMENT Phase 1 (Task 3b Batch 2b): declarative policy, observation-only.
// checkFormOrigin above is DELIVERY TRUST (design §3.8) — handler business logic,
// never to be replaced by the policy gate or removed in V-11 cleanup.
export default __createApiRoute(handler, {
  route: '/api/forms/:id/embed',
  policy: {
    v: 1,
    category: 'public',
    justification:
      'Purpose: minimal form configuration for the embeddable JS snippet on external sites. Exposure: form id, owning company_id and website_id (required by the embed to submit leads), field definitions, brand config, and the origin decision. Rationale: no principal exists by design; the trust boundary is the owner-configured origin allowlist (checkFormOrigin, 403 on mismatch, open when the owner configures no allowlist) plus the unguessable form id — Delivery Trust in the handler, not principal authorization. Contract: Embeddable Configuration.',
  },
});
