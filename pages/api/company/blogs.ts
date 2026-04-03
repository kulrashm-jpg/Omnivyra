import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin, Role, getCompanyRoleIncludingInvited } from '@/backend/services/rbacService';

async function ensureCompanyAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string,
): Promise<{ userId: string; role: Role | null } | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (superAdmin) {
    return { userId: user.id, role: Role.SUPER_ADMIN };
  }

  let { role, error: roleError } = await getUserRole(user.id, companyId);
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN ||
      fallbackRole === Role.SUPER_ADMIN
    ) {
      role = fallbackRole;
      roleError = null;
    }
  }
  if (roleError) {
    res.status(403).json({ error: roleError === 'COMPANY_ACCESS_DENIED' ? 'COMPANY_ACCESS_DENIED' : 'FORBIDDEN_ROLE' });
    return null;
  }
  if (!role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }

  return { userId: user.id, role };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get company_id from query or body
  const company_id = (req.query.company_id || req.body?.company_id) as string | undefined;

  if (!company_id) {
    return res.status(400).json({ error: 'company_id is required' });
  }

  // Verify user authentication and company access
  const auth = await ensureCompanyAccess(req, res, company_id);
  if (!auth) return;

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('blogs')
        .select('id, title, slug, excerpt, category, status, published_at, views_count, created_at, angle_type')
        .eq('company_id', company_id)
        .order('updated_at', { ascending: false });

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
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '');

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
