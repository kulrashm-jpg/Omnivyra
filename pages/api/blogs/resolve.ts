/**
 * GET /api/blogs/resolve?slug=<slug>&company_id=<uuid>
 *
 * Resolves a company blog slug to its id, title, and excerpt.
 * Used by the block editor to pre-populate InternalLinkBlock metadata.
 *
 * Slug uniqueness is enforced per company via:
 *   UNIQUE INDEX idx_blogs_company_slug ON blogs(company_id, slug)
 *
 * Auth: company membership required.
 * Returns 404 if slug not found or not owned by this company.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug      = typeof req.query.slug       === 'string' ? req.query.slug.trim()       : null;
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : null;

  if (!slug)      return res.status(400).json({ error: 'slug required' });
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const { data, error } = await supabase
    .from('blogs')
    .select('id, title, excerpt, slug, status')
    .eq('company_id', companyId)
    .eq('slug', slug)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Not found' });

  return res.status(200).json({
    id:      data.id,
    title:   data.title,
    excerpt: data.excerpt ?? null,
    slug:    data.slug,
    status:  data.status,
  });
}
