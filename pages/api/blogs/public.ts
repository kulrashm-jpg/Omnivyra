/**
 * Public endpoint — no auth required.
 * Returns all published blog posts for a company (for embedding a blog feed).
 * CORS enabled so external sites can fetch the feed.
 *
 * Response: { blogs: BlogListing[] }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const PAGE_SIZE = 12;
  const page  = Math.max(1, parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10) || 1);
  const from  = (page - 1) * PAGE_SIZE;
  const to    = from + PAGE_SIZE - 1;

  const { data, error, count } = await supabase
    .from('blogs')
    .select('id, title, slug, excerpt, content, featured_image_url, category, tags, is_featured, published_at, created_at', { count: 'exact' })
    .eq('company_id', companyId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: error.message });

  const blogs = (data ?? []).map((p: any) => ({
    id:                 p.id,
    title:              p.title              ?? '',
    slug:               p.slug               ?? null,
    excerpt:            p.excerpt
      ?? (p.content ? p.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : null),
    featured_image_url: p.featured_image_url ?? null,
    category:           p.category           ?? null,
    tags:               p.tags               ?? [],
    is_featured:        p.is_featured        ?? false,
    published_at:       p.published_at       ?? p.created_at,
  }));

  return res.status(200).json({
    blogs,
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total:     count ?? 0,
      has_more:  (count ?? 0) > page * PAGE_SIZE,
    },
  });
}
