import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/blogs/publishing-jobs/[jobId]/retry   body: { company_id, confirm_outcome_unknown? }
 *
 * Re-queue ONE dead-lettered CMS publishing job. Company access + COMPANY_ADMIN / SUPER_ADMIN, as
 * publishing itself requires; audited. A job whose outcome is UNKNOWN (the post may already be
 * live) is refused (409 CONFIRM_OUTCOME_UNKNOWN) unless confirm_outcome_unknown is true - the
 * server enforces it, not only the UI, because a retry may publish a duplicate.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../../backend/services/rbacService';
import { requeueDeadLetteredPublishingJob } from '../../../../../backend/services/publishingJobService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : null;
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });
  const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  try {
    const result = await requeueDeadLetteredPublishingJob({
      jobId,
      companyId,
      actorUserId: (access as { userId?: string }).userId ?? null,
      confirmOutcomeUnknown: req.body?.confirm_outcome_unknown === true,
    });
    if (result.ok === true) return res.status(200).json({ retried: true, outcome_unknown: result.outcome_unknown });
    const refused = result as Extract<typeof result, { ok: false }>;
    return res.status(refused.code === 'NOT_FOUND' ? 404 : 409).json({ retried: false, code: refused.code, error: refused.message });
  } catch (err) {
    console.error('[blogs/publishing-jobs/retry] failed', err instanceof Error ? err.message : err);
    return res.status(500).json({ retried: false, error: 'Could not retry the publish. Please try again.' });
  }
}

export default __createApiRoute(handler, { route: '/api/blogs/publishing-jobs/:jobId/retry' });
