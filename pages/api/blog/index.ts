import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const category = (req.query.category as string) || undefined;
    const sort = (req.query.sort as string) || 'recent';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('public_blogs')
      .select('id, title, slug, excerpt, featured_image_url, category, tags, status, is_featured, published_at, views_count', { count: 'exact' })
      .eq('status', 'published');

    if (category && category.trim()) {
      query = query.eq('category', category.trim());
    }

    const featuredOnly = req.query.featured_only === '1' || req.query.featured_only === 'true';
    if (featuredOnly) {
      query = query.eq('is_featured', true);
    }

    if (sort === 'popular') {
      query = query.order('views_count', { ascending: false });
    } else {
      query = query.order('published_at', { ascending: false, nullsFirst: false });
    }

    const { data: rows, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      console.error('Blog list error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      posts: rows || [],
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err: unknown) {
    console.error('Blog list error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
