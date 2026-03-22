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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ok = await requireSuperAdmin(req, res);
  if (!ok) return;

  const id = req.query.id as string;
  if (!id?.trim()) return res.status(400).json({ error: 'id required' });

  // ── GET — series with full post list ──────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('blog_series')
      .select(`
        id, title, slug, description, cover_url, created_at,
        blog_series_posts(blog_id, position)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Not found' });

    // Resolve blog titles/slugs for the posts
    const postIds = (data.blog_series_posts as { blog_id: string; position: number }[]).map(
      (p) => p.blog_id,
    );

    let blogDetails: { id: string; title: string; slug: string; status: string }[] = [];
    if (postIds.length > 0) {
      const { data: blogs } = await supabase
        .from('public_blogs')
        .select('id, title, slug, status')
        .in('id', postIds);
      blogDetails = blogs ?? [];
    }

    const posts = (data.blog_series_posts as { blog_id: string; position: number }[])
      .map((sp) => {
        const blog = blogDetails.find((b) => b.id === sp.blog_id);
        return { ...sp, title: blog?.title ?? '', slug: blog?.slug ?? '', status: blog?.status ?? '' };
      })
      .sort((a, b) => a.position - b.position);

    return res.status(200).json({ ...data, blog_series_posts: posts });
  }

  // ── PATCH — update series metadata + replace post list ─────────────────────
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined)       updates.title       = body.title?.trim() ?? '';
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.cover_url !== undefined)   updates.cover_url   = body.cover_url?.trim() || null;

    const { error: updateErr } = await supabase
      .from('blog_series')
      .update(updates)
      .eq('id', id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Replace post list if provided
    if (Array.isArray(body.posts)) {
      // Delete existing
      await supabase.from('blog_series_posts').delete().eq('series_id', id);

      // Insert new
      const rows = (body.posts as { blog_id: string; position: number }[]).map((p) => ({
        series_id: id,
        blog_id:   p.blog_id,
        position:  p.position ?? 0,
      }));

      if (rows.length > 0) {
        const { error: insertErr } = await supabase.from('blog_series_posts').insert(rows);
        if (insertErr) return res.status(500).json({ error: insertErr.message });
      }
    }

    return res.status(200).json({ ok: true });
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('blog_series').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
