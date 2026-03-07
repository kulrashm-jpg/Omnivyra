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
      .select('id')
      .eq('status', 'published')
      .eq('slug', slug.trim())
      .maybeSingle();

    if (postError || !post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const blogId = post.id;

    if (req.method === 'GET') {
      const { data: comments, error: commentsError } = await supabase
        .from('blog_comments')
        .select('id, author_name, content, created_at')
        .eq('blog_id', blogId)
        .eq('status', 'approved')
        .order('created_at', { ascending: true });

      if (commentsError) {
        console.error('Blog comments get error:', commentsError);
        return res.status(500).json({ error: commentsError.message });
      }

      return res.status(200).json({
        comments: (comments || []).map((c) => ({
          id: c.id,
          authorName: c.author_name,
          content: c.content,
          createdAt: c.created_at,
        })),
      });
    }

    // POST
    const { author_name, author_email, content } = req.body || {};
    if (!author_name?.trim() || !author_email?.trim() || !content?.trim()) {
      return res.status(400).json({
        error: 'author_name, author_email, and content are required',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(author_email).trim())) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const { data: newComment, error: insertError } = await supabase
      .from('blog_comments')
      .insert({
        blog_id: blogId,
        author_name: String(author_name).trim().slice(0, 100),
        author_email: String(author_email).trim().toLowerCase(),
        content: String(content).trim().slice(0, 5000),
        status: 'approved',
      })
      .select('id, author_name, content, created_at')
      .single();

    if (insertError) {
      console.error('Blog comment insert error:', insertError);
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(201).json({
      comment: {
        id: newComment.id,
        authorName: newComment.author_name,
        content: newComment.content,
        createdAt: newComment.created_at,
      },
    });
  } catch (err: unknown) {
    console.error('Blog comments error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
