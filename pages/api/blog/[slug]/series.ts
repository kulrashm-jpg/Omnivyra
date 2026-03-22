import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query.slug as string)?.trim();
  if (!slug) return res.status(400).json({ error: 'Slug required' });

  try {
    // Find the blog by slug
    const { data: blog } = await supabase
      .from('public_blogs')
      .select('id')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();

    if (!blog) return res.status(200).json({ series: null });

    // Find which series this blog belongs to
    const { data: seriesPost } = await supabase
      .from('blog_series_posts')
      .select('series_id, position')
      .eq('blog_id', blog.id)
      .maybeSingle();

    if (!seriesPost) return res.status(200).json({ series: null });

    // Fetch the full series with all posts
    const { data: series } = await supabase
      .from('blog_series')
      .select(`
        id, title, slug, description,
        blog_series_posts(blog_id, position)
      `)
      .eq('id', seriesPost.series_id)
      .maybeSingle();

    if (!series) return res.status(200).json({ series: null });

    // Resolve blog details for all posts in series
    const postIds = (series.blog_series_posts as { blog_id: string; position: number }[]).map(
      (p) => p.blog_id,
    );

    const { data: blogs } = await supabase
      .from('public_blogs')
      .select('id, title, slug, excerpt')
      .in('id', postIds)
      .eq('status', 'published');

    const blogMap = new Map((blogs ?? []).map((b) => [b.id, b]));

    const posts = (series.blog_series_posts as { blog_id: string; position: number }[])
      .map((sp) => {
        const b = blogMap.get(sp.blog_id);
        return b ? {
          position: sp.position,
          blog_id:  sp.blog_id,
          title:    b.title,
          slug:     b.slug,
          excerpt:  b.excerpt,
        } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a!.position - b!.position) as {
        position: number; blog_id: string; title: string; slug: string; excerpt: string | null;
      }[];

    return res.status(200).json({
      series: {
        id:          series.id,
        title:       series.title,
        description: series.description,
        posts,
      },
      currentPosition: seriesPost.position,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' });
  }
}
