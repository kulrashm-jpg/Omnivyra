import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../../backend/services/rbacService';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ok = await requireSuperAdmin(req, res);
  if (!ok) return;

  // ── GET — list all series with post counts ─────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('blog_series')
      .select(`
        id, title, slug, description, cover_url, created_at,
        blog_series_posts(blog_id, position)
      `)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ series: data ?? [] });
  }

  // ── POST — create series ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {};
    const title = body.title?.trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const slug = body.slug?.trim() || slugify(title);
    const description = body.description?.trim() || null;

    const { data, error } = await supabase
      .from('blog_series')
      .insert({ title, slug, description })
      .select('id, title, slug, description, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
