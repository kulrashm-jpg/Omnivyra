
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
