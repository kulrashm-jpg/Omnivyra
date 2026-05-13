/**
 * Market Pulse — Alert Classifier.
 *
 * Phase 1B: differentiates alerts into 5 classes so the existing
 * `intelligenceAlertService` can dispatch them with distinct dedup keys
 * and (downstream) distinct routing.
 *
 *   - strategic_risk        (default risk class — broad strategic threat)
 *   - competitor_escalation (named competitor mentioned in finding)
 *   - regulatory_exposure   (intersects regulatory_policy_sensitivity)
 *   - market_acceleration   (P0 opportunity in expanding/accelerating phase)
 *   - opportunity_breakout  (recurrence + escalation in opportunity tier)
 *
 * Quality gate (must qualify on ALL):
 *   - priority_tier == 'P0'  OR  (priority_tier == 'P1' AND change_status in {'updated'} AND escalated)
 *   - confidence_score >= MIN_CONFIDENCE
 *   - company_alignment_score >= MIN_ALIGNMENT  (skips findings unrelated to company)
 *   - change_status in {'new', 'updated'}        (no re-paging on unchanged)
 *
 * Reuses `sendIntelligenceAlert` machinery (rate limits, 6h dedup, channels)
 * — does NOT introduce a parallel alert system.
 */

import type { MarketPulseExecutorContext } from './executorContext';
import type { ImpactType, PriorityTier } from './scoringService';

export type AlertClass =
  | 'strategic_risk'
  | 'competitor_escalation'
  | 'regulatory_exposure'
  | 'market_acceleration'
  | 'opportunity_breakout';

export interface AlertClassifierInput {
  finding_id: string;
  title: string;
  category: string;
  impactType: ImpactType;
  priority_tier: PriorityTier;
  change_status: 'new' | 'updated' | 'unchanged' | 'resolved' | string;
  confidence_score: number;        // 0..100
  evidence_strength: number;       // 0..1
  company_alignment_score: number; // 0..1
  /** Did this finding's tier increase vs prior run? */
  was_escalated?: boolean;
  /** Recurrence (memory.times_seen). */
  times_seen_prior?: number;
  /** Mentioned named competitors (from interpretation pass). */
  mentioned_competitors?: string[];
  /** Mentioned regulatory sensitivity terms. */
  mentioned_regulatory?: string[];
  /** Narrative phase from generator. */
  narrative_phase?: string | null;
  executorContext?: MarketPulseExecutorContext | null;
  /** Phase 2: longitudinal escalation level (from marketMemoryEvolutionService.deriveEscalationLevel). */
  escalation_level?: 'first_occurrence' | 'repeated' | 'escalating_pattern' | 'market_wide_propagation' | null;
  /** Phase 2: cluster role from cross-product enrichment. */
  cluster_role?:
    | 'isolated' | 'repeated' | 'market_wide' | 'localized_anomaly'
    | 'emerging_market_shift' | 'coordinated_competitor_movement'
    | null;
  /** Phase 2: trajectory from market memory evolution. */
  trajectory?: 'accelerating' | 'fading' | 'cyclic' | 'structural' | 'stable' | null;
}

export interface AlertClassification {
  alert_class: AlertClass | null;
  should_alert: boolean;
  reason: string;
  /**
   * Phase 2: stronger interrupt for the highest-severity classes:
   *   - coordinated_competitor_movement
   *   - regulatory_exposure with escalation_level='market_wide_propagation'
   *   - structural_market_shift (cluster_role='emerging_market_shift' AND P0)
   *   - opportunity_breakout with escalation_level='escalating_pattern'
   *
   * When true, the alert dispatch path bypasses the standard 6h dedup and
   * uses sendDeterministicIntelligenceAlert with a 1h cooldown so executive
   * attention is not delayed by a previously-fired same-key alert.
   */
  executive_interrupt: boolean;
  interrupt_reason?: string;
}

const MIN_CONFIDENCE = 70;     // 0..100
const MIN_ALIGNMENT = 0.4;     // 0..1
const MIN_EVIDENCE_STRENGTH = 0.55;

/**
 * Classify a single finding. Returns alert_class for the badge regardless of
 * whether it qualifies for an actual alert dispatch — `should_alert` is the
 * gate.
 *
 * Class precedence (highest first):
 *   regulatory_exposure  → competitor_escalation → market_acceleration
 *   → opportunity_breakout → strategic_risk
 */
export function classifyFindingAlert(input: AlertClassifierInput): AlertClassification {
  // ── Class assignment (always attempted, drives the chip color in the UI) ──
  let alert_class: AlertClass | null;
  if (input.mentioned_regulatory && input.mentioned_regulatory.length > 0) {
    alert_class = 'regulatory_exposure';
  } else if (input.mentioned_competitors && input.mentioned_competitors.length > 0 && input.impactType !== 'opportunity') {
    alert_class = 'competitor_escalation';
  } else if (
    input.impactType === 'opportunity' &&
    input.priority_tier === 'P0' &&
    (String(input.narrative_phase ?? '').toUpperCase() === 'ACCELERATING' ||
     String(input.narrative_phase ?? '').toUpperCase() === 'EMERGING')
  ) {
    alert_class = 'market_acceleration';
  } else if (
    input.impactType === 'opportunity' &&
    (input.was_escalated || (input.times_seen_prior ?? 0) >= 2) &&
    input.priority_tier !== 'P2'
  ) {
    alert_class = 'opportunity_breakout';
  } else if (input.impactType === 'risk') {
    alert_class = 'strategic_risk';
  } else {
    // Watch + opportunity that doesn't meet any specialized class — leave
    // unclassified so the UI doesn't render a misleading chip.
    alert_class = null;
  }

  // ── Quality gate ─────────────────────────────────────────────────────────
  // Tier qualification: P0 always qualifies. P1 qualifies only when escalated
  // or recurring (>= 3 prior sightings).
  const tierQualifies =
    input.priority_tier === 'P0' ||
    (input.priority_tier === 'P1' && (input.was_escalated || (input.times_seen_prior ?? 0) >= 3));

  if (!tierQualifies) {
    return { alert_class, should_alert: false, reason: 'priority_tier below alert threshold', executive_interrupt: false };
  }

  if (input.change_status !== 'new' && input.change_status !== 'updated') {
    return { alert_class, should_alert: false, reason: `change_status=${input.change_status} — only new/updated alert`, executive_interrupt: false };
  }

  if (input.confidence_score < MIN_CONFIDENCE) {
    return { alert_class, should_alert: false, reason: `confidence_score ${Math.round(input.confidence_score)} < ${MIN_CONFIDENCE}`, executive_interrupt: false };
  }

  if (input.company_alignment_score < MIN_ALIGNMENT) {
    return { alert_class, should_alert: false, reason: `company_alignment_score ${input.company_alignment_score.toFixed(2)} < ${MIN_ALIGNMENT}`, executive_interrupt: false };
  }

  if (input.evidence_strength < MIN_EVIDENCE_STRENGTH) {
    return { alert_class, should_alert: false, reason: `evidence_strength ${input.evidence_strength.toFixed(2)} < ${MIN_EVIDENCE_STRENGTH}`, executive_interrupt: false };
  }

  if (!alert_class) {
    return { alert_class, should_alert: false, reason: 'no alert class assigned', executive_interrupt: false };
  }

  // ── Phase 2: executive interrupt evaluation ─────────────────────────────────
  let executive_interrupt = false;
  let interrupt_reason: string | undefined;
  if (input.cluster_role === 'coordinated_competitor_movement') {
    executive_interrupt = true;
    interrupt_reason = 'Coordinated competitor movement detected across run.';
  } else if (alert_class === 'regulatory_exposure' && input.escalation_level === 'market_wide_propagation') {
    executive_interrupt = true;
    interrupt_reason = 'Regulatory exposure spreading market-wide.';
  } else if (input.cluster_role === 'emerging_market_shift' && input.priority_tier === 'P0') {
    executive_interrupt = true;
    interrupt_reason = 'Structural market shift in P0.';
  } else if (alert_class === 'opportunity_breakout' && input.escalation_level === 'escalating_pattern') {
    executive_interrupt = true;
    interrupt_reason = 'Opportunity breakout with escalating pattern.';
  }

  return {
    alert_class,
    should_alert: true,
    reason: `${alert_class} qualifies (P=${input.priority_tier}, conf=${Math.round(input.confidence_score)}, evidence=${input.evidence_strength.toFixed(2)}, align=${input.company_alignment_score.toFixed(2)}${input.escalation_level ? `, escalation=${input.escalation_level}` : ''})`,
    executive_interrupt,
    interrupt_reason,
  };
}

/**
 * Bucket a list of classifications into per-class digests so callers fire
 * ONE alert per class per run (instead of one per finding). This is what
 * keeps the existing 6h alert dedup useful — the alert_rule_key includes
 * event_type, and we set event_type per class.
 */
export interface AlertDigestBucket {
  alert_class: AlertClass;
  count: number;
  top_finding_id: string;
  top_finding_title: string;
  top_confidence: number;
  member_finding_ids: string[];
  /** Phase 2: any qualifying finding in this bucket triggered the executive-interrupt path. */
  executive_interrupt: boolean;
  interrupt_reasons: string[];
}

export function bucketAlerts(
  classifications: Array<{ input: AlertClassifierInput; classification: AlertClassification }>,
): AlertDigestBucket[] {
  const byClass = new Map<AlertClass, Array<{ input: AlertClassifierInput; classification: AlertClassification }>>();
  for (const { input, classification } of classifications) {
    if (!classification.should_alert || !classification.alert_class) continue;
    const cls = classification.alert_class;
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push({ input, classification });
  }
  const out: AlertDigestBucket[] = [];
  for (const [cls, members] of byClass) {
    members.sort((a, b) => b.input.confidence_score - a.input.confidence_score);
    const top = members[0].input;
    const interrupt_reasons = Array.from(
      new Set(
        members
          .filter((m) => m.classification.executive_interrupt && m.classification.interrupt_reason)
          .map((m) => m.classification.interrupt_reason as string),
      ),
    );
    out.push({
      alert_class: cls,
      count: members.length,
      top_finding_id: top.finding_id,
      top_finding_title: top.title,
      top_confidence: top.confidence_score,
      member_finding_ids: members.map((m) => m.input.finding_id),
      executive_interrupt: interrupt_reasons.length > 0,
      interrupt_reasons,
    });
  }
  return out;
}
