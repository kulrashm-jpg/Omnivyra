/**
 * Stage 28 — Autonomous Governance Audit & Drift Scanner.
 * Orchestration + automation only. No evaluation, replay, or campaign mutation.
 */

import { supabase } from '../db/supabaseClient';

const COMPANY_AUDIT_CAMPAIGN_SENTINEL = '00000000-0000-0000-0000-000000000000';
const SYSTEM_AUDIT_USER_ID = '00000000-0000-0000-0000-000000000000';
import { getCompanyGovernanceAnalytics } from './GovernanceAnalyticsService';
import { recordGovernanceEvent } from './GovernanceEventService';
import { triggerGovernanceLock } from './GovernanceLockdownService';

export interface GovernanceAuditResult {
  companyId: string;
  campaignsScanned: number;
  driftedCampaigns: number;
  policyUpgradeCampaigns: number;
  averageReplayCoverage: number;
  integrityRiskScore: number;
  auditStatus: 'OK' | 'WARNING' | 'CRITICAL';
}

const DEFAULT_RESULT: GovernanceAuditResult = {
  companyId: '',
  campaignsScanned: 0,
  driftedCampaigns: 0,
  policyUpgradeCampaigns: 0,
  averageReplayCoverage: 0,
  integrityRiskScore: 0,
  auditStatus: 'OK',
};

function deriveAuditStatus(integrityRiskScore: number): 'OK' | 'WARNING' | 'CRITICAL' {
  if (integrityRiskScore >= 60) return 'CRITICAL';
  if (integrityRiskScore >= 30) return 'WARNING';
  return 'OK';
}

/**
 * Run governance audit for a company. Never throws.
 * Uses analytics layer only. No campaign mutation.
 */
export async function runGovernanceAudit(companyId: string): Promise<GovernanceAuditResult> {
  try {
    if (!companyId || typeof companyId !== 'string') {
      return { ...DEFAULT_RESULT, companyId: companyId || '' };
    }

    const analytics = await getCompanyGovernanceAnalytics(companyId);

    const campaignsScanned = analytics.totalCampaigns ?? 0;
    const driftedCampaigns = analytics.driftedCampaigns ?? 0;
    const policyUpgradeCampaigns = analytics.policyUpgradeCampaigns ?? 0;
    const averageReplayCoverage = analytics.averageReplayCoverage ?? 0;
    const integrityRiskScore = Math.round(analytics.integrityRiskScore ?? 0);
    const auditStatus = deriveAuditStatus(integrityRiskScore);

    if (integrityRiskScore >= 75) {
      try {
        await triggerGovernanceLock('Integrity risk exceeded threshold', SYSTEM_AUDIT_USER_ID);
      } catch (lockErr) {
        console.error('GovernanceAuditService: auto-lock failed', lockErr);
      }
    }

    const result: GovernanceAuditResult = {
      companyId,
      campaignsScanned,
      driftedCampaigns,
      policyUpgradeCampaigns,
      averageReplayCoverage,
      integrityRiskScore,
      auditStatus,
    };

    const { error: insertError } = await supabase.from('governance_audit_runs').insert({
      company_id: companyId,
      campaigns_scanned: campaignsScanned,
      drifted_campaigns: driftedCampaigns,
      policy_upgrade_campaigns: policyUpgradeCampaigns,
      average_replay_coverage: averageReplayCoverage,
      integrity_risk_score: integrityRiskScore,
      audit_status: auditStatus,
    });

    if (insertError) {
      const isTableMissing =
        insertError.code === 'PGRST205' ||
        (insertError.message?.toLowerCase().includes('could not find the table') ?? false);
      if (isTableMissing && !(globalThis as any).__governance_audit_runs_migration_hint_shown) {
        (globalThis as any).__governance_audit_runs_migration_hint_shown = true;
        console.warn(
          'GovernanceAuditService: governance_audit_runs table not found. Run database/governance_audit_runs.sql to create it.'
        );
      } else if (!isTableMissing) {
        console.error('GovernanceAuditService: failed to persist audit run', insertError);
      }
      return result;
    }

    await recordGovernanceEvent({
      companyId,
      campaignId: COMPANY_AUDIT_CAMPAIGN_SENTINEL,
      eventType: 'GOVERNANCE_AUDIT_COMPLETED',
      eventStatus: auditStatus,
      metadata: {
        campaignsScanned,
        driftedCampaigns,
        policyUpgradeCampaigns,
        averageReplayCoverage,
        integrityRiskScore,
      },
    });

    if (auditStatus === 'CRITICAL') {
      await recordGovernanceEvent({
        companyId,
        campaignId: COMPANY_AUDIT_CAMPAIGN_SENTINEL,
        eventType: 'GOVERNANCE_AUDIT_ALERT',
        eventStatus: 'CRITICAL',
        metadata: {
          campaignsScanned,
          driftedCampaigns,
          policyUpgradeCampaigns,
          averageReplayCoverage,
          integrityRiskScore,
        },
      });
    }

    return result;
  } catch (err) {
    console.error('GovernanceAuditService: runGovernanceAudit failed', err);
    return {
      ...DEFAULT_RESULT,
      companyId,
    };
  }
}
