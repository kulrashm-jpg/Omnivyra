/**
 * Governance Event Persistence Service.
 * Stage 10 Phase 3: Authoritative audit layer.
 * Stage 23: Policy versioning + immutable decision context.
 * Stage 27: Integrity assertion — policy_version, policy_hash, evaluation_context when required.
 * Never throws in production. Fail silently (log error only).
 */

import { supabase } from '../db/supabaseClient';
import { GOVERNANCE_POLICY_VERSION, getGovernancePolicyHash } from '../governance/GovernancePolicy';
import { assertPolicySignatureUnchanged } from '../governance/GovernancePolicyRegistry';
import { computeGovernanceEventHash } from '../governance/GovernanceLedger';
import { updateGovernanceProjectionFromEvent } from './GovernanceProjectionService';
import { tryConsumeProjectionToken } from './GovernanceRateLimiter';

/** Stage 27: Event types that require metadata.evaluation_context for replay/audit. */
export const EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT = new Set([
  'DURATION_APPROVED',
  'DURATION_NEGOTIATE',
  'DURATION_REJECTED',
  'CONTENT_CAPACITY_LIMITED',
  'CONTENT_COLLISION_DETECTED',
  'PREEMPTION_EXECUTED',
  'SCHEDULE_STARTED',
  'SCHEDULE_COMPLETED',
  'GOVERNANCE_AUTO_OPTIMIZED',
]);

export class GovernanceEventIntegrityError extends Error {
  code = 'GOVERNANCE_EVENT_INTEGRITY_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'GovernanceEventIntegrityError';
  }
}

export interface EvaluationContextSnapshot {
  execution_status?: string;
  blueprint_status?: string;
  duration_locked?: boolean;
  constraint_count?: number;
  requested_weeks?: number;
}

export interface RecordGovernanceEventParams {
  companyId: string;
  campaignId: string;
  eventType: string;
  eventStatus: string;
  metadata?: Record<string, any>;
  /** Stage 23: Immutable decision snapshot for audit. Added to metadata when provided. */
  evaluationContext?: EvaluationContextSnapshot;
}

/**
 * Record a governance event. Must never throw.
 * Fails silently (log error only). Always JSON stringify metadata.
 * Stage 23: Injects policy_version and policy_hash for audit traceability.
 */
export async function recordGovernanceEvent(params: RecordGovernanceEventParams): Promise<void> {
  try {
    assertPolicySignatureUnchanged();
    const { companyId, campaignId, eventType, eventStatus, metadata = {}, evaluationContext } = params;
    const metadataSafe = typeof metadata === 'object' && metadata !== null
      ? JSON.parse(JSON.stringify(metadata))
      : {};
    if (evaluationContext && typeof evaluationContext === 'object') {
      metadataSafe.evaluation_context = JSON.parse(JSON.stringify(evaluationContext));
    }

    const policyVersion = GOVERNANCE_POLICY_VERSION;
    const policyHash = getGovernancePolicyHash();

    if (!policyVersion || typeof policyVersion !== 'string') {
      const msg = 'Governance event integrity: policy_version must exist';
      if (process.env.NODE_ENV === 'production') {
        console.error('GovernanceEventService:', msg);
      } else {
        throw new GovernanceEventIntegrityError(msg);
      }
    }
    if (!policyHash || typeof policyHash !== 'string') {
      const msg = 'Governance event integrity: policy_hash must exist';
      if (process.env.NODE_ENV === 'production') {
        console.error('GovernanceEventService:', msg);
      } else {
        throw new GovernanceEventIntegrityError(msg);
      }
    }
    const eventTypeNorm = String(eventType || '').toUpperCase().trim();
    if (EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has(eventTypeNorm)) {
      const hasContext = metadataSafe?.evaluation_context != null && typeof metadataSafe.evaluation_context === 'object';
      if (!hasContext) {
        const msg = `Governance event integrity: event_type ${eventTypeNorm} requires metadata.evaluation_context`;
        if (process.env.NODE_ENV === 'production') {
          console.error('GovernanceEventService:', msg);
        } else {
          throw new GovernanceEventIntegrityError(msg);
        }
      }
    }

    let previousEventHash: string | null = null;
    const { data: latest } = await supabase
      .from('campaign_governance_events')
      .select('event_hash')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.event_hash) {
      previousEventHash = (latest as any).event_hash;
    }

    const eventHash = computeGovernanceEventHash({
      campaignId,
      eventType,
      eventStatus,
      metadata: metadataSafe,
      policyVersion,
      policyHash,
      previousEventHash,
    });

    const createdAt = new Date().toISOString();
    await supabase.from('campaign_governance_events').insert({
      company_id: companyId,
      campaign_id: campaignId,
      event_type: eventType,
      event_status: eventStatus,
      metadata: metadataSafe,
      policy_version: policyVersion,
      policy_hash: policyHash,
      event_hash: eventHash,
      previous_event_hash: previousEventHash,
      created_at: createdAt,
    });

    if (tryConsumeProjectionToken(companyId)) {
      updateGovernanceProjectionFromEvent({
        campaign_id: campaignId,
        company_id: companyId,
        event_type: eventType,
        event_status: eventStatus,
        metadata: metadataSafe,
        policy_version: policyVersion,
        policy_hash: policyHash,
        created_at: createdAt,
      }).catch(() => {});
    }
  } catch (err) {
    if (err instanceof GovernanceEventIntegrityError && process.env.NODE_ENV !== 'production') {
      throw err;
    }
    console.error('GovernanceEventService: recordGovernanceEvent failed', err);
  }
}

/**
 * Stage 20: Emit CAMPAIGN_COMPLETED when execution transitions to COMPLETED.
 * Call this when campaign execution_status is updated to COMPLETED.
 */
export async function recordCampaignCompletedEvent(params: {
  companyId: string;
  campaignId: string;
  completedAt?: string;
  totalScheduledPosts?: number;
}): Promise<void> {
  const completedAt = params.completedAt ?? new Date().toISOString();
  await recordGovernanceEvent({
    companyId: params.companyId,
    campaignId: params.campaignId,
    eventType: 'CAMPAIGN_COMPLETED',
    eventStatus: 'COMPLETED',
    metadata: {
      campaignId: params.campaignId,
      completedAt,
      ...(params.totalScheduledPosts != null && { totalScheduledPosts: params.totalScheduledPosts }),
    },
  });
}
