import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildEnterpriseReadinessReport } from '../../../backend/services/intelligence/enterpriseReadinessService';
import { getMaturityHistory } from '../../../backend/services/intelligence/maturitySnapshotService';
import { buildPredictiveReport } from '../../../backend/services/intelligence/predictiveOpsService';
import { buildEffectivenessReport } from '../../../backend/services/intelligence/recommendationEffectivenessService';
import { recordComplianceAudit } from '../../../backend/services/audit/complianceAuditService';
import { ownedDbTable } from '../../../backend/db/writeOwner';

/**
 * READ-ONLY executive scorecard — composes existing read-only services into a
 * single KPI/scorecard view (no new data layer, no mutation). Export-safe,
 * RBAC + tenant-scoped, operationally actionable.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({
    req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    // GET ?list=reports → return report lineage (snapshots of prior captures).
    if (req.method === 'GET' && req.query.list === 'reports') {
      const { data } = await ownedDbTable('audit_events')
        .select('resource_id, metadata, created_at')
        .eq('company_id', companyId)
        .eq('resource_type', 'executive_report')
        .order('created_at', { ascending: false })
        .limit(100);
      return res.status(200).json({ reports: (data ?? []) as any[] });
    }

    const [readiness, maturity, predictive, effectiveness] = await Promise.all([
      buildEnterpriseReadinessReport(companyId).catch(() => null),
      getMaturityHistory(companyId).catch(() => null),
      buildPredictiveReport(companyId).catch(() => null),
      buildEffectivenessReport(companyId).catch(() => null),
    ]);
    const body = {
      companyId,
      generatedAt: new Date().toISOString(),
      scorecard: {
        maturityScore: readiness?.operationalMaturityScore ?? null,
        grades: (readiness as any)?.grades ?? null,
        maturityTrend: maturity?.trend ?? null,
        readinessDrift: maturity?.drift ?? null,
        adaptiveOverall: effectiveness?.overallEffectiveness ?? null,
        criticalBlockers: (readiness as any)?.unresolvedCriticalBlockers ?? readiness?.unresolvedEnterpriseBlockers ?? [],
      },
      forecasts: predictive?.forecasts ?? [],
      kpiHistory: (maturity?.snapshots ?? []).slice(-30),
    };

    // POST captures an append-only report lineage entry (export-friendly).
    if (req.method === 'POST') {
      await recordComplianceAudit({
        companyId,
        actor: { userId: roleGate.userId, type: 'user', label: 'executive-report' },
        action: 'executive_report.captured',
        resourceType: 'executive_report',
        resourceId: companyId,
        severity: 'info',
        entityLineage: ['company', 'executive_report'],
        detail: body.scorecard,
      }).catch(() => undefined);
    }

    return res.status(200).json(body);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build executive scorecard' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/executive-scorecard' });
