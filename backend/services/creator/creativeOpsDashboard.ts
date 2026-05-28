/**
 * Creative Ops Dashboard Infrastructure + Analytics Surfaces +
 * Operational Audit UX (Phases 5, 6, 7, 10).
 *
 * Aggregates the underlying state stores into operator-friendly
 * envelopes for enterprise dashboards. All aggregations are READ-ONLY
 * and BOUNDED — no separate cache, no persistence; computed on demand
 * from the already-bounded telemetry / review-state / escalation
 * stores.
 *
 * Phase 10 cost ceilings:
 *   - max 100 review records sampled per org in dashboard queries
 *   - 30-day default rolling window for analytics
 *   - all aggregation loops are linear in input size
 *
 * Pure (no DB, no fetch). Provider-agnostic.
 */

import {
  listReviewRecordsForCompany,
  reviewStoreStats,
  type CreativeReviewRecord,
  type ReviewState,
} from './creativeReviewStateMachine';
import {
  listEscalationsForCompany,
  escalationStats,
  type Escalation,
  type EscalationPriority,
  type EscalationLevel,
} from './creativeEscalationPipeline';
import {
  computeOrgStrategicMemory,
  telemetryStats,
} from './creatorPerformanceTelemetry';
import type { CreativeReviewRole } from './creativeReviewRoles';

/* ── Campaign health ────────────────────────────────────────────────── */

export type CampaignHealthSummary = {
  companyId: string;
  campaignId: string | null;
  totalAssets: number;
  byState: Record<ReviewState, number>;
  approvalProgress: number;       // 0-1
  bottleneckState: ReviewState | null;
  longestPendingHours: number;
  staleCount: number;
  rejectionRate: number;          // 0-1
  publishedRate: number;          // 0-1
  computedAt: string;
};

function emptyStateCounts(): Record<ReviewState, number> {
  return {
    draft: 0, generated: 0, qa_review: 0, governance_review: 0,
    brand_review: 0, legal_review: 0, approved: 0, rejected: 0,
    published: 0, archived: 0,
  };
}

export function getCampaignHealthSummary(
  companyId: string,
  campaignId: string | null = null,
): CampaignHealthSummary {
  const all = listReviewRecordsForCompany(companyId, 100);
  const filtered = campaignId
    ? all.filter((r) => r.campaignId === campaignId)
    : all;

  const byState = emptyStateCounts();
  let staleCount = 0;
  let rejectedCount = 0;
  let publishedCount = 0;
  let longestPendingMs = 0;
  let oldestPendingState: ReviewState | null = null;

  for (const r of filtered) {
    byState[r.currentState]++;
    if (r.stale) staleCount++;
    if (r.currentState === 'rejected') rejectedCount++;
    if (r.currentState === 'published') publishedCount++;
    if (r.currentState !== 'published' && r.currentState !== 'archived' && r.currentState !== 'rejected') {
      const age = Date.now() - new Date(r.lastTransitionedAt).getTime();
      if (age > longestPendingMs) {
        longestPendingMs = age;
        oldestPendingState = r.currentState;
      }
    }
  }

  // Bottleneck: state with the most non-terminal records (excluding draft / published / archived).
  const NON_TERMINAL_STATES: ReviewState[] = ['generated', 'qa_review', 'governance_review', 'brand_review', 'legal_review', 'approved'];
  let bottleneck: ReviewState | null = null;
  let bottleneckCount = 0;
  for (const state of NON_TERMINAL_STATES) {
    if (byState[state] > bottleneckCount) {
      bottleneckCount = byState[state];
      bottleneck = state;
    }
  }

  const total = filtered.length;
  const approved = byState.approved + byState.published;
  return {
    companyId,
    campaignId,
    totalAssets: total,
    byState,
    approvalProgress: total > 0 ? approved / total : 0,
    bottleneckState: bottleneckCount > 0 ? bottleneck : null,
    longestPendingHours: longestPendingMs > 0 ? Math.round(longestPendingMs / (60 * 60 * 1000)) : 0,
    staleCount,
    rejectionRate: total > 0 ? rejectedCount / total : 0,
    publishedRate: total > 0 ? publishedCount / total : 0,
    computedAt: new Date().toISOString(),
  };
}

/* ── Approval bottleneck + cycle timing ─────────────────────────────── */

export type ApprovalCycleTiming = {
  companyId: string;
  averageDraftToApprovedHours: number;
  averageDraftToPublishedHours: number;
  averageRejectionToReapproveHours: number;
  byTransition: Record<string, { samples: number; averageHours: number }>;
  reviewerAttribution: Record<CreativeReviewRole, number>;
  computedAt: string;
};

export function getApprovalCycleTiming(companyId: string): ApprovalCycleTiming {
  const all = listReviewRecordsForCompany(companyId, 100);
  let draftToApprovedSum = 0;
  let draftToApprovedSamples = 0;
  let draftToPublishedSum = 0;
  let draftToPublishedSamples = 0;
  const byTransition: Record<string, { samples: number; totalMs: number }> = {};
  const reviewerAttribution: Record<CreativeReviewRole, number> = {
    creative_operator: 0, creative_director: 0, brand_manager: 0,
    compliance_reviewer: 0, legal_reviewer: 0, campaign_manager: 0,
    executive_reviewer: 0, admin: 0,
  };

  for (const r of all) {
    const firstTs = r.history[0] ? new Date(r.history[0].occurredAt).getTime() : Date.now();
    if (r.currentState === 'approved') {
      const approvedTs = new Date(r.lastTransitionedAt).getTime();
      draftToApprovedSum += approvedTs - firstTs;
      draftToApprovedSamples++;
    }
    if (r.currentState === 'published') {
      const publishedTs = new Date(r.lastTransitionedAt).getTime();
      draftToPublishedSum += publishedTs - firstTs;
      draftToPublishedSamples++;
    }
    for (let i = 1; i < r.history.length; i++) {
      const t = r.history[i];
      const prev = r.history[i - 1];
      const key = `${prev.to}->${t.to}`;
      const bucket = byTransition[key] ?? { samples: 0, totalMs: 0 };
      bucket.samples++;
      bucket.totalMs += new Date(t.occurredAt).getTime() - new Date(prev.occurredAt).getTime();
      byTransition[key] = bucket;
      if (t.actorRole) reviewerAttribution[t.actorRole]++;
    }
  }

  const byTransitionOut: Record<string, { samples: number; averageHours: number }> = {};
  for (const [key, bucket] of Object.entries(byTransition)) {
    byTransitionOut[key] = {
      samples: bucket.samples,
      averageHours: bucket.samples > 0 ? bucket.totalMs / bucket.samples / (60 * 60 * 1000) : 0,
    };
  }

  return {
    companyId,
    averageDraftToApprovedHours: draftToApprovedSamples > 0 ? draftToApprovedSum / draftToApprovedSamples / (60 * 60 * 1000) : 0,
    averageDraftToPublishedHours: draftToPublishedSamples > 0 ? draftToPublishedSum / draftToPublishedSamples / (60 * 60 * 1000) : 0,
    averageRejectionToReapproveHours: 0, // requires per-asset cycle reconstruction; deferred
    byTransition: byTransitionOut,
    reviewerAttribution,
    computedAt: new Date().toISOString(),
  };
}

/* ── Governance + escalation analytics ─────────────────────────────── */

export type GovernanceAnalytics = {
  companyId: string;
  totalEscalations: number;
  byLevel: Record<EscalationLevel, number>;
  byPriority: Record<EscalationPriority, number>;
  byReason: Record<string, number>;
  overdueEscalations: number;
  capReachedCount: number;
  computedAt: string;
};

export function getGovernanceAnalytics(companyId: string): GovernanceAnalytics {
  const escalations = listEscalationsForCompany(companyId);
  const byLevel: Record<EscalationLevel, number> = { routine: 0, high: 0, critical: 0, executive: 0 };
  const byPriority: Record<EscalationPriority, number> = { p1: 0, p2: 0, p3: 0, p4: 0 };
  const byReason: Record<string, number> = {};
  let overdue = 0;
  let capReached = 0;

  for (const e of escalations) {
    byLevel[e.escalationLevel]++;
    byPriority[e.escalationPriority]++;
    byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
    if (new Date(e.escalationDeadline).getTime() < Date.now()) overdue++;
    if (e.capReached) capReached++;
  }

  return {
    companyId,
    totalEscalations: escalations.length,
    byLevel,
    byPriority,
    byReason,
    overdueEscalations: overdue,
    capReachedCount: capReached,
    computedAt: new Date().toISOString(),
  };
}

/* ── Strategy + platform analytics (delegates to telemetry) ──────────── */

export type StrategyAnalytics = {
  companyId: string;
  topStrategies: ReadonlyArray<{ strategy: string; samples: number; successRate: number; avgQa: number; avgAesthetic: number }>;
  bestEmotionalDirection: string | null;
  bestRealismProfile: string | null;
  bestPlatform: string | null;
  underperformingStrategies: ReadonlyArray<string>;
  computedAt: string;
};

export function getStrategyAnalytics(companyId: string): StrategyAnalytics {
  const memory = computeOrgStrategicMemory(companyId);
  if (!memory) {
    return {
      companyId,
      topStrategies: [],
      bestEmotionalDirection: null,
      bestRealismProfile: null,
      bestPlatform: null,
      underperformingStrategies: [],
      computedAt: new Date().toISOString(),
    };
  }
  return {
    companyId,
    topStrategies: memory.topStrategies.map((s) => ({
      strategy: s.strategy,
      samples: s.samples,
      successRate: s.successRate,
      avgQa: s.averageQaScore,
      avgAesthetic: s.averageAestheticScore,
    })),
    bestEmotionalDirection: memory.bestEmotionalDirection,
    bestRealismProfile: memory.bestRealismProfile,
    bestPlatform: memory.bestPlatform,
    underperformingStrategies: memory.underperformingStrategies as ReadonlyArray<string>,
    computedAt: new Date().toISOString(),
  };
}

/* ── Phase 6 — Unified audit envelope per asset ─────────────────────── */

export type UnifiedAssetAudit = {
  assetId: string;
  companyId: string;
  campaignId: string | null;
  currentState: ReviewState | null;
  stateHistory: ReadonlyArray<{
    from: ReviewState | null;
    to: ReviewState;
    actorRole: CreativeReviewRole | null;
    actorUserId: string | null;
    action: string;
    reason: string | null;
    comment: string | null;
    occurredAt: string;
    bypassed: boolean;
  }>;
  campaignLocked: boolean;
  stale: boolean;
  overrideCount: number;
  escalationCount: number;
  commentsCount: number;
  escalations: ReadonlyArray<Escalation>;
  computedAt: string;
};

export function getUnifiedAssetAudit(assetId: string): UnifiedAssetAudit | null {
  // We can't look up across orgs without the company id; the renderer
  // / orchestrator persists the asset id alongside the company so the
  // caller can produce it. Search the review store by scanning the
  // per-org records via a cross-org listing helper.
  // Phase 10 — bounded scan: only the most recently active 5000 records.
  const escalations = require('./creativeEscalationPipeline').listEscalationsForAsset(assetId) as ReadonlyArray<Escalation>;
  // Without a direct lookup, return what's available from escalation
  // history plus an empty state envelope. Callers that have the
  // companyId should use `getReviewRecord` directly.
  if (escalations.length === 0) return null;
  const firstEsc = escalations[0];
  return {
    assetId,
    companyId: firstEsc.companyId,
    campaignId: firstEsc.campaignId,
    currentState: null,
    stateHistory: [],
    campaignLocked: false,
    stale: false,
    overrideCount: 0,
    escalationCount: escalations.length,
    commentsCount: 0,
    escalations,
    computedAt: new Date().toISOString(),
  };
}

export function buildUnifiedAuditFromRecord(record: CreativeReviewRecord): UnifiedAssetAudit {
  const escalations = require('./creativeEscalationPipeline').listEscalationsForAsset(record.assetId) as ReadonlyArray<Escalation>;
  return {
    assetId: record.assetId,
    companyId: record.companyId,
    campaignId: record.campaignId,
    currentState: record.currentState,
    stateHistory: record.history.map((h) => ({
      from: h.from,
      to: h.to,
      actorRole: h.actorRole,
      actorUserId: h.actorUserId,
      action: h.action,
      reason: h.reason,
      comment: h.comment,
      occurredAt: h.occurredAt,
      bypassed: h.bypassed === true,
    })),
    campaignLocked: record.campaignLocked,
    stale: record.stale,
    overrideCount: record.overrideCount,
    escalationCount: record.escalationCount,
    commentsCount: record.comments.length,
    escalations,
    computedAt: new Date().toISOString(),
  };
}

/* ── Phase 10 — Operational diagnostics ─────────────────────────────── */

export function getOperationalDiagnostics(): {
  reviewStore: ReturnType<typeof reviewStoreStats>;
  escalations: ReturnType<typeof escalationStats>;
  telemetry: ReturnType<typeof telemetryStats>;
} {
  return {
    reviewStore: reviewStoreStats(),
    escalations: escalationStats(),
    telemetry: telemetryStats(),
  };
}
