import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { publishBlogPost, getBlog } from '../../../../backend/services/blogService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  const integrationId = typeof req.body?.integration_id === 'string' ? req.body.integration_id : null;

  try {
    const result = await publishBlogPost(id, companyId, integrationId);
    const blog = await getBlog(id, companyId);
    return res.status(200).json({ ...result, blog });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Publish failed',
    });
  }
}
