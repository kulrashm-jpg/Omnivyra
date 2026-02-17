/**
 * GET /api/governance/company-drift
 * Stage 25 — Company-wide drift detection. Read-only.
 * Stage 28: Latest audit status from governance_audit_runs.
 * RBAC: COMPANY_ADMIN minimum.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { getCompanyGovernanceAnalytics } from '../../../backend/services/GovernanceAnalyticsService';
import { isGovernanceLocked } from '../../../backend/services/GovernanceLockdownService';
import { supabase } from '../../../backend/db/supabaseClient';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const [analytics, locked] = await Promise.all([
    getCompanyGovernanceAnalytics(companyId),
    isGovernanceLocked(),
  ]);

  let auditStatus: 'OK' | 'WARNING' | 'CRITICAL' | null = null;
  try {
    const { data: latest } = await supabase
      .from('governance_audit_runs')
      .select('audit_status')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.audit_status) {
      auditStatus = latest.audit_status as 'OK' | 'WARNING' | 'CRITICAL';
    }
  } catch {
    /* ignore */
  }

  return res.status(200).json({
    totalCampaigns: analytics.totalCampaigns,
    verifiedCampaigns: analytics.verifiedCampaigns,
    driftedCampaigns: analytics.driftedCampaigns,
    averageReplayCoverage: analytics.averageReplayCoverage,
    integrityRiskScore: analytics.integrityRiskScore,
    auditStatus,
    locked,
    lastSnapshotAt: analytics.lastSnapshotAt,
    lastSnapshotId: analytics.lastSnapshotId,
    snapshotCount: analytics.snapshotCount,
    ledgerIntegrity: analytics.ledgerIntegrity,
    projectionStatus: analytics.projectionStatus,
    replayRateLimitedCount: analytics.replayRateLimitedCount ?? 0,
    snapshotRestoreBlockedCount: analytics.snapshotRestoreBlockedCount ?? 0,
    projectionRebuildBlockedCount: analytics.projectionRebuildBlockedCount ?? 0,
    averageRoiScore: analytics.averageRoiScore,
    highRiskCampaignsCount: analytics.highRiskCampaignsCount ?? 0,
    highPotentialCampaignsCount: analytics.highPotentialCampaignsCount ?? 0,
  });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
