import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BLOG_PUBLISH_MANAGE, SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';
import { sanitizeHtml, sanitizeContentBlocks } from '../../../../lib/security/htmlSanitizer';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cap = req.method === 'GET' ? SUPER_ADMIN_DASHBOARD_VIEW : BLOG_PUBLISH_MANAGE;
  const guard = await requireCapability(req, res, {
    capability: cap,
    reason: `blog admin item (${req.method})`,
  });
  if (guard.ok !== true) return;

  const id = req.query.id as string;
  if (!id?.trim()) {
    return res.status(400).json({ error: 'id is required' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('public_blogs')
      .select('*')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) updates.title = body.title?.trim() ?? '';
    if (body.slug !== undefined) updates.slug = body.slug?.trim() ?? '';
    if (body.excerpt !== undefined) updates.excerpt = body.excerpt?.trim() || null;
    if (body.content_markdown !== undefined) updates.content_markdown = body.content_markdown ?? '';
    // HARDEN-003 defense-in-depth: sanitize HTML fields before storage too.
    if (body.content_html !== undefined) updates.content_html = body.content_html ? sanitizeHtml(String(body.content_html), 'rich') : null;
    if (body.featured_image_url !== undefined) updates.featured_image_url = body.featured_image_url?.trim() || null;
    if (body.category !== undefined) updates.category = body.category?.trim() || null;
    if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? body.tags : body.tags ? [body.tags] : [];
    if (body.media_blocks !== undefined) updates.media_blocks = body.media_blocks;
    if (body.content_blocks !== undefined) updates.content_blocks = body.content_blocks ? sanitizeContentBlocks(body.content_blocks) : null;
    if (body.seo_meta_title !== undefined) updates.seo_meta_title = body.seo_meta_title?.trim() || null;
    if (body.seo_meta_description !== undefined) updates.seo_meta_description = body.seo_meta_description?.trim() || null;
    if (body.status !== undefined && ['draft', 'scheduled', 'published'].includes(body.status)) {
      updates.status = body.status;
      if (body.status === 'published') {
        const { data: existing } = await supabase.from('public_blogs').select('published_at').eq('id', id).single();
        if (existing && !existing.published_at) {
          updates.published_at = body.published_at || new Date().toISOString();
        }
      }
    }
    if (body.published_at !== undefined) updates.published_at = body.published_at || null;
    if (body.is_featured !== undefined) updates.is_featured = !!body.is_featured;

    const { data, error } = await supabase
      .from('public_blogs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('public_blogs').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/blog/:id' });
