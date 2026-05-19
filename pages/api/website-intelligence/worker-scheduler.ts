import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { runSchedulerTick } from '../../../backend/services/intelligence/workerSchedulerService';

/**
 * Autonomous worker scheduler TICK. Designed to be invoked by an external
 * scheduler/cron (not auto-registered into the stable scheduler). Atomic-
 * leased + cooldown + escalation telemetry inside the service.
 * POST /api/website-intelligence/worker-scheduler { company_id, force? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId =
    typeof req.body?.company_id === 'string' ? req.body.company_id :
    typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    const result = await runSchedulerTick({
      companyId,
      actorUserId: roleGate.userId,
      force: req.body?.force === true,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Scheduler tick failed' });
  }
}
