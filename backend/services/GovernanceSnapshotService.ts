/**
 * Stage 30 — Governance Disaster Recovery & Snapshot Restoration.
 * Snapshot and restore governance layer only. No evaluation, scheduler, or state machine changes.
 */

import { supabase } from '../db/supabaseClient';
import { GOVERNANCE_POLICY_VERSION, getGovernancePolicyHash } from '../governance/GovernancePolicy';
import { computeGovernanceEventHash } from '../governance/GovernanceLedger';
import { recordGovernanceEvent } from './GovernanceEventService';
import { rebuildGovernanceProjection } from './GovernanceProjectionService';
import { tryAcquireRestoreLock, releaseRestoreLock } from './GovernanceRateLimiter';

export class SnapshotRestoreInProgressError extends Error {
  code = 'SNAPSHOT_RESTORE_IN_PROGRESS';
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotRestoreInProgressError';
  }
}

export class SnapshotPolicyMismatchError extends Error {
  code = 'SNAPSHOT_POLICY_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotPolicyMismatchError';
  }
}

export interface GovernanceSnapshotResult {
  snapshotId: string;
  companyId: string;
  snapshotType: 'FULL' | 'CAMPAIGN' | 'COMPANY';
  policyVersion: string;
  policyHash: string;
}

interface SnapshotData {
  timestamp: string;
  policy_version: string;
  policy_hash: string;
  governance_lockdown: any[];
  governance_audit_runs: any[];
  campaign_governance_events: any[];
  summary: { eventCount: number; auditCount: number; policyHash: string };
}

async function getCompanyCampaignIds(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId);
  if (error) return [];
  return Array.from(new Set((data || []).map((r: any) => r.campaign_id).filter(Boolean)));
}

/**
 * Create a governance snapshot. No mutations to campaigns.
 */
export async function createGovernanceSnapshot(params: {
  companyId: string;
  campaignId?: string;
  snapshotType: 'FULL' | 'CAMPAIGN' | 'COMPANY';
  userId?: string;
}): Promise<GovernanceSnapshotResult> {
  const { companyId, campaignId, snapshotType, userId } = params;
  const policyVersion = GOVERNANCE_POLICY_VERSION;
  const policyHash = getGovernancePolicyHash();
  const timestamp = new Date().toISOString();

  let campaignIds: string[] = [];
  if (snapshotType === 'CAMPAIGN' && campaignId) {
    campaignIds = [campaignId];
  } else {
    campaignIds = await getCompanyCampaignIds(companyId);
  }

  const { data: lockdownRows } = await supabase
    .from('governance_lockdown')
    .select('*')
    .limit(10);

  const { data: auditRows } = await supabase
    .from('governance_audit_runs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  let events: any[] = [];
  if (campaignIds.length > 0) {
    const { data: eventRows } = await supabase
      .from('campaign_governance_events')
      .select('*')
      .in('campaign_id', campaignIds)
      .order('created_at', { ascending: true });
    events = eventRows || [];
  }

  const snapshotData: SnapshotData = {
    timestamp,
    policy_version: policyVersion,
    policy_hash: policyHash,
    governance_lockdown: (lockdownRows as any) || [],
    governance_audit_runs: (auditRows as any) || [],
    campaign_governance_events: events,
    summary: {
      eventCount: events.length,
      auditCount: (auditRows as any)?.length ?? 0,
      policyHash,
    },
  };

  const { data: inserted, error } = await supabase
    .from('governance_snapshots')
    .insert({
      company_id: companyId,
      snapshot_type: snapshotType,
      campaign_id: campaignId || null,
      snapshot_data: snapshotData,
      policy_version: policyVersion,
      policy_hash: policyHash,
      created_by: userId || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create snapshot: ${error.message}`);
  if (!inserted?.id) throw new Error('Snapshot insert returned no id');

  return {
    snapshotId: (inserted as any).id,
    companyId,
    snapshotType,
    policyVersion,
    policyHash,
  };
}

/**
 * Restore governance layer from snapshot. SUPER_ADMIN only (enforced in API).
 * Does NOT unlock, does NOT modify execution state, does NOT run evaluation/scheduler.
 */
export async function restoreGovernanceSnapshot(snapshotId: string): Promise<{ restored: boolean }> {
  const { data: snapshot, error: fetchError } = await supabase
    .from('governance_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .single();

  if (fetchError || !snapshot) {
    throw new Error('Snapshot not found');
  }

  const currentHash = getGovernancePolicyHash();
  const snapshotHash = (snapshot as any).policy_hash || '';
  if (snapshotHash !== currentHash) {
    throw new SnapshotPolicyMismatchError(
      `Snapshot policy hash (${snapshotHash.slice(0, 8)}) does not match current policy (${currentHash.slice(0, 8)})`
    );
  }

  const data = (snapshot as any).snapshot_data as SnapshotData;
  const companyId = (snapshot as any).company_id;
  const snapshotType = (snapshot as any).snapshot_type;
  const campaignId = (snapshot as any).campaign_id;

  if (!data) throw new Error('Snapshot data missing');

  if (!tryAcquireRestoreLock(companyId)) {
    throw new SnapshotRestoreInProgressError(
      'A snapshot restore is already in progress for this company'
    );
  }

  const eventRows = data.campaign_governance_events || [];

  try {
    await doRestore(data, companyId, snapshotType, campaignId, snapshotId, eventRows);
    return { restored: true };
  } finally {
    releaseRestoreLock(companyId);
  }
}

async function doRestore(
  data: SnapshotData,
  companyId: string,
  snapshotType: string,
  campaignId: string | null,
  snapshotId: string,
  eventRows: any[]
): Promise<void> {
  const lockdownRows = data.governance_lockdown || [];
  const auditRows = data.governance_audit_runs || [];

  if (lockdownRows.length > 0) {
    const row = lockdownRows[0];
    const existing = await supabase.from('governance_lockdown').select('id').limit(1).maybeSingle();
    const payload = {
      locked: row.locked ?? false,
      reason: row.reason ?? null,
      triggered_at: row.triggered_at ?? null,
      triggered_by: row.triggered_by ?? null,
      resolved_at: row.resolved_at ?? null,
      resolved_by: row.resolved_by ?? null,
    };
    if ((existing.data as any)?.id) {
      await supabase.from('governance_lockdown').update(payload).eq('id', (existing.data as any).id);
    } else {
      await supabase.from('governance_lockdown').insert({
        id: row.id || '00000000-0000-0000-0000-000000000001',
        ...payload,
      });
    }
  }

  await supabase.from('governance_audit_runs').delete().eq('company_id', companyId);
  if (auditRows.length > 0) {
    const inserts = auditRows.map((r: any) => ({
      company_id: r.company_id ?? companyId,
      campaigns_scanned: r.campaigns_scanned ?? 0,
      drifted_campaigns: r.drifted_campaigns ?? 0,
      policy_upgrade_campaigns: r.policy_upgrade_campaigns ?? 0,
      average_replay_coverage: r.average_replay_coverage ?? 0,
      integrity_risk_score: r.integrity_risk_score ?? 0,
      audit_status: r.audit_status ?? 'OK',
      created_at: r.created_at ?? new Date().toISOString(),
    }));
    await supabase.from('governance_audit_runs').insert(inserts);
  }

  const scopeCampaignIds = eventRows.length > 0
    ? [...new Set(eventRows.map((e: any) => e.campaign_id).filter(Boolean))]
    : [];
  if (scopeCampaignIds.length > 0) {
    await supabase.from('campaign_governance_events').delete().in('campaign_id', scopeCampaignIds);
  }
  if (eventRows.length > 0) {
    const byCampaign = new Map<string, any[]>();
    for (const e of eventRows as any[]) {
      const cid = e.campaign_id || '';
      if (!byCampaign.has(cid)) byCampaign.set(cid, []);
      byCampaign.get(cid)!.push(e);
    }
    const inserts: any[] = [];
    for (const [, rows] of byCampaign) {
      const sorted = [...rows].sort(
        (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
      let prevHash: string | null = null;
      for (const e of sorted) {
        const eventHash = computeGovernanceEventHash({
          campaignId: e.campaign_id,
          eventType: e.event_type,
          eventStatus: e.event_status,
          metadata: e.metadata ?? {},
          policyVersion: e.policy_version ?? GOVERNANCE_POLICY_VERSION,
          policyHash: e.policy_hash ?? '',
          previousEventHash: prevHash,
        });
        inserts.push({
          company_id: e.company_id,
          campaign_id: e.campaign_id,
          event_type: e.event_type,
          event_status: e.event_status,
          metadata: e.metadata ?? {},
          policy_version: e.policy_version ?? GOVERNANCE_POLICY_VERSION,
          policy_hash: e.policy_hash ?? '',
          event_hash: eventHash,
          previous_event_hash: prevHash,
          created_at: e.created_at ?? new Date().toISOString(),
        });
        prevHash = eventHash;
      }
    }
    await supabase.from('campaign_governance_events').insert(inserts);
    for (const cid of scopeCampaignIds) {
      rebuildGovernanceProjection(cid).catch(() => {});
    }
  }

  await recordGovernanceEvent({
    companyId: companyId,
    campaignId: campaignId || '00000000-0000-0000-0000-000000000000',
    eventType: 'GOVERNANCE_SNAPSHOT_RESTORED',
    eventStatus: 'RESTORED',
    metadata: {
      snapshotId,
      restoredAt: new Date().toISOString(),
      companyId,
      snapshotType,
    },
  });
}

/**
 * Verify snapshot integrity. Never throws.
 */
export async function verifySnapshotIntegrity(snapshotId: string): Promise<{
  valid: boolean;
  mismatchFields?: string[];
}> {
  try {
    const { data: snapshot, error } = await supabase
      .from('governance_snapshots')
      .select('snapshot_data, policy_hash')
      .eq('id', snapshotId)
      .single();

    if (error || !snapshot) {
      return { valid: false, mismatchFields: ['snapshot_not_found'] };
    }

    const data = (snapshot as any).snapshot_data as SnapshotData;
    const snapshotHash = (snapshot as any).policy_hash;
    const currentHash = getGovernancePolicyHash();

    const mismatches: string[] = [];
    if (data?.summary) {
      const actualEventCount = (data.campaign_governance_events || []).length;
      const expectedEventCount = data.summary.eventCount ?? 0;
      if (actualEventCount !== expectedEventCount) {
        mismatches.push('eventCount');
      }
      const actualAuditCount = (data.governance_audit_runs || []).length;
      const expectedAuditCount = data.summary.auditCount ?? 0;
      if (actualAuditCount !== expectedAuditCount) {
        mismatches.push('auditCount');
      }
      if ((data.summary.policyHash || '') !== (snapshotHash || '')) {
        mismatches.push('summaryPolicyHash');
      }
    }
    if ((snapshotHash || '') !== currentHash) {
      mismatches.push('policyHash');
    }

    return {
      valid: mismatches.length === 0,
      mismatchFields: mismatches.length > 0 ? mismatches : undefined,
    };
  } catch {
    return { valid: false, mismatchFields: ['verification_failed'] };
  }
}
