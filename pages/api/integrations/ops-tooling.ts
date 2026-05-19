import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { validateIntegration } from '../../../backend/services/integrationService';
import { normalizeCmsConnections } from '../../../backend/services/cms/cmsConnectionNormalizationService';
import { runSelfHeal } from '../../../backend/services/intelligence/selfHealOrchestrator';
import { buildTrackingDiagnostics } from '../../../backend/services/intelligence/trackingDiagnosticsService';
import { recordComplianceAudit, newCorrelationId } from '../../../backend/services/audit/complianceAuditService';

/**
 * RBAC-protected operational tooling. EVERY action maps to a pre-existing,
 * idempotent, rate-limited primitive — no new mutation path is introduced.
 * Actions that would touch live write/queue paths (replay publish, replay
 * ingestion event, queue retry, re-run reconciliation) are intentionally
 * NOT exposed here (regression risk) and reported as unimplemented.
 *
 * In-memory audit + per-(company,action) rate limit. POST only.
 */
type Action =
  | 'revalidate_connection'
  | 'force_api_rediscovery'
  | 'run_normalization'
  | 'self_heal'
  | 'tracker_validation';

const SAFE_ACTIONS: Action[] = [
  'revalidate_connection',
  'force_api_rediscovery',
  'run_normalization',
  'self_heal',
  'tracker_validation',
];

const RATE_MS = 30_000;
const rateKey = new Map<string, number>();
const auditLog: Array<{
  at: string; companyId: string; userId: string; action: string; ok: boolean; detail: string;
}> = [];

function rateLimited(companyId: string, action: string): boolean {
  const k = `${companyId}:${action}`;
  const last = rateKey.get(k) ?? 0;
  if (Date.now() - last < RATE_MS) return true;
  rateKey.set(k, Date.now());
  return false;
}

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

  const action = req.body?.action as Action | undefined;
  if (!action || !SAFE_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${SAFE_ACTIONS.join(', ')}` });
  }
  if (rateLimited(companyId, action)) {
    return res.status(429).json({ error: 'Rate limited — retry shortly.' });
  }

  const userId = roleGate.userId;
  const correlationId = newCorrelationId('ops');
  const audit = async (ok: boolean, detail: string) => {
    // Fast in-memory tail (response convenience) + durable compliance record.
    auditLog.unshift({ at: new Date().toISOString(), companyId, userId, action, ok, detail });
    if (auditLog.length > 200) auditLog.pop();
    await recordComplianceAudit({
      companyId,
      actor: { userId, type: 'user', label: 'ops-tooling' },
      action: `ops_tooling.${action}`,
      resourceType: 'integration_ops',
      resourceId: typeof req.body?.integration_id === 'string' ? req.body.integration_id : companyId,
      correlationId,
      entityLineage: ['company', 'integration_ops', action],
      outcome: ok ? 'success' : 'failure',
      detail: { detail },
    }).catch(() => undefined);
  };

  try {
    let result: unknown;
    switch (action) {
      case 'revalidate_connection':
      case 'force_api_rediscovery': {
        const id = typeof req.body?.integration_id === 'string' ? req.body.integration_id : null;
        if (!id) return res.status(400).json({ error: 'integration_id is required' });
        result = await validateIntegration(id, companyId, {
          rediscover: action === 'force_api_rediscovery',
        });
        break;
      }
      case 'run_normalization':
        result = await normalizeCmsConnections(companyId);
        break;
      case 'self_heal':
        result = await runSelfHeal(companyId, {
          includeNormalization: req.body?.include_normalization === true,
          force: req.body?.force === true,
        });
        break;
      case 'tracker_validation':
        result = await buildTrackingDiagnostics(companyId);
        break;
    }
    await audit(true, action);
    return res.status(200).json({ ok: true, action, result, correlationId, auditTail: auditLog.slice(0, 10) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown';
    await audit(false, detail);
    return res.status(500).json({ ok: false, action, error: detail, correlationId });
  }
}
