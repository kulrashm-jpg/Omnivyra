import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildEnterpriseReadinessReport } from '../../../backend/services/intelligence/enterpriseReadinessService';
import { buildEffectivenessReport } from '../../../backend/services/intelligence/recommendationEffectivenessService';
import { buildSecurityTelemetry } from '../../../backend/services/intelligence/securityTelemetryService';
import { getWorkerHealth } from '../../../backend/services/intelligence/workerOrchestrationService';
import { listReplayPayloads, listQuarantine } from '../../../backend/services/intelligence/rawReplayCaptureService';
import { runRealCoordinationValidation } from '../../../backend/services/intelligence/realCoordinationValidationService';
import { ownedDbTable } from '../../../backend/db/writeOwner';

/** Real escalation-drift trend from append-only audit telemetry. */
async function escalationTrend(companyId: string): Promise<{ last24h: number; prev24h: number; drift: 'up' | 'down' | 'flat' }> {
  const now = Date.now();
  const d1 = new Date(now - 24 * 3600_000).toISOString();
  const d2 = new Date(now - 48 * 3600_000).toISOString();
  const countBetween = async (gte: string, lt: string) => {
    try {
      const { count } = await ownedDbTable('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('resource_type', 'worker_escalation')
        .gte('created_at', gte)
        .lt('created_at', lt);
      return typeof count === 'number' ? count : 0;
    } catch { return 0; }
  };
  const last24h = await countBetween(d1, new Date(now).toISOString());
  const prev24h = await countBetween(d2, d1);
  return { last24h, prev24h, drift: last24h > prev24h ? 'up' : last24h < prev24h ? 'down' : 'flat' };
}

/**
 * Consolidated, READ-ONLY operational report (resilience / replay integrity /
 * orchestration health / security / adaptive / worker reliability). Composes
 * existing read-only services — no new data layer, no mutation. Optional
 * ?validate=1 additionally runs the isolated REAL coordination validation.
 * Export-safe (plain JSON), RBAC + tenant-scoped.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  try {
    const [readiness, effectiveness, security, workers, replayPayloads, quarantine] = await Promise.all([
      buildEnterpriseReadinessReport(companyId).catch(() => null),
      buildEffectivenessReport(companyId).catch(() => null),
      buildSecurityTelemetry(companyId).catch(() => null),
      getWorkerHealth(companyId).catch(() => []),
      listReplayPayloads(companyId).catch(() => []),
      listQuarantine(companyId).catch(() => []),
    ]);
    const coordination =
      req.query.validate === '1'
        ? await runRealCoordinationValidation(companyId).catch(() => null)
        : null;

    return res.status(200).json({
      companyId,
      generatedAt: new Date().toISOString(),
      resilience: { maturity: readiness?.operationalMaturityScore ?? null, grades: (readiness as any)?.grades ?? null, blockers: (readiness as any)?.unresolvedCriticalBlockers ?? readiness?.unresolvedEnterpriseBlockers ?? [] },
      replayIntegrity: { capturedPending: replayPayloads.filter((p: any) => p.status === 'pending').length, captured: replayPayloads.length, quarantined: quarantine.length },
      orchestrationHealth: { workers, coordination },
      security: security ? { anomalies: security.anomalies.length, replayAbuse: security.replayAbuseSuspected, advisories: security.advisories } : null,
      adaptiveOptimization: effectiveness ? { overall: effectiveness.overallEffectiveness, byCategory: effectiveness.byCategory, evolution: effectiveness.evolution } : null,
      workerReliability: { count: workers.length, failed: workers.filter((w: any) => w.status === 'failed').length },
      operationalTrend: await escalationTrend(companyId),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build operational report' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/operational-report' });
