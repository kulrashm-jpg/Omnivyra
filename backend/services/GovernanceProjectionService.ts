/**
 * Stage 32 — Governance Read Model & Performance Isolation Layer.
 * Denormalized projection updated on event writes. Purely counters — no business logic.
 * Never throws (log only).
 */

import { supabase } from '../db/supabaseClient';
import { tryAcquireRebuildLock, releaseRebuildLock } from './GovernanceRateLimiter';

export interface GovernanceEventRow {
  campaign_id: string;
  company_id: string;
  event_type: string;
  event_status: string;
  metadata?: Record<string, any>;
  policy_version?: string;
  policy_hash?: string;
  created_at?: string;
}

const NEGOTIATION_TYPES = new Set([
  'DURATION_NEGOTIATED',
  'DURATION_NEGOTIATE',
]);

const REJECTION_TYPES = new Set([
  'DURATION_REJECTED',
  'PREEMPTION_REJECTED',
  'BLUEPRINT_MUTATION_BLOCKED',
]);

const PREEMPTION_TYPES = new Set(['PREEMPTION_EXECUTED']);

const FREEZE_TYPES = new Set([
  'BLUEPRINT_FREEZE_BLOCKED',
  'EXECUTION_WINDOW_FROZEN',
  'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
]);

const SCHEDULER_TYPES = new Set([
  'SCHEDULE_STARTED',
  'SCHEDULE_COMPLETED',
]);

const EXECUTION_STATE_TRANSITION = 'EXECUTION_STATE_TRANSITION';

function normalizeEventType(t: string): string {
  return String(t || '').toUpperCase().trim();
}

/**
 * Update governance projection from a single event. Upsert, increment counters.
 * Never throws — logs errors only.
 */
export async function updateGovernanceProjectionFromEvent(event: GovernanceEventRow): Promise<void> {
  try {
    const campaignId = event.campaign_id;
    const companyId = event.company_id;
    if (!campaignId || !companyId) return;

    const eventType = normalizeEventType(event.event_type);
    const createdAt = event.created_at ?? new Date().toISOString();
    const policyVersion = event.policy_version ?? '1.0.0';
    const policyHash = event.policy_hash ?? '';

    const { data: existing, error: fetchError } = await supabase
      .from('governance_projections')
      .select('*')
      .eq('campaign_id', campaignId)
      .maybeSingle();

    if (fetchError) {
      console.error('GovernanceProjectionService: fetch failed', fetchError);
      return;
    }

    let executionStatus = (existing as any)?.execution_status ?? 'DRAFT';
    if (eventType === EXECUTION_STATE_TRANSITION && event.metadata?.to) {
      executionStatus = String(event.metadata.to);
    }

    let blueprintStatus = (existing as any)?.blueprint_status ?? null;
    if (blueprintStatus == null) {
      const { data: camp } = await supabase
        .from('campaigns')
        .select('blueprint_status, execution_status')
        .eq('id', campaignId)
        .maybeSingle();
      if (camp) {
        blueprintStatus = (camp as any).blueprint_status ?? null;
        if (executionStatus === 'DRAFT') executionStatus = (camp as any).execution_status ?? 'DRAFT';
      }
    }
    const totalEvents = ((existing as any)?.total_events ?? 0) + 1;
    const negotiationCount = ((existing as any)?.negotiation_count ?? 0) + (NEGOTIATION_TYPES.has(eventType) ? 1 : 0);
    const rejectionCount = ((existing as any)?.rejection_count ?? 0) + (REJECTION_TYPES.has(eventType) ? 1 : 0);
    const freezeBlocks = ((existing as any)?.freeze_blocks ?? 0) + (FREEZE_TYPES.has(eventType) ? 1 : 0);
    const preemptionCount = ((existing as any)?.preemption_count ?? 0) + (PREEMPTION_TYPES.has(eventType) ? 1 : 0);
    const schedulerRuns = ((existing as any)?.scheduler_runs ?? 0) + (SCHEDULER_TYPES.has(eventType) ? 1 : 0);

    const payload = {
      campaign_id: campaignId,
      company_id: companyId,
      execution_status: executionStatus,
      blueprint_status: blueprintStatus,
      total_events: totalEvents,
      negotiation_count: negotiationCount,
      rejection_count: rejectionCount,
      freeze_blocks: freezeBlocks,
      preemption_count: preemptionCount,
      scheduler_runs: schedulerRuns,
      drift_detected: (existing as any)?.drift_detected ?? false,
      replay_coverage_ratio: (existing as any)?.replay_coverage_ratio ?? 0,
      policy_version: policyVersion,
      policy_hash: policyHash,
      last_event_at: createdAt,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from('governance_projections')
      .upsert(payload, { onConflict: 'campaign_id' });

    if (upsertError) {
      console.error('GovernanceProjectionService: upsert failed', upsertError);
    }
  } catch (err) {
    console.error('GovernanceProjectionService: updateGovernanceProjectionFromEvent failed', err);
  }
}

/** Projection status for UI. */
export type ProjectionStatus = 'ACTIVE' | 'REBUILDING' | 'MISSING';

/**
 * Get projection status for a campaign. Never throws.
 */
export async function getProjectionStatus(campaignId: string): Promise<ProjectionStatus> {
  try {
    const { data, error } = await supabase
      .from('governance_projections')
      .select('rebuilding_since')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    if (error || !data) return 'MISSING';
    return (data as any).rebuilding_since ? 'REBUILDING' : 'ACTIVE';
  } catch {
    return 'MISSING';
  }
}

/**
 * Rebuild governance projection for a campaign. Scans events, recomputes deterministically.
 * Used for drift correction, snapshot restore reconciliation, manual admin repair.
 */
export async function rebuildGovernanceProjection(campaignId: string): Promise<void> {
  try {
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id, execution_status, blueprint_status')
      .eq('id', campaignId)
      .maybeSingle();

    if (campErr || !campaign) {
      console.error('GovernanceProjectionService: rebuild campaign not found', campErr);
      return;
    }

    const { data: cv } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .maybeSingle();
    const companyId = (cv as any)?.company_id;
    if (!companyId) return;

    if (!tryAcquireRebuildLock(campaignId, companyId)) {
      return; // rebuild already in progress, exit silently
    }

    try {
      await doRebuild(campaignId, companyId, campaign as any);
    } finally {
      releaseRebuildLock(campaignId);
    }
  } catch (err) {
    console.error('GovernanceProjectionService: rebuildGovernanceProjection failed', err);
  }
}

async function doRebuild(
  campaignId: string,
  companyId: string,
  campaign: { execution_status?: string; blueprint_status?: string }
): Promise<void> {
  await supabase
    .from('governance_projections')
    .upsert(
    { campaign_id: campaignId, company_id: companyId, rebuilding_since: new Date().toISOString() },
    { onConflict: 'campaign_id' }
  );

  const { data: events, error: evErr } = await supabase
    .from('campaign_governance_events')
    .select('event_type, event_status, metadata, created_at, policy_version, policy_hash')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  const evts = evErr ? [] : (events || []);
  let executionStatus = campaign?.execution_status ?? 'DRAFT';
  let negotiationCount = 0;
  let rejectionCount = 0;
  let freezeBlocks = 0;
  let preemptionCount = 0;
  let schedulerRuns = 0;
  let lastEventAt: string | null = null;
  let policyVersion = '1.0.0';
  let policyHash = '';
  let replayableCount = 0;

  for (const e of evts) {
    const t = normalizeEventType((e as any).event_type);
    if (NEGOTIATION_TYPES.has(t)) negotiationCount++;
    if (REJECTION_TYPES.has(t)) rejectionCount++;
    if (FREEZE_TYPES.has(t)) freezeBlocks++;
    if (PREEMPTION_TYPES.has(t)) preemptionCount++;
    if (SCHEDULER_TYPES.has(t)) schedulerRuns++;
    if (t === EXECUTION_STATE_TRANSITION && (e as any).metadata?.to) {
      executionStatus = String((e as any).metadata.to);
    }
    lastEventAt = (e as any).created_at ?? lastEventAt;
    if ((e as any).policy_version) policyVersion = (e as any).policy_version;
    if ((e as any).policy_hash) policyHash = (e as any).policy_hash;
    if ((e as any).metadata?.evaluation_context != null) replayableCount++;
  }

  const replayCoverageRatio = evts.length > 0 ? replayableCount / evts.length : 0;

  const payload = {
    campaign_id: campaignId,
    company_id: companyId,
    execution_status: executionStatus,
    blueprint_status: campaign?.blueprint_status ?? null,
      total_events: evts.length,
      negotiation_count: negotiationCount,
      rejection_count: rejectionCount,
      freeze_blocks: freezeBlocks,
      preemption_count: preemptionCount,
      scheduler_runs: schedulerRuns,
      drift_detected: false,
      replay_coverage_ratio: replayCoverageRatio,
      policy_version: policyVersion,
      policy_hash: policyHash,
      last_event_at: lastEventAt,
      updated_at: new Date().toISOString(),
      rebuilding_since: null,
    };

  const { error: upsertErr } = await supabase
    .from('governance_projections')
    .upsert(payload, { onConflict: 'campaign_id' });

  if (upsertErr) {
    console.error('GovernanceProjectionService: rebuild upsert failed', upsertErr);
  }
}
