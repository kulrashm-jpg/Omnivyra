/**
 * Public endpoint — no auth required.
 * Returns a published blog post by ID.
 * Used by the public blog viewer page at /blog/[id].
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const { data, error } = await supabase
    .from('blogs')
    .select('id, title, content, published_at, created_at')
    .eq('id', id)
    .eq('status', 'published')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Post not found or not published' });

  return res.status(200).json({ post: data });
}
