/**
 * POST /api/blogs/intelligence
 *
 * Company Admin blog intelligence endpoint.
 *
 * Transforms raw blog + analytics data into:
 *   - Per-post scores (engagement, visibility, health)
 *   - Per-post growth actions (amplification + recovery)
 *   - Portfolio growth summary and topic performance narratives
 *   - Content gap analysis against company pillar topics
 *   - Knowledge graph suggested edges
 *
 * Auth: enforceCompanyAccess + COMPANY_ADMIN role.
 *
 * All intelligence logic lives in lib/blog/companyBlogIntelligenceService.ts.
 * Zero intelligence logic is permitted in this file.
 *
 * Body:
 * {
 *   company_id: string
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { runCompanyBlogIntelligence } from '../../../lib/blog/companyBlogIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res,
    companyId:    company_id,
    allowedRoles: [Role.COMPANY_ADMIN],
  });
  if (!roleGate) return;

  // ── Intelligence ───────────────────────────────────────────────────────────
  const result = await runCompanyBlogIntelligence(company_id);

  return res.status(200).json(result);
}
