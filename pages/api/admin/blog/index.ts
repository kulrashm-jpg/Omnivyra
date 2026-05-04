import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'blog:generate');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/blog', 'blog:generate');
  }
  const auth = { userId: ctx.id };

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
      const slug = body.slug?.trim() || title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
      const excerpt = body.excerpt?.trim() || null;
      const content_markdown = body.content_markdown ?? '';
      const content_html = body.content_html ?? null;
      const featured_image_url = body.featured_image_url?.trim() || null;
      const category = body.category?.trim() || null;
      const tags = Array.isArray(body.tags) ? body.tags : (body.tags ? [body.tags] : []);
      const media_blocks = body.media_blocks ?? null;
      const content_blocks = body.content_blocks ?? null;
      const seo_meta_title = body.seo_meta_title?.trim() || null;
      const seo_meta_description = body.seo_meta_description?.trim() || null;
      const status = ['draft', 'scheduled', 'published'].includes(body.status) ? body.status : 'draft';
      const is_featured = !!body.is_featured;
      const published_at = status === 'published' ? (body.published_at || new Date().toISOString()) : null;
      const primary_keyword = typeof body.primary_keyword === 'string' ? body.primary_keyword.trim() || null : null;
      const secondary_keywords = Array.isArray(body.secondary_keywords)
        ? body.secondary_keywords.filter((k: unknown) => typeof k === 'string').slice(0, 5)
        : null;

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
          content_blocks,
          seo_meta_title,
          seo_meta_description,
          status,
          is_featured,
          published_at,
          primary_keyword,
          secondary_keywords,
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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
