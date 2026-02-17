/**
 * Governance Explanation Panel — Stage 10 Phase 5.
 * Displays blocked/negotiate/approved state from latest event or normalized result.
 */

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';

interface NormalizedGovernanceDecision {
  blocked: boolean;
  primaryReason: string | null;
  explanation: string;
  recommendedAction: string | null;
  /** Content-type capacity: missing content type (e.g. video, blog) */
  missingContentType?: string | null;
  /** Content collision: overlapping campaign count */
  collidingCampaignCount?: number;
  /** Content collision: colliding asset count */
  collidingAssetCount?: number;
}

interface GovernanceExplanationPanelProps {
  /** Full evaluation result — when available, uses normalized shape */
  evaluation?: {
    status: 'APPROVED' | 'NEGOTIATE' | 'REJECTED';
    blocking_constraints: Array<{ name: string; reasoning: string; missing_type?: string; collidingCampaignIds?: string[]; collidingAssetIds?: string[] }>;
    limiting_constraints: Array<{ name: string; reasoning: string; missing_type?: string; collidingCampaignIds?: string[]; collidingAssetIds?: string[] }>;
    tradeOffOptions?: Array<{ type: string }>;
  } | null;
  /** Derived from latestGovernanceEvent when evaluation not available */
  derived?: NormalizedGovernanceDecision | null;
}

/** Derive explanation from latestGovernanceEvent when full evaluation is unavailable. */
export function deriveFromEvent(
  eventType: string,
  metadata: Record<string, unknown>
): NormalizedGovernanceDecision {
  if (eventType === 'CONTENT_CAPACITY_LIMITED') {
    const missing = metadata.missing_type as string | undefined;
    const max = metadata.max_weeks_allowed as number | undefined;
    const blocked = max != null && max <= 0;
    return {
      blocked,
      primaryReason: 'content_type_capacity',
      explanation: missing
        ? `Insufficient ${missing} assets. ${blocked ? 'Add more content or adjust weekly mix.' : max != null ? `Maximum ${max} weeks with current mix.` : 'Adjust weekly content mix.'}`
        : 'Content type capacity limits campaign duration.',
      recommendedAction: 'ADJUST_CONTENT_MIX',
      missingContentType: missing ?? null,
    };
  }
  if (eventType === 'CONTENT_COLLISION_DETECTED') {
    const collidingCampaignIds = metadata.collidingCampaignIds as string[] | undefined;
    const collidingAssetIds = metadata.collidingAssetIds as string[] | undefined;
    const severity = metadata.severity as string | undefined;
    const blocked = severity === 'BLOCKING';
    return {
      blocked,
      primaryReason: 'content_collision',
      explanation: `Content assets overlap with ${collidingCampaignIds?.length ?? 0} overlapping campaign(s). ${collidingAssetIds?.length ?? 0} asset(s) collide. ${blocked ? 'Select different content or shift dates.' : 'Consider selecting different content assets or shifting start date.'}`,
      recommendedAction: 'ADJUST_CONTENT_SELECTION',
      collidingCampaignCount: collidingCampaignIds?.length ?? 0,
      collidingAssetCount: collidingAssetIds?.length ?? 0,
    };
  }
  if (eventType === 'DURATION_REJECTED') {
    const count = (metadata.blocking_constraints_count as number) ?? 0;
    return {
      blocked: true,
      primaryReason: count > 0 ? 'blocking_constraints' : null,
      explanation: 'Request rejected. No viable duration under current constraints.',
      recommendedAction: null,
    };
  }
  if (eventType === 'DURATION_NEGOTIATE') {
    const max = metadata.max_weeks_allowed as number | undefined;
    return {
      blocked: false,
      primaryReason: 'limiting_constraint',
      explanation: max != null ? `Maximum viable duration: ${max} weeks.` : 'Request exceeds available capacity. Adjustment required.',
      recommendedAction: null,
    };
  }
  return { blocked: false, primaryReason: null, explanation: 'Approved under current governance rules.', recommendedAction: null };
}

function normalizeFromEvaluation(e: NonNullable<GovernanceExplanationPanelProps['evaluation']>): NormalizedGovernanceDecision {
  const blocking = e.blocking_constraints?.[0];
  const limiting = e.limiting_constraints?.[0];
  const constraint = blocking ?? limiting;
  const isContentCollision = constraint?.name === 'content_collision';
  const collidingCampaignCount = isContentCollision ? (constraint as { collidingCampaignIds?: string[] }).collidingCampaignIds?.length ?? 0 : undefined;
  const collidingAssetCount = isContentCollision ? (constraint as { collidingAssetIds?: string[] }).collidingAssetIds?.length ?? 0 : undefined;

  if (e.status === 'REJECTED') {
    const primary = blocking?.name ?? limiting?.name ?? null;
    const explanation = blocking?.reasoning ?? limiting?.reasoning ?? 'Request rejected.';
    const missingContentType = constraint?.name === 'content_type_capacity'
      ? (constraint as { missing_type?: string }).missing_type ?? null
      : null;
    return { blocked: true, primaryReason: primary, explanation, recommendedAction: e.tradeOffOptions?.[0]?.type ?? null, missingContentType, collidingCampaignCount, collidingAssetCount };
  }
  if (e.status === 'NEGOTIATE') {
    const primary = limiting?.name ?? null;
    const explanation = limiting?.reasoning ?? 'Request exceeds available capacity.';
    const missingContentType = limiting?.name === 'content_type_capacity'
      ? (limiting as { missing_type?: string }).missing_type ?? null
      : null;
    return { blocked: false, primaryReason: primary, explanation, recommendedAction: e.tradeOffOptions?.[0]?.type ?? null, missingContentType, collidingCampaignCount, collidingAssetCount };
  }
  return { blocked: false, primaryReason: null, explanation: 'Approved under current governance rules.', recommendedAction: null };
}

export function GovernanceExplanationPanel({ evaluation, derived }: GovernanceExplanationPanelProps) {
  let normalized: NormalizedGovernanceDecision | null = null;

  if (evaluation) {
    normalized = normalizeFromEvaluation(evaluation);
  } else if (derived) {
    normalized = derived;
  }

  if (!normalized) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h2 className="text-xl font-semibold mb-4">Constraint Status</h2>
        <p className="text-sm text-gray-500">
          No duration evaluation available. Run a duration check when requesting a change to see constraint status.
        </p>
      </div>
    );
  }

  const { blocked, primaryReason, explanation, recommendedAction, missingContentType, collidingCampaignCount, collidingAssetCount } = normalized;
  const isContentTypeCapacity = primaryReason === 'content_type_capacity';
  const isContentCollision = primaryReason === 'content_collision';

  if (blocked) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <h3 className="font-semibold text-red-800">
              {isContentTypeCapacity ? 'Content Type Capacity Constraint' : isContentCollision ? 'Content Collision Detected' : 'Blocked'}
            </h3>
          </div>
          {isContentCollision && (
            <div className="text-sm font-medium text-red-700 mb-1">
              {collidingCampaignCount != null && collidingAssetCount != null
                ? `${collidingCampaignCount} overlapping campaign(s), ${collidingAssetCount} colliding asset(s). Select different content or shift start date.`
                : 'Content assets overlap with other campaigns.'}
            </div>
          )}
          {isContentTypeCapacity && missingContentType && (
            <div className="text-sm font-medium text-red-700 mb-1">
              Missing content type: {missingContentType}
            </div>
          )}
          {primaryReason && !isContentTypeCapacity && !isContentCollision && (
            <div className="text-sm font-medium text-red-700 mb-1">
              Reason: {primaryReason}
            </div>
          )}
          <p className="text-sm text-red-800 mb-2">{explanation}</p>
          {recommendedAction && (
            <div className="text-sm font-medium text-red-600">
              Recommended: {recommendedAction.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isNegotiate = !blocked && (normalized.primaryReason || normalized.recommendedAction);
  if (isNegotiate) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold text-amber-800">
              {isContentTypeCapacity ? 'Content Type Capacity Constraint' : isContentCollision ? 'Content Collision Detected' : 'Negotiation Required'}
            </h3>
          </div>
          {isContentCollision && (
            <div className="text-sm font-medium text-amber-700 mb-1">
              {collidingCampaignCount != null && collidingAssetCount != null
                ? `${collidingCampaignCount} overlapping campaign(s), ${collidingAssetCount} colliding asset(s). Select different content or shift start date.`
                : 'Content assets overlap with other campaigns.'}
            </div>
          )}
          {isContentTypeCapacity && missingContentType && (
            <div className="text-sm font-medium text-amber-700 mb-1">
              Missing content type: {missingContentType}. Add more {missingContentType} content or adjust weekly mix.
            </div>
          )}
          {primaryReason && !isContentTypeCapacity && !isContentCollision && (
            <div className="text-sm font-medium text-amber-700 mb-1">
              Constraint: {primaryReason}
            </div>
          )}
          <p className="text-sm text-amber-800 mb-2">{explanation}</p>
          {recommendedAction && (
            <div className="text-sm font-medium text-amber-600">
              Recommended: {recommendedAction.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border">
      <div className="rounded-lg border-2 border-green-200 bg-green-50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <h3 className="font-semibold text-green-800">Approved</h3>
        </div>
        <p className="text-sm text-green-800">{explanation}</p>
      </div>
    </div>
  );
}
