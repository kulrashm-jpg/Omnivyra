/**
 * Stage 28 — Autonomous Governance Audit Job.
 * Stage 33: Single execution lock — if already running, skip and log.
 * Scans all companies with campaigns. Callable from cron/worker.
 * Do NOT auto-register. No campaign mutations.
 */

import { supabase } from '../db/supabaseClient';
import { runGovernanceAudit } from '../services/GovernanceAuditService';
import type { GovernanceAuditResult } from '../services/GovernanceAuditService';

let auditJobRunning = false;

/**
 * Run governance audit for all companies that have campaigns.
 * Loads distinct company_id from campaign_versions.
 * Never throws. Safe under partial failure.
 * Stage 33: If already running, skip and log.
 */
export async function runAllCompanyAudits(): Promise<void> {
  if (auditJobRunning) {
    console.log('GovernanceAuditJob: skipped — already running');
    return;
  }
  auditJobRunning = true;
  try {
    const { data, error } = await supabase
      .from('campaign_versions')
      .select('company_id');

    if (error) {
      console.error('GovernanceAuditJob: failed to load companies', error);
      return;
    }

    const companyIds = Array.from(
      new Set((data || []).map((r: any) => r.company_id).filter(Boolean))
    );

    if (companyIds.length === 0) {
      console.log('GovernanceAuditJob: no companies with campaigns');
      return;
    }

    const results: GovernanceAuditResult[] = [];
    for (const companyId of companyIds) {
      try {
        const result = await runGovernanceAudit(companyId);
        results.push(result);
      } catch (err) {
        console.error('GovernanceAuditJob: audit failed for company', companyId, err);
      }
    }

    const critical = results.filter((r) => r.auditStatus === 'CRITICAL').length;
    const warning = results.filter((r) => r.auditStatus === 'WARNING').length;
    const ok = results.filter((r) => r.auditStatus === 'OK').length;
    console.log('GovernanceAuditJob: completed', {
      total: results.length,
      ok,
      warning,
      critical,
    });
  } catch (err) {
    console.error('GovernanceAuditJob: runAllCompanyAudits failed', err);
  } finally {
    auditJobRunning = false;
  }
}
