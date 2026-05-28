/**
 * Creative Escalation Pipeline (Phase 3).
 *
 * Routes governance / QA / review escalations to the appropriate
 * reviewer role with a structured priority + deadline. Returns a
 * deterministic `Escalation` envelope that the orchestrator can act
 * on (assign reviewer, surface in dashboard, trigger notifications).
 *
 * Phase 9 — escalation-loop protection: the state machine's
 * `incrementEscalationCount` is consulted before issuing a new
 * escalation; the cap prevents runaway escalation storms.
 *
 * Pure + deterministic. No external integrations.
 */

import { incrementEscalationCount } from './creativeReviewStateMachine';
import type { CreativeReviewRole } from './creativeReviewRoles';

/* ── Escalation types ───────────────────────────────────────────────── */

export type EscalationLevel = 'routine' | 'high' | 'critical' | 'executive';
export type EscalationPriority = 'p4' | 'p3' | 'p2' | 'p1';
export type EscalationReason =
  | 'severe_governance_violation'
  | 'repeated_qa_failures'
  | 'repeated_off_brand_output'
  | 'unsafe_realism_drift'
  | 'repeated_retry_exhaustion'
  | 'campaign_coherence_collapse'
  | 'legal_risk'
  | 'executive_review'
  | 'manual_escalation';

export type EscalationContext = {
  assetId: string;
  companyId: string;
  campaignId?: string | null;
  reason: EscalationReason;
  governanceScore?: number | null;
  qaScore?: number | null;
  retryCount?: number | null;
  governanceViolationCount?: number | null;
  /** Free-text triage note. */
  notes?: string | null;
  /** Actor requesting the escalation (manual escalation path). */
  requestedByUserId?: string | null;
  requestedByRole?: CreativeReviewRole | null;
};

export type Escalation = {
  escalationId: string;
  assetId: string;
  companyId: string;
  campaignId: string | null;
  reason: EscalationReason;
  escalationLevel: EscalationLevel;
  assignedReviewRole: CreativeReviewRole;
  escalationPriority: EscalationPriority;
  /** ISO timestamp by which the escalation must be addressed. */
  escalationDeadline: string;
  notes: string | null;
  requestedByUserId: string | null;
  requestedByRole: CreativeReviewRole | null;
  createdAt: string;
  /** Audit trail — set when escalation cap was hit. */
  capReached?: boolean;
};

/* ── Routing rules ──────────────────────────────────────────────────── */

const ROUTING_MATRIX: Record<EscalationReason, {
  level: EscalationLevel;
  role: CreativeReviewRole;
  priority: EscalationPriority;
  /** Hours until deadline. */
  deadlineHours: number;
}> = {
  severe_governance_violation:   { level: 'critical',  role: 'brand_manager',        priority: 'p2', deadlineHours: 24 },
  repeated_qa_failures:          { level: 'high',      role: 'compliance_reviewer',  priority: 'p3', deadlineHours: 48 },
  repeated_off_brand_output:     { level: 'high',      role: 'brand_manager',        priority: 'p2', deadlineHours: 24 },
  unsafe_realism_drift:          { level: 'critical',  role: 'compliance_reviewer',  priority: 'p2', deadlineHours: 24 },
  repeated_retry_exhaustion:     { level: 'high',      role: 'creative_director',    priority: 'p3', deadlineHours: 48 },
  campaign_coherence_collapse:   { level: 'high',      role: 'creative_director',    priority: 'p3', deadlineHours: 48 },
  legal_risk:                    { level: 'executive', role: 'legal_reviewer',       priority: 'p1', deadlineHours: 12 },
  executive_review:              { level: 'executive', role: 'executive_reviewer',   priority: 'p1', deadlineHours: 12 },
  manual_escalation:             { level: 'routine',   role: 'creative_director',    priority: 'p4', deadlineHours: 72 },
};

/* ── Auto-detection signals ─────────────────────────────────────────── */

/** Decide whether the asset's signals warrant automatic escalation. */
export function decideEscalationReason(input: {
  governanceScore?: number | null;
  governanceRejected?: boolean;
  qaScore?: number | null;
  qaSeverity?: 'pass' | 'warning' | 'fail' | 'reject';
  retryCount?: number | null;
  governanceViolationCount?: number | null;
  campaignConsistencyScore?: number | null;
  legalRiskSignal?: boolean;
}): EscalationReason | null {
  if (input.legalRiskSignal) return 'legal_risk';
  if (input.governanceRejected) return 'severe_governance_violation';
  if (input.qaSeverity === 'reject') return 'severe_governance_violation';
  if ((input.governanceScore ?? 100) < 40) return 'severe_governance_violation';
  if ((input.qaScore ?? 100) < 35) return 'unsafe_realism_drift';
  if ((input.retryCount ?? 0) >= 3) return 'repeated_retry_exhaustion';
  if ((input.governanceViolationCount ?? 0) >= 3) return 'repeated_off_brand_output';
  if ((input.campaignConsistencyScore ?? 100) < 50) return 'campaign_coherence_collapse';
  if (input.qaSeverity === 'fail' && (input.retryCount ?? 0) >= 2) return 'repeated_qa_failures';
  return null;
}

/* ── Public entry point ─────────────────────────────────────────────── */

const escalationStore = new Map<string, Escalation[]>();
const MAX_ESCALATIONS_PER_ORG = 200;

function escalationId(): string {
  return `esc-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function issueEscalation(context: EscalationContext): Escalation {
  const route = ROUTING_MATRIX[context.reason];
  // Phase 9 — consult the escalation-loop protection BEFORE issuing.
  const capCheck = incrementEscalationCount(context.assetId);
  const escalation: Escalation = {
    escalationId: escalationId(),
    assetId: context.assetId,
    companyId: context.companyId,
    campaignId: context.campaignId ?? null,
    reason: context.reason,
    escalationLevel: route.level,
    assignedReviewRole: route.role,
    escalationPriority: route.priority,
    escalationDeadline: new Date(Date.now() + route.deadlineHours * 60 * 60 * 1000).toISOString(),
    notes: context.notes ?? null,
    requestedByUserId: context.requestedByUserId ?? null,
    requestedByRole: context.requestedByRole ?? null,
    createdAt: new Date().toISOString(),
    capReached: !capCheck.allowed,
  };
  // Persist into the per-org store with bounded growth.
  const orgKey = context.companyId.trim().toLowerCase();
  const list = escalationStore.get(orgKey) ?? [];
  list.push(escalation);
  if (list.length > MAX_ESCALATIONS_PER_ORG) {
    list.splice(0, list.length - MAX_ESCALATIONS_PER_ORG);
  }
  escalationStore.set(orgKey, list);
  return escalation;
}

export function listEscalationsForCompany(companyId: string): ReadonlyArray<Escalation> {
  return escalationStore.get(companyId.trim().toLowerCase()) ?? [];
}

export function listEscalationsForAsset(assetId: string): ReadonlyArray<Escalation> {
  const out: Escalation[] = [];
  for (const list of escalationStore.values()) {
    for (const e of list) {
      if (e.assetId === assetId) out.push(e);
    }
  }
  return out;
}

export function clearAllEscalations(): void {
  escalationStore.clear();
}

export function escalationStats(): { orgCount: number; maxPerOrg: number; totalEscalations: number } {
  let total = 0;
  for (const list of escalationStore.values()) total += list.length;
  return { orgCount: escalationStore.size, maxPerOrg: MAX_ESCALATIONS_PER_ORG, totalEscalations: total };
}
