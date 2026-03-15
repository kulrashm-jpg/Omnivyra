/**
 * Stage 31 — Governance Ledger Verification.
 * Validates tamper-evident hash chain. Never throws.
 */

import { supabase } from '../db/supabaseClient';
import { getCompanyCampaignIds } from '../db/campaignVersionStore';
import { computeGovernanceEventHash } from '../governance/GovernanceLedger';

export interface CampaignLedgerResult {
  valid: boolean;
  corruptedEventIds?: string[];
}

export interface CompanyLedgerResult {
  valid: boolean;
  corruptedCampaigns: string[];
}

/**
 * Verify campaign governance event ledger. Recomputes hashes and validates chain.
 * Never throws.
 */
export async function verifyCampaignLedger(campaignId: string): Promise<CampaignLedgerResult> {
  try {
    const { data: events, error } = await supabase
      .from('campaign_governance_events')
      .select('id, campaign_id, event_type, event_status, metadata, policy_version, policy_hash, event_hash, previous_event_hash, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });

    if (error || !events || events.length === 0) {
      return { valid: true };
    }

    const corruptedEventIds: string[] = [];
    let prevHash: string | null = null;

    for (const e of events as any[]) {
      const storedPrevHash = e.previous_event_hash ?? null;
      if (storedPrevHash !== prevHash) {
        corruptedEventIds.push(e.id);
      }

      const computedHash = computeGovernanceEventHash({
        campaignId: e.campaign_id,
        eventType: e.event_type,
        eventStatus: e.event_status,
        metadata: e.metadata ?? {},
        policyVersion: e.policy_version ?? '1.0.0',
        policyHash: e.policy_hash ?? '',
        previousEventHash: prevHash,
      });

      if ((e.event_hash ?? '') !== computedHash) {
        corruptedEventIds.push(e.id);
      }

      prevHash = computedHash;
    }

    return {
      valid: corruptedEventIds.length === 0,
      corruptedEventIds: corruptedEventIds.length > 0 ? corruptedEventIds : undefined,
    };
  } catch {
    return { valid: false, corruptedEventIds: [] };
  }
}

/**
 * Verify company-wide ledger. Aggregates campaign checks.
 * Never throws.
 */
export async function verifyCompanyLedger(companyId: string): Promise<CompanyLedgerResult> {
  try {
    const campaignIds = await getCompanyCampaignIds(companyId);
    const corruptedCampaigns: string[] = [];

    for (const cid of campaignIds) {
      const result = await verifyCampaignLedger(cid);
      if (!result.valid) {
        corruptedCampaigns.push(cid);
      }
    }

    return {
      valid: corruptedCampaigns.length === 0,
      corruptedCampaigns,
    };
  } catch {
    return { valid: false, corruptedCampaigns: [] };
  }
}
