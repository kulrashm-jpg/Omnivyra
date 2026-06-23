/**
 * GET /api/super-admin/customer-operations
 *
 * READ-ONLY unified cockpit for the Customer Operations Command Center.
 * Returns { summary, companies, signup_funnel, portfolio }. No writes/side effects.
 *
 * Query params (optional): status, plan, priority, readiness, trajectory, search.
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { getCustomerOperations, type CockpitFilters } from '../../../backend/services/customerOperationsCockpitService';
import type { TenantStatus, ReadinessBucket } from '../../../backend/services/customerReadinessService';
import type { PriorityTier } from '../../../backend/services/customerOpportunityPriorityService';
import type { Trajectory } from '../../../backend/services/customerEvolutionService';

const STATUSES: TenantStatus[] = ['SIGNUP_STARTED', 'EMAIL_VERIFIED', 'COMPANY_CREATED', 'ACTIVE', 'DORMANT', 'INACTIVE'];
const TIERS: PriorityTier[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'READ_ONLY'];
const BUCKETS: ReadinessBucket[] = ['READY', 'PARTIAL', 'AT_RISK'];
const TRAJ: Trajectory[] = ['IMPROVING', 'STABLE', 'DECLINING', 'UNKNOWN'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin customer-operations (GET)',
  });
  if (guard.ok !== true) return;

  const q = req.query;
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const oneOf = <T extends string>(v: string | undefined, set: readonly T[]): T | undefined => (v && (set as readonly string[]).includes(v) ? (v as T) : undefined);

  const filters: CockpitFilters = {
    status: oneOf(s(q.status), STATUSES),
    plan: s(q.plan),
    priority: oneOf(s(q.priority), TIERS),
    readiness: oneOf(s(q.readiness), BUCKETS),
    trajectory: oneOf(s(q.trajectory), TRAJ),
    search: s(q.search),
  };

  try {
    const result = await getCustomerOperations(filters);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[super-admin/customer-operations]', err);
    return res.status(500).json({ error: 'Failed to load customer operations' });
  }
}
