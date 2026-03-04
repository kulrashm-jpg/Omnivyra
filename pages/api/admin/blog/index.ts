import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<{ userId: string | null } | null> {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    return { userId: null };
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (isAdmin) return { userId: user.id };
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('public_blogs')
        .select('id, title, slug, excerpt, category, status, is_featured, published_at, views_count, created_at')
        .order('updated_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ posts: data ?? [] });
    } catch (err: unknown) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const title = body.title?.trim();
      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }
      const slug = body.slug?.trim() || title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const excerpt = body.excerpt?.trim() || null;
      const content_markdown = body.content_markdown ?? '';
      const content_html = body.content_html ?? null;
      const featured_image_url = body.featured_image_url?.trim() || null;
      const category = body.category?.trim() || null;
      const tags = Array.isArray(body.tags) ? body.tags : (body.tags ? [body.tags] : []);
      const media_blocks = body.media_blocks ?? null;
      const seo_meta_title = body.seo_meta_title?.trim() || null;
      const seo_meta_description = body.seo_meta_description?.trim() || null;
      const status = ['draft', 'scheduled', 'published'].includes(body.status) ? body.status : 'draft';
      const is_featured = !!body.is_featured;
      const published_at = status === 'published' ? (body.published_at || new Date().toISOString()) : null;

      const { data: inserted, error } = await supabase
        .from('public_blogs')
        .insert({
          title,
          slug,
          excerpt,
          content_markdown,
          content_html,
          featured_image_url,
          category,
          tags,
          media_blocks,
          seo_meta_title,
          seo_meta_description,
          status,
          is_featured,
          published_at,
          created_by: auth.userId,
        })
        .select('id, slug, status')
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Slug already exists' });
        }
        return res.status(500).json({ error: error.message });
      }
      return res.status(201).json(inserted);
    } catch (err: unknown) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
