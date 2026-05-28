/**
 * Phase 7 — Revision recovery coordinator.
 *
 * Builds a cheapest-first recovery plan keyed to the diff-analysis
 * detections + drift indicators + collaborative conflicts. Avoids full
 * article rollback when a targeted fix exists.
 */

import type {
  CollaborativeConflictResult,
  EditRiskDetection,
  EditorialDiffAnalysis,
  HumanAIDriftResult,
  RevisionRecoveryAction,
  RevisionRecoveryPlan,
  RevisionRecoveryStep,
} from './longFormRecommendationTypes';

const ACTION_ORDER: RevisionRecoveryAction[] = [
  'restore_terminology_continuity',
  'restore_removed_citations',
  'restore_operational_realism',
  'restore_strategic_framing',
  'revert_unsupported_edits',
  'reconcile_conflicting_revisions',
  'regenerate_damaged_section_portions',
];

interface ActionMeta {
  cost: 'low' | 'medium' | 'high';
  reason: string;
}

const ACTION_META: Record<RevisionRecoveryAction, ActionMeta> = {
  restore_removed_citations: { cost: 'low', reason: 'Re-attach citation markers that were stripped during the revision.' },
  restore_terminology_continuity: { cost: 'low', reason: 'Reintroduce domain/strategic terms that the revision removed.' },
  restore_strategic_framing: { cost: 'medium', reason: 'Restore the strategic narrative arc the revision diluted.' },
  restore_operational_realism: { cost: 'medium', reason: 'Restore operational verbs / decision sequences that were simplified.' },
  revert_unsupported_edits: { cost: 'medium', reason: 'Roll back to the parent revision\'s section text for unsupported additions.' },
  reconcile_conflicting_revisions: { cost: 'medium', reason: 'Merge contradictory editor changes using the higher-trust source.' },
  regenerate_damaged_section_portions: { cost: 'high', reason: 'Re-generate damaged section portions from the section contract.' },
};

const RISK_TO_ACTIONS: Record<EditRiskDetection['type'], RevisionRecoveryAction[]> = {
  citation_removal: ['restore_removed_citations'],
  terminology_removal: ['restore_terminology_continuity'],
  operational_simplification: ['restore_operational_realism'],
  strategic_narrative_drift: ['restore_strategic_framing'],
  icp_erosion: ['restore_strategic_framing'],
  capability_suppression: ['restore_strategic_framing', 'regenerate_damaged_section_portions'],
  tone_mutation: ['restore_strategic_framing'],
  factual_degradation: ['revert_unsupported_edits', 'regenerate_damaged_section_portions'],
  unsupported_addition: ['revert_unsupported_edits'],
};

export interface BuildRevisionRecoveryInput {
  diffAnalyses: EditorialDiffAnalysis[];
  drift?: HumanAIDriftResult;
  conflicts?: CollaborativeConflictResult;
}

export function buildRevisionRecoveryPlan(input: BuildRevisionRecoveryInput): RevisionRecoveryPlan {
  const candidates = new Map<RevisionRecoveryAction, { targets: Set<string>; sections: Set<string> }>();
  function add(action: RevisionRecoveryAction, target: string, sectionId?: string) {
    let entry = candidates.get(action);
    if (!entry) { entry = { targets: new Set(), sections: new Set() }; candidates.set(action, entry); }
    entry.targets.add(target);
    if (sectionId) entry.sections.add(sectionId);
  }

  // 1. From diff analyses.
  for (const analysis of input.diffAnalyses) {
    for (const risk of analysis.detectedRisks) {
      const actions = RISK_TO_ACTIONS[risk.type] ?? [];
      for (const a of actions) {
        if (risk.severity === 'high' || analysis.editRiskScore >= 40) {
          add(a, risk.type, analysis.sectionId);
        } else if (risk.severity === 'medium') {
          add(a, risk.type, analysis.sectionId);
        }
      }
    }
  }

  // 2. From drift indicators.
  if (input.drift) {
    for (const ind of input.drift.humanDriftIndicators) {
      if (ind.type === 'DILUTED_STRATEGY') add('restore_strategic_framing', ind.type);
      if (ind.type === 'INTRODUCED_HALLUCINATION') add('revert_unsupported_edits', ind.type);
      if (ind.type === 'COLLABORATIVE_CONTRADICTION') add('reconcile_conflicting_revisions', ind.type);
    }
    for (const ind of input.drift.aiDriftIndicators) {
      if (ind.type === 'OVERFIT_RECOVERY') add('revert_unsupported_edits', ind.type);
      if (ind.type === 'WEAKENED_NUANCE') add('restore_strategic_framing', ind.type);
      if (ind.type === 'CONTRADICTED_EDIT') add('reconcile_conflicting_revisions', ind.type);
    }
  }

  // 3. From collaborative conflicts.
  if (input.conflicts) {
    for (const c of input.conflicts.conflicts) {
      if (c.type === 'APPROVAL_DEADLOCK') {
        add('reconcile_conflicting_revisions', c.type, c.sectionId);
      } else if (c.severity === 'high') {
        add('reconcile_conflicting_revisions', c.type, c.sectionId);
        // Severe conflicts may warrant full section regeneration.
        add('regenerate_damaged_section_portions', c.type, c.sectionId);
      } else {
        add('reconcile_conflicting_revisions', c.type, c.sectionId);
      }
    }
  }

  // Emit in cheap-first order.
  const steps: RevisionRecoveryStep[] = [];
  let order = 1;
  for (const action of ACTION_ORDER) {
    const entry = candidates.get(action);
    if (!entry) continue;
    steps.push({
      order: order++,
      action,
      targets: Array.from(entry.targets),
      reason: ACTION_META[action].reason,
      affectedSectionIds: Array.from(entry.sections),
    });
  }

  const totalCost: RevisionRecoveryPlan['estimatedCost'] = steps.some((s) => ACTION_META[s.action].cost === 'high')
    ? 'high'
    : steps.some((s) => ACTION_META[s.action].cost === 'medium')
      ? 'medium'
      : 'low';

  return { steps, estimatedCost: totalCost };
}
