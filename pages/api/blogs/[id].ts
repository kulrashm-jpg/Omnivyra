import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getBlog, updateBlog, deleteBlog, type UpdateBlogInput } from '../../../backend/services/blogService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const blog = await getBlog(id, companyId);
    if (!blog) return res.status(404).json({ error: 'Blog not found' });
    return res.status(200).json({ blog });
  }

  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const {
      title, content, content_blocks, slug, excerpt, featured_image_url, category, tags,
      seo_meta_title, seo_meta_description, is_featured, angle_type, hook_strength,
    } = req.body || {};
    const updates: UpdateBlogInput = {};
    if (title                !== undefined && typeof title    === 'string') updates.title               = title;
    if (content              !== undefined && typeof content  === 'string') updates.content             = content;
    if (slug                 !== undefined) updates.slug                = typeof slug === 'string' ? slug : undefined;
    if (excerpt              !== undefined) updates.excerpt             = typeof excerpt === 'string' ? excerpt : null;
    if (featured_image_url   !== undefined) updates.featured_image_url  = typeof featured_image_url === 'string' ? featured_image_url : null;
    if (category             !== undefined) updates.category            = typeof category === 'string' ? category : null;
    if (tags                 !== undefined && Array.isArray(tags)) updates.tags = tags.map(String);
    if (seo_meta_title       !== undefined) updates.seo_meta_title       = typeof seo_meta_title === 'string' ? seo_meta_title : null;
    if (seo_meta_description !== undefined) updates.seo_meta_description = typeof seo_meta_description === 'string' ? seo_meta_description : null;
    if (is_featured          !== undefined) updates.is_featured          = is_featured === true;
    if (content_blocks       !== undefined && Array.isArray(content_blocks)) updates.content_blocks = content_blocks;
    if (angle_type           !== undefined) updates.angle_type           = typeof angle_type    === 'string' ? angle_type    : null;
    if (hook_strength        !== undefined) updates.hook_strength        = typeof hook_strength === 'string' ? hook_strength : null;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });
    try {
      const blog = await updateBlog(id, companyId, updates);
      return res.status(200).json({ blog });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await deleteBlog(id, companyId);
      return res.status(200).json({ status: 'deleted' });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
