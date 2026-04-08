import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get company_id from query or body
  const company_id = (req.query.company_id || req.body?.company_id) as string | undefined;

  if (!company_id) {
    return res.status(400).json({ error: 'company_id is required' });
  }

  // Verify user authentication and company access
  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!auth) return;

  if (req.method === 'GET') {
    try {
      const content_type = (req.query.content_type as string) || undefined;

      let query = supabase
        .from('blogs')
        .select('id, title, slug, excerpt, category, tags, status, published_at, views_count, likes_count, created_at, angle_type, content_type, content_blocks')
        .eq('company_id', company_id)
        .order('updated_at', { ascending: false });

      // Filter by content_type if provided (e.g. 'article')
      if (content_type) {
        query = query.eq('content_type', content_type);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ blogs: data ?? [] });
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

      const slug =
        body.slug?.trim() ||
        title
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 80);

      const excerpt = body.excerpt?.trim() || null;
      const content_markdown = body.content_markdown ?? '';
      const content_html = body.content_html ?? null;
      const featured_image_url = body.featured_image_url?.trim() || null;
      const category = body.category?.trim() || null;
      const tags = Array.isArray(body.tags) ? body.tags : body.tags ? [body.tags] : [];
      const media_blocks = body.media_blocks ?? null;
      const content_blocks = body.content_blocks ?? null;
      const seo_meta_title = body.seo_meta_title?.trim() || null;
      const seo_meta_description = body.seo_meta_description?.trim() || null;
      const status = ['draft', 'scheduled', 'published'].includes(body.status) ? body.status : 'draft';
      const is_featured = !!body.is_featured;
      const published_at = status === 'published' ? body.published_at || new Date().toISOString() : null;
      const angle_type = body.angle_type?.trim() || null;
      const primary_keyword = typeof body.primary_keyword === 'string' ? body.primary_keyword.trim() || null : null;
      const secondary_keywords = Array.isArray(body.secondary_keywords)
        ? body.secondary_keywords.filter((k: unknown) => typeof k === 'string').slice(0, 5)
        : null;
      const content_type = ['article', 'whitepaper', 'newsletter', 'story', 'guide'].includes(body.content_type) ? body.content_type : 'blog';

      const { data: inserted, error } = await supabase
        .from('blogs')
        .insert({
          company_id,
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
          angle_type,
          primary_keyword,
          secondary_keywords,
          content_type,
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
