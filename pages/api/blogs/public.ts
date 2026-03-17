/**
 * Public endpoint — no auth required.
 * Returns all published blog posts for a company (for embedding a blog feed).
 * CORS enabled so external sites can fetch the feed.
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

  const { data, error } = await supabase
    .from('blogs')
    .select('id, title, content, published_at, created_at')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  // Return posts with a truncated excerpt (first 200 chars of stripped HTML)
  const posts = (data || []).map((p: { id: string; title: string; content: string; published_at: string; created_at: string }) => ({
    id: p.id,
    title: p.title,
    excerpt: p.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    published_at: p.published_at || p.created_at,
  }));

  return res.status(200).json({ posts });
}
