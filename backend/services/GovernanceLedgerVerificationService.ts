/**
 * Stage 31 — Governance Ledger Verification.
 * Validates tamper-evident hash chain. Never throws.
 *
 * unread-error pkg 2 (e9, value-for-unreadable rule): a ledger that could not be READ is neither valid
 * nor corrupted. It used to be both, depending on where it failed: a failed events read answered
 * valid:true (nothing checked, reported intact), and a failed campaign-list read or any throw answered
 * valid:false (reported as CORRUPTION). Each result now carries status 'verified' | 'corrupted' |
 * 'unverifiable'; valid is true only for 'verified'.
 */

import { supabase } from '../db/supabaseClient';
import { getCompanyCampaignIds } from '../db/campaignVersionStore';
import { computeGovernanceEventHash } from '../governance/GovernanceLedger';

export type LedgerStatus = 'verified' | 'corrupted' | 'unverifiable';

export interface CampaignLedgerResult {
  valid: boolean;
  status: LedgerStatus;
  corruptedEventIds?: string[];
}

export interface CompanyLedgerResult {
  valid: boolean;
  status: LedgerStatus;
  corruptedCampaigns: string[];
  /** Campaigns whose ledger could not be read (not checked, not corrupted). */
  unverifiableCampaigns: string[];
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

    if (error) {
      return { valid: false, status: 'unverifiable' };
    }
    if (!events || events.length === 0) {
      return { valid: true, status: 'verified' };
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

    const corrupted = corruptedEventIds.length > 0;
    return {
      valid: !corrupted,
      status: corrupted ? 'corrupted' : 'verified',
      corruptedEventIds: corrupted ? corruptedEventIds : undefined,
    };
  } catch {
    return { valid: false, status: 'unverifiable' };
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
    const unverifiableCampaigns: string[] = [];

    for (const cid of campaignIds) {
      const result = await verifyCampaignLedger(cid);
      if (result.status === 'corrupted') corruptedCampaigns.push(cid);
      else if (result.status === 'unverifiable') unverifiableCampaigns.push(cid);
    }

    // Corruption found anywhere is reported as corruption; otherwise any unread campaign makes the
    // whole company unverifiable (never "valid" with campaigns left unchecked).
    const status: LedgerStatus = corruptedCampaigns.length > 0 ? 'corrupted'
      : unverifiableCampaigns.length > 0 ? 'unverifiable' : 'verified';
    return { valid: status === 'verified', status, corruptedCampaigns, unverifiableCampaigns };
  } catch {
    // The campaign list itself could not be read (getCompanyCampaignIds now throws on a failed read).
    return { valid: false, status: 'unverifiable', corruptedCampaigns: [], unverifiableCampaigns: [] };
  }
}
