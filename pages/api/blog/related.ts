import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

const DEFAULT_LIMIT = 3;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slug = req.query.slug as string;
  const limit = Math.min(6, Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

  if (!slug?.trim()) {
    return res.status(400).json({ error: 'Slug is required' });
  }

  try {
    const { data: currentPost, error: currentError } = await supabase
      .from('public_blogs')
      .select('id, category, tags')
      .eq('status', 'published')
      .eq('slug', slug.trim())
      .maybeSingle();

    if (currentError || !currentPost) {
      return res.status(404).json({ error: 'Post not found' });
    }

    let related: { id: string; title: string; slug: string; excerpt: string | null; featured_image_url: string | null; category: string | null; published_at: string | null }[] = [];

    // Prefer same category
    if (currentPost.category) {
      const { data: byCategory } = await supabase
        .from('public_blogs')
        .select('id, title, slug, excerpt, featured_image_url, category, published_at')
        .eq('status', 'published')
        .eq('category', currentPost.category)
        .neq('id', currentPost.id)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (byCategory?.length) related = byCategory;
    }

    // Fill with recent if not enough
    if (related.length < limit) {
      const excludeIds = [currentPost.id, ...related.map((r) => r.id)];
      const excludeList = excludeIds.map((id) => `'${id}'`).join(',');
      const { data: byRecent } = await supabase
        .from('public_blogs')
        .select('id, title, slug, excerpt, featured_image_url, category, published_at')
        .eq('status', 'published')
        .not('id', 'in', `(${excludeList})`)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit - related.length);

      if (byRecent?.length) {
        related = [...related, ...byRecent];
      }
    }

    return res.status(200).json({ posts: related.slice(0, limit) });
  } catch (err: unknown) {
    console.error('Blog related error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
