/**
 * Stage 24 — Deterministic Governance Replay Engine.
 * Read-only replay + verification. Never mutates state or emits events.
 */

import { supabase } from '../db/supabaseClient';
import { getGovernancePolicy } from '../governance/GovernancePolicyRegistry';
import { runPrePlanning } from './CampaignPrePlanningService';

export class ReplayNotSupportedError extends Error {
  code = 'REPLAY_NOT_SUPPORTED';
  constructor(message: string) {
    super(message);
    this.name = 'ReplayNotSupportedError';
  }
}

export interface GovernanceReplayResult {
  campaignId: string;
  eventId: string;
  originalEventType: string;
  originalStatus: string;
  replayedStatus: string;
  statusMatch: boolean;
  policyVersionMatch: boolean;
  policyHashMatch: boolean;
  mismatchReason?: string;
}

const REPLAYABLE_EVENT_TYPES = new Set([
  'DURATION_APPROVED',
  'DURATION_NEGOTIATE',
  'DURATION_REJECTED',
]);

/**
 * Replay a governance event and verify deterministic consistency.
 * Never writes to DB or emits governance events.
 */
export async function replayGovernanceEvent(eventId: string): Promise<GovernanceReplayResult> {
  const { data: event, error } = await supabase
    .from('campaign_governance_events')
    .select('id, company_id, campaign_id, event_type, event_status, metadata, policy_version, policy_hash')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) {
    throw new ReplayNotSupportedError('Event not found');
  }

  const companyId = (event as any).company_id;
  const campaignId = (event as any).campaign_id;
  const originalEventType = String((event as any).event_type ?? '');
  const originalStatus = String((event as any).event_status ?? '');
  const metadata = (event as any).metadata ?? {};
  const storedPolicyVersion = String((event as any).policy_version ?? '');
  const storedPolicyHash = String((event as any).policy_hash ?? '');

  const evaluationContext = metadata.evaluation_context;
  if (!evaluationContext || typeof evaluationContext !== 'object') {
    throw new ReplayNotSupportedError('Event has no evaluation_context; cannot replay');
  }

  if (!REPLAYABLE_EVENT_TYPES.has(originalEventType)) {
    throw new ReplayNotSupportedError(`Event type ${originalEventType} is not replayable`);
  }

  let policyVersionMatch = true;
  let policyHashMatch = true;
  if (storedPolicyVersion && storedPolicyHash) {
    try {
      const policy = getGovernancePolicy(storedPolicyVersion);
      policyVersionMatch = true;
      policyHashMatch = storedPolicyHash === policy.hash;
    } catch {
      policyVersionMatch = false;
      policyHashMatch = false;
    }
  }
  if (!policyHashMatch) {
    const err = new ReplayNotSupportedError('Governance policy for event version differs or not found');
    Object.defineProperty(err, 'code', { value: 'POLICY_HASH_MISMATCH', writable: false });
    throw err;
  }

  const requestedWeeks = evaluationContext.requested_weeks ?? metadata.requested_weeks;
  if (requestedWeeks == null || typeof requestedWeeks !== 'number' || requestedWeeks < 1) {
    throw new ReplayNotSupportedError('Cannot determine requested_weeks from event');
  }

  const result = await runPrePlanning({
    companyId,
    campaignId,
    requested_weeks: requestedWeeks,
    suppressEvents: true,
    policyVersion: storedPolicyVersion || undefined,
  });

  const replayedStatus = String(result.status ?? '');
  const statusMatch = originalStatus.toUpperCase() === replayedStatus.toUpperCase();
  let mismatchReason: string | undefined;
  if (!statusMatch) {
    mismatchReason = 'STATUS_DRIFT';
  }

  return {
    campaignId,
    eventId,
    originalEventType,
    originalStatus,
    replayedStatus,
    statusMatch,
    policyVersionMatch,
    policyHashMatch,
    ...(mismatchReason && { mismatchReason }),
  };
}
