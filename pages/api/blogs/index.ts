import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { createBlog, getBlogs, BlogStatus } from '../../../backend/services/blogService';

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

    const { title, content } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    try {
      const blog = await createBlog(companyId, roleGate.userId, title.trim(), content || '');
      return res.status(201).json({ blog });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create blog' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
