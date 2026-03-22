import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

// Rate-limit: max body size check
const MAX_TIME = 3600; // 1 hour — cap absurd values

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query.slug as string)?.trim();
  if (!slug) return res.status(400).json({ error: 'Slug required' });

  const { session_key, time_seconds, scroll_depth, completed } = req.body ?? {};

  // Validate session_key (must be a UUID-like string)
  if (!session_key || typeof session_key !== 'string' || session_key.length > 64 || session_key.length < 8) {
    return res.status(400).json({ error: 'Invalid session_key' });
  }

  const timeVal   = Math.max(0, Math.min(parseInt(String(time_seconds)  || '0', 10), MAX_TIME));
  const scrollVal = Math.max(0, Math.min(parseInt(String(scroll_depth)  || '0', 10), 100));
  const doneVal   = Boolean(completed);

  try {
    // Resolve blog_id from slug
    const { data: blog } = await supabase
      .from('public_blogs')
      .select('id')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();

    if (!blog) return res.status(404).json({ error: 'Post not found' });

    // Upsert — create or update the session record
    const { error } = await supabase
      .from('blog_read_sessions')
      .upsert(
        {
          blog_id:      blog.id,
          session_key:  session_key.trim(),
          time_seconds: timeVal,
          scroll_depth: scrollVal,
          completed:    doneVal,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'session_key' },
      );

    if (error) {
      // Silently ignore duplicate/constraint errors — not critical
      if (error.code !== '23505') {
        console.error('Track error:', error.message);
      }
    }

    return res.status(204).end();
  } catch (err: unknown) {
    // Non-critical endpoint — always return 204 to avoid client noise
    console.error('Track error:', err);
    return res.status(204).end();
  }
}
