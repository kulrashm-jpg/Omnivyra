import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slug = req.query.slug as string;
  if (!slug?.trim()) {
    return res.status(400).json({ error: 'Slug is required' });
  }

  try {
    const { data: post, error } = await supabase
      .from('public_blogs')
      .select('*')
      .eq('status', 'published')
      .eq('slug', slug.trim())
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Blog get error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!post) {
      return res.status(404).json({ error: 'Not found' });
    }

    await supabase
      .from('public_blogs')
      .update({ views_count: (post.views_count ?? 0) + 1 })
      .eq('id', post.id);

    return res.status(200).json({
      ...post,
      views_count: (post.views_count ?? 0) + 1,
    });
  } catch (err: unknown) {
    console.error('Blog get error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
