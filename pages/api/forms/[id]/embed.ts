
/**
 * Public endpoint — no auth required.
 * Returns minimal form config for the embeddable JS snippet.
 * CORS enabled so external sites can fetch form config.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getForm } from '../../../../backend/services/leadService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const form = await getForm(id);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  // Return public-safe fields including brand config for the embed script
  return res.status(200).json({
    id: form.id,
    company_id: form.company_id,
    name: form.name,
    fields: form.fields,
    brand: form.brand || {},
  });
}
