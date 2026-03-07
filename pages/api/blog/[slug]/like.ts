import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slug = req.query.slug as string;
  if (!slug?.trim()) {
    return res.status(400).json({ error: 'Slug is required' });
  }

  try {
    const { data: post, error: postError } = await supabase
      .from('public_blogs')
      .select('id, likes_count')
      .eq('status', 'published')
      .eq('slug', slug.trim())
      .maybeSingle();

    if (postError || !post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const blogId = post.id;
    const likesCount = post.likes_count ?? 0;

    if (req.method === 'GET') {
      const fingerprint = (req.query.fingerprint as string)?.trim();
      let hasLiked = false;
      if (fingerprint && fingerprint.length <= 64) {
        const { data: likeRow } = await supabase
          .from('blog_post_likes')
          .select('id')
          .eq('blog_id', blogId)
          .eq('fingerprint', fingerprint)
          .maybeSingle();
        hasLiked = !!likeRow;
      }
      return res.status(200).json({ likesCount, hasLiked });
    }

    // POST - toggle like (fingerprint required to prevent duplicate)
    const fingerprint = req.body?.fingerprint as string;
    if (!fingerprint?.trim() || fingerprint.length > 64) {
      return res.status(400).json({ error: 'Valid fingerprint is required' });
    }

    const { data: existing } = await supabase
      .from('blog_post_likes')
      .select('id')
      .eq('blog_id', blogId)
      .eq('fingerprint', fingerprint.trim())
      .maybeSingle();

    if (existing) {
      const { error: delError } = await supabase
        .from('blog_post_likes')
        .delete()
        .eq('blog_id', blogId)
        .eq('fingerprint', fingerprint.trim());

      if (delError) {
        console.error('Blog unlike error:', delError);
        return res.status(500).json({ error: delError.message });
      }
      return res.status(200).json({
        liked: false,
        likesCount: Math.max(0, likesCount - 1),
      });
    }

    const { error: insertError } = await supabase.from('blog_post_likes').insert({
      blog_id: blogId,
      fingerprint: fingerprint.trim(),
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(200).json({ liked: true, likesCount: likesCount + 1 });
      }
      console.error('Blog like error:', insertError);
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(200).json({
      liked: true,
      likesCount: likesCount + 1,
    });
  } catch (err: unknown) {
    console.error('Blog like error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
