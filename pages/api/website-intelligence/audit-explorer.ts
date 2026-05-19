import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { ownedDbTable } from '../../../backend/db/writeOwner';

/**
 * READ-ONLY compliance audit explorer over the existing append-only
 * `audit_events` table. Tenant-scoped, RBAC-gated, paginated, filterable.
 * No mutation. GET /api/website-intelligence/audit-explorer?company_id=...
 *   &action=&resource_type=&since=&limit=&offset=
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const action = typeof req.query.action === 'string' ? req.query.action : null;
  const resourceType = typeof req.query.resource_type === 'string' ? req.query.resource_type : null;
  const since = typeof req.query.since === 'string' ? req.query.since : null;

  try {
    let q = ownedDbTable('audit_events')
      .select('id, company_id, actor_user_id, actor_type, action, resource_type, resource_id, severity, metadata, created_at', { count: 'exact' })
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (action) q = q.eq('action', action);
    if (resourceType) q = q.eq('resource_type', resourceType);
    if (since) q = q.gte('created_at', since);

    const { data, error, count } = await q;
    if (error) {
      return res.status(200).json({
        available: false,
        reason: error.message,
        events: [],
        total: 0,
      });
    }
    return res.status(200).json({
      available: true,
      total: typeof count === 'number' ? count : ((data as unknown[] | null)?.length ?? 0),
      limit,
      offset,
      events: data ?? [],
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query audit events',
    });
  }
}
