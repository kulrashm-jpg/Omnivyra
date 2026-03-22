import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { createBlog, getBlogs, BlogStatus, type CreateBlogInput } from '../../../backend/services/blogService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const status = typeof req.query.status === 'string' ? req.query.status as BlogStatus : undefined;
    try {
      const blogs = await getBlogs(companyId, status);
      return res.status(200).json({ blogs });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load blogs' });
    }
  }

  if (req.method === 'POST') {
    const roleGate = await enforceRole({
      req, res, companyId,
      allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
    });
    if (!roleGate) return;

    const {
      title, content, content_blocks, slug, excerpt, featured_image_url, category, tags,
      seo_meta_title, seo_meta_description, is_featured, angle_type, hook_strength,
    } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    try {
      const input: CreateBlogInput = {
        title:                title.trim(),
        content:              typeof content === 'string' ? content : '',
        ...(slug                  ? { slug: String(slug) }                         : {}),
        ...(excerpt               ? { excerpt: String(excerpt) }                   : {}),
        ...(featured_image_url    ? { featured_image_url: String(featured_image_url) } : {}),
        ...(category              ? { category: String(category) }                 : {}),
        ...(Array.isArray(tags)   ? { tags: tags.map(String) }                     : {}),
        ...(seo_meta_title        ? { seo_meta_title: String(seo_meta_title) }     : {}),
        ...(seo_meta_description  ? { seo_meta_description: String(seo_meta_description) } : {}),
        ...(Array.isArray(content_blocks) ? { content_blocks }                     : {}),
        ...(angle_type    && typeof angle_type    === 'string' ? { angle_type }    : {}),
        ...(hook_strength && typeof hook_strength === 'string' ? { hook_strength } : {}),
        is_featured: is_featured === true,
      };
      const blog = await createBlog(companyId, roleGate.userId, input);
      return res.status(201).json({ blog });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create blog' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
