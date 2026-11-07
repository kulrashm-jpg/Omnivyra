import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * G-11 — a company's opt-out reviews.
 *
 *   GET /api/contact-optout-reviews?company_id=<uuid>[&state=pending|decided|all]
 *       -> { reviews: [{ ...review, overdue }] }   pending first, by due date
 *
 * Every opt-out (a WhatsApp STOP, an email unsubscribe, an operator `opt_out`) holds ALL
 * channels for that contact in that tenant until the tenant's OWN admin decides
 * (POST /api/contact-optout-reviews/:id). `overdue` is a pending review past its due date
 * (3 working days in the company's timezone); nothing reopens on its own.
 *
 * ─── AUTHORIZATION ────────────────────────────────────────────────────────
 * enforceCompanyAccess, then COMPANY_ADMIN in THIS company from the canonical tenant decision
 * (TenantGuard.assertTenantAccess, as lead-intelligence/execution's companyScopedRole), with
 * the platform super-admin bypass REFUSED (owner rule: the tenant's own admin decides).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { assertTenantAccess } from '../../../backend/security/TenantGuard';
import { normalizePermissionRole, Role } from '../../../backend/services/rbacService';
import { listOptOutReviews } from '../../../backend/services/orchestration/optOutReview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const STATES = ['pending', 'decided', 'all'] as const;

/**
 * COMPANY_ADMIN in THIS company, by active membership only. The super-admin bypass is not
 * consulted (`noPlatformBypass`), and a granted bypass is refused again here. Any lookup
 * failure is a refusal.
 */
async function isCompanyAdmin(userId: string, companyId: string): Promise<boolean> {
  const decision = await assertTenantAccess({ userId, organizationId: companyId, options: { noPlatformBypass: true } });
  if (decision.ok !== true || decision.access.bypass) return false;
  return normalizePermissionRole(String(decision.access.role ?? '').trim().toUpperCase()) === Role.COMPANY_ADMIN;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });
  const state = str(req.query.state) ?? 'pending';
  if (!(STATES as readonly string[]).includes(state)) return res.status(400).json({ error: `state must be one of ${STATES.join(' | ')}` });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  if (!(await isCompanyAdmin(access.userId, companyId))) {
    return res.status(403).json({ error: 'only an admin of this company reviews its opt-outs', code: 'company_admin_required' });
  }

  try {
    const reviews = await listOptOutReviews({ organizationId: companyId, state: state as typeof STATES[number] });
    return res.status(200).json({ reviews });
  } catch {
    return res.status(503).json({ error: 'the reviews could not be read', code: 'review_unreadable' });
  }
}

export default __createApiRoute(handler, { route: '/api/contact-optout-reviews' });
