/**
 * Enterprise Governance — Unified Operational Observability (Phase 8).
 *
 * Reconstructs a single per-asset lifecycle envelope from:
 *   - review state machine history
 *   - escalation pipeline records
 *   - governance event stream
 *
 * Operators can read the full decision chain (creation → QA → governance
 * → approval → publish), retries, escalations, and bypasses from a single
 * envelope, with no DB joins or cross-store walks.
 *
 * Pure read aggregator — no writes, no side effects.
 *
 * Phase 10 cost ceilings:
 *   - lifecycle event arrays bounded by underlying store limits (60
 *     transitions / 100 events / N escalations).
 *   - merged timeline limited to 300 entries per asset.
 */

import { getReviewRecord } from './creativeReviewStateMachine';
import { listEscalationsForAsset } from './creativeEscalationPipeline';
import {
  listRecentGovernanceEvents,
  type EnterpriseGovernanceEvent,
} from './enterpriseGovernanceEvents';

const MAX_TIMELINE_ENTRIES = 300;

export type LifecycleTimelineEntry = {
  at: string;
  source: 'state' | 'escalation' | 'event';
  kind: string;
  actor?: string | null;
  detail: Record<string, unknown>;
};

export type AssetLifecycleEnvelope = {
  assetId: string;
  companyId: string | null;
  campaignId: string | null;
  currentState: string | null;
  campaignLocked: boolean;
  stale: boolean;
  overrideCount: number;
  escalationCount: number;
  commentsCount: number;
  escalations: ReadonlyArray<{
    escalationId: string;
    reason: string;
    level: string;
    priority: string;
    assignedRole: string;
    deadline: string;
    createdAt: string;
    capReached: boolean;
  }>;
  stateHistory: ReadonlyArray<{
    from: string | null;
    to: string;
    actorRole: string | null;
    actorUserId: string | null;
    action: string;
    reason: string | null;
    occurredAt: string;
    bypassed: boolean;
  }>;
  recentEvents: ReadonlyArray<EnterpriseGovernanceEvent>;
  timeline: ReadonlyArray<LifecycleTimelineEntry>;
  computedAt: string;
};

export function buildAssetLifecycleEnvelope(assetId: string): AssetLifecycleEnvelope {
  const record = getReviewRecord(assetId);
  const escalations = listEscalationsForAsset(assetId);
  const recentEvents = listRecentGovernanceEvents({ assetId, limit: 100 });

  const escSummaries = escalations.map((e) => ({
    escalationId: e.escalationId,
    reason: e.reason,
    level: e.escalationLevel,
    priority: e.escalationPriority,
    assignedRole: e.assignedReviewRole,
    deadline: e.escalationDeadline,
    createdAt: e.createdAt,
    capReached: e.capReached === true,
  }));

  const stateHistory = (record?.history ?? []).map((h) => ({
    from: h.from,
    to: h.to,
    actorRole: h.actorRole,
    actorUserId: h.actorUserId,
    action: h.action,
    reason: h.reason,
    occurredAt: h.occurredAt,
    bypassed: h.bypassed === true,
  }));

  // Merged timeline — newest first, bounded.
  const timeline: LifecycleTimelineEntry[] = [];

  for (const h of stateHistory) {
    timeline.push({
      at: h.occurredAt,
      source: 'state',
      kind: `${h.from ?? 'null'}→${h.to}`,
      actor: h.actorRole,
      detail: { action: h.action, reason: h.reason, bypassed: h.bypassed },
    });
  }
  for (const e of escSummaries) {
    timeline.push({
      at: e.createdAt,
      source: 'escalation',
      kind: e.reason,
      actor: e.assignedRole,
      detail: {
        escalationId: e.escalationId,
        level: e.level,
        priority: e.priority,
        deadline: e.deadline,
        capReached: e.capReached,
      },
    });
  }
  for (const ev of recentEvents) {
    timeline.push({
      at: ev.occurredAt,
      source: 'event',
      kind: ev.type,
      actor: typeof ev.context.actorRole === 'string' ? ev.context.actorRole : null,
      detail: ev.context,
    });
  }

  timeline.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const bounded = timeline.slice(0, MAX_TIMELINE_ENTRIES);

  return {
    assetId,
    companyId: record?.companyId ?? escalations[0]?.companyId ?? null,
    campaignId: record?.campaignId ?? escalations[0]?.campaignId ?? null,
    currentState: record?.currentState ?? null,
    campaignLocked: record?.campaignLocked ?? false,
    stale: record?.stale ?? false,
    overrideCount: record?.overrideCount ?? 0,
    escalationCount: record?.escalationCount ?? 0,
    commentsCount: record?.comments.length ?? 0,
    escalations: escSummaries,
    stateHistory,
    recentEvents,
    timeline: bounded,
    computedAt: new Date().toISOString(),
  };
}
