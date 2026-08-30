import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { supabase } from '../../../backend/db/supabaseClient';

/**
 * POST /api/outreach-plans
 * Body: { opportunityId: string, companyId: string, notes?: string }
 * Creates an outreach plan (non-campaign artifact). Does NOT trigger campaign lifecycle.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const opportunityId = typeof body.opportunityId === 'string' ? body.opportunityId.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes : null;

  if (!opportunityId) {
    return res.status(400).json({ error: 'opportunityId is required' });
  }

  const userId = (req as any)?.rbac?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'User not identified' });
  }

  const { data: existing } = await supabase
    .from('opportunity_items')
    .select('id, company_id')
    .eq('id', opportunityId)
    .single();

  if (!existing) {
    return res.status(404).json({ error: 'Opportunity not found' });
  }
  /*
   * WITHRBAC-SEC-001 — authorize the OPPORTUNITY'S owner, not a caller label.
   *
   * withRBAC authorizes the companyId the caller names, but this handler never
   * read it: the opportunity was selected BY ID ALONE and the plan row inserted
   * against it. A COMPANY_ADMIN or CONTENT_CREATOR of any company could name
   * their own company to satisfy the wrapper and another tenant's opportunityId
   * to attach a plan to that tenant's opportunity — and the 404-vs-201 split
   * also told them whether an opportunity id existed anywhere.
   *
   * The owning company comes from the row itself (server-owned) and is
   * authorized with requireCompanyAccess before the insert, so nothing is
   * written against a resource the caller cannot access.
   */
  const ownerCompanyId = (existing as { company_id?: string | null })?.company_id;
  if (!(await requireCompanyAccess(userId, ownerCompanyId ?? undefined, res))) return;

  const { data: plan, error } = await supabase
    .from('outreach_plans')
    .insert({
      opportunity_id: opportunityId,
      notes: notes || null,
      created_by: userId,
    })
    .select('id, opportunity_id, notes, created_by, created_at')
    .single();

  if (error) {
    console.error('POST /api/outreach-plans', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json(plan);
}

export default __createApiRoute(withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]), { route: '/api/outreach-plans' });
