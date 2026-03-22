/**
 * Public endpoint — no auth required.
 * Returns a published blog post by ID or slug.
 * Used by /company-blog/[slug].
 *
 * Query:
 *   ?id=<uuid>        — look up by primary key
 *   ?slug=<slug>&company_id=<uuid> — look up by slug within company
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const idParam   = typeof req.query.id        === 'string' ? req.query.id        : null;
  const slugParam = typeof req.query.slug      === 'string' ? req.query.slug      : null;
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;

  const SELECT = 'id, title, slug, excerpt, content, content_blocks, featured_image_url, category, tags, seo_meta_title, seo_meta_description, is_featured, published_at, created_at';

  let query = supabase.from('blogs').select(SELECT).eq('status', 'published');

  if (slugParam && companyId) {
    query = query.eq('slug', slugParam).eq('company_id', companyId);
  } else if (idParam) {
    query = query.eq('id', idParam);
  } else {
    return res.status(400).json({ error: 'id or slug+company_id required' });
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Post not found or not published' });

  return res.status(200).json({ post: data });
}
