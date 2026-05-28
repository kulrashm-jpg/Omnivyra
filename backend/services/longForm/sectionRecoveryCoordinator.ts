/**
 * Phase 5 — Section recovery coordinator.
 *
 * Given a section's continuity + generic-suppression result, build a
 * targeted recovery plan. Each step is a hint the regeneration call (via
 * the injected SectionGenerator) honors.
 *
 * Mapping is intentionally narrow: each failure type maps to one or two
 * cheap actions. The full `regenerate_section` is reserved for cases where
 * targeted fixes can't recover the dimension.
 */

import type {
  GenericWritingSuppressionResult,
  SectionContinuityResult,
  SectionRecoveryAction,
  SectionRecoveryPlan,
  SectionRecoveryStep,
} from './longFormRecommendationTypes';

interface ActionMeta {
  estimatedCost: 'low' | 'medium' | 'high';
}

const ACTION_META: Record<SectionRecoveryAction, ActionMeta> = {
  reinforce_terminology: { estimatedCost: 'low' },
  restore_operational_proof: { estimatedCost: 'low' },
  restore_icp_specificity: { estimatedCost: 'low' },
  restore_capability_emphasis: { estimatedCost: 'low' },
  restore_strategic_narrative: { estimatedCost: 'medium' },
  restore_sequencing_continuity: { estimatedCost: 'medium' },
  regenerate_section: { estimatedCost: 'high' },
};

const DETECTION_TO_ACTION: Record<string, SectionRecoveryAction[]> = {
  SECTION_GENERIC_COLLAPSE: ['restore_strategic_narrative', 'restore_operational_proof', 'regenerate_section'],
  OPERATIONAL_FLATTENING: ['restore_operational_proof'],
  SEO_OVERFITTING: ['restore_strategic_narrative', 'restore_capability_emphasis'],
  TERMINOLOGY_DRIFT: ['reinforce_terminology'],
  ICP_EROSION_SECTION: ['restore_icp_specificity'],
  CAPABILITY_DISAPPEARANCE: ['restore_capability_emphasis'],
  NARRATIVE_SIMPLIFICATION: ['restore_strategic_narrative', 'restore_sequencing_continuity'],
  // Generic suppression detections.
  GENERIC_FILLER: ['regenerate_section'],
  GENERIC_INTRO_HOOK: ['regenerate_section'],
  BUSINESSES_TODAY: ['regenerate_section'],
  LEVERAGING_AI: ['regenerate_section'],
  EMPTY_BEST_PRACTICES: ['regenerate_section'],
  ULTIMATE_GUIDE: ['regenerate_section'],
  SHALLOW_TRANSITION: ['restore_strategic_narrative'],
  SEO_FLUFF: ['restore_capability_emphasis'],
  GENERIC_CTA: ['regenerate_section'],
  REPEATED_RHETORIC: ['regenerate_section'],
};

const ACTION_REASONS: Record<SectionRecoveryAction, string> = {
  reinforce_terminology: 'Re-inject domain + strategic vocabulary into the section prompt.',
  restore_operational_proof: 'Inject the recommendation operational proof items as named decision points.',
  restore_icp_specificity: 'Restore explicit ICP language + pain-point mapping.',
  restore_capability_emphasis: 'Force the primary capability + workflow category into the section opening.',
  restore_strategic_narrative: 'Re-anchor the section to the strategic narrative tone + arc.',
  restore_sequencing_continuity: 'Restore the section\'s position in the staged progression (intro/framework/apply/insight).',
  regenerate_section: 'Regenerate the section from scratch with all failed dimensions surfaced as hard constraints.',
};

// Order strategies cheapest-first.
const STRATEGY_ORDER: SectionRecoveryAction[] = [
  'reinforce_terminology',
  'restore_operational_proof',
  'restore_icp_specificity',
  'restore_capability_emphasis',
  'restore_sequencing_continuity',
  'restore_strategic_narrative',
  'regenerate_section',
];

export interface BuildSectionRecoveryInput {
  continuity: SectionContinuityResult;
  generic: GenericWritingSuppressionResult;
}

export function buildSectionRecoveryPlan(input: BuildSectionRecoveryInput): SectionRecoveryPlan {
  const candidates = new Map<SectionRecoveryAction, Set<string>>();

  for (const det of input.continuity.detections) {
    const actions = DETECTION_TO_ACTION[det.type] ?? [];
    for (const a of actions) {
      if (!candidates.has(a)) candidates.set(a, new Set());
      candidates.get(a)!.add(det.type);
    }
  }
  for (const det of input.generic.detections) {
    const actions = DETECTION_TO_ACTION[det.type] ?? [];
    for (const a of actions) {
      if (!candidates.has(a)) candidates.set(a, new Set());
      candidates.get(a)!.add(det.type);
    }
  }

  // If genericity hard-blocked OR multiple high-severity continuity issues, force regenerate.
  const hardCriticality =
    input.generic.hardBlocked
    || input.continuity.detections.filter((d) => d.severity === 'high').length >= 2;
  if (hardCriticality && !candidates.has('regenerate_section')) {
    candidates.set('regenerate_section', new Set(['HARD_BLOCK']));
  }

  const steps: SectionRecoveryStep[] = [];
  let order = 1;
  for (const action of STRATEGY_ORDER) {
    if (!candidates.has(action)) continue;
    const targets = Array.from(candidates.get(action)!);
    steps.push({
      order: order++,
      action,
      targets,
      reason: `${ACTION_REASONS[action]} Targets: ${targets.join(', ')}.`,
    });
  }

  const totalCost: SectionRecoveryPlan['estimatedCost'] = steps.some((s) => ACTION_META[s.action].estimatedCost === 'high') ? 'high'
    : steps.some((s) => ACTION_META[s.action].estimatedCost === 'medium') ? 'medium'
    : 'low';

  return { steps, estimatedCost: totalCost };
}

export function sectionPassesGovernance(
  continuity: SectionContinuityResult,
  generic: GenericWritingSuppressionResult,
  thresholds: {
    sectionContinuityFloor: number;
    strategicIntegrityFloor: number;
    operationalIntegrityFloor: number;
    genericityCeiling: number;
  },
): boolean {
  if (generic.hardBlocked) return false;
  if (generic.genericityPressureScore > thresholds.genericityCeiling) return false;
  if (continuity.sectionContinuityScore < thresholds.sectionContinuityFloor) return false;
  if (continuity.sectionStrategicIntegrityScore < thresholds.strategicIntegrityFloor) return false;
  if (continuity.sectionOperationalIntegrityScore < thresholds.operationalIntegrityFloor) return false;
  // Any high-severity continuity detection blocks.
  if (continuity.detections.some((d) => d.severity === 'high')) return false;
  return true;
}
