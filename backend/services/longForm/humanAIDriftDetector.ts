/**
 * Phase 3 — Human vs AI drift detector.
 *
 * Walks the diff analyses produced for every revision in a branch and
 * classifies drift signals by who introduced them:
 *
 *   Human drift indicators:
 *     - WEAKENED_INTEGRITY            human edit reduces sectionContinuity
 *     - INTRODUCED_HALLUCINATION      human edit raises hallucinationPressure
 *     - DILUTED_STRATEGY              human edit drops capability/strategic terms
 *     - COLLABORATIVE_CONTRADICTION   two human revisions contradict each other
 *
 *   AI drift indicators:
 *     - WEAKENED_NUANCE       AI recovery pass strips hedge / opinion language
 *     - OVERFIT_RECOVERY      AI recovery pass over-applies an action (e.g. removes too much)
 *     - CONTRADICTED_EDIT     AI recovery pass undoes a human edit
 */

import type {
  AIDriftIndicator,
  EditRiskDetection,
  EditorialDiffAnalysis,
  HumanAIDriftResult,
  HumanDriftIndicator,
  Revision,
  RevisionBranch,
} from './longFormRecommendationTypes';

function originIsHuman(rev: Revision): boolean {
  return rev.revisionOrigin === 'human_edit' || rev.revisionOrigin === 'approval_revision';
}

function originIsAi(rev: Revision): boolean {
  return rev.revisionOrigin === 'ai_generation' || rev.revisionOrigin === 'recovery_pass';
}

function hasRisk(analyses: EditorialDiffAnalysis[], type: EditRiskDetection['type']): boolean {
  return analyses.some((a) => a.detectedRisks.some((r) => r.type === type));
}

function maxSeverityForType(analyses: EditorialDiffAnalysis[], type: EditRiskDetection['type']): 'low' | 'medium' | 'high' | null {
  const order = ['low', 'medium', 'high'];
  let best: number = -1;
  for (const a of analyses) {
    for (const r of a.detectedRisks) {
      if (r.type === type) {
        const rank = order.indexOf(r.severity);
        if (rank > best) best = rank;
      }
    }
  }
  return best === -1 ? null : (order[best] as 'low' | 'medium' | 'high');
}

export interface DetectHumanAIDriftInput {
  branch: RevisionBranch;
  /** Map revisionId → analyses (one entry per affected section). */
  analysesByRevisionId: Map<string, EditorialDiffAnalysis[]>;
}

export function detectHumanAIDrift(input: DetectHumanAIDriftInput): HumanAIDriftResult {
  const humanIndicators: HumanDriftIndicator[] = [];
  const aiIndicators: AIDriftIndicator[] = [];

  const revisions = Object.values(input.branch.revisionTree).filter((r) => r.parentRevisionId !== null);
  let humanCount = 0;
  let aiCount = 0;
  let humanWithDrift = 0;
  let aiWithDrift = 0;

  for (const rev of revisions) {
    const analyses = input.analysesByRevisionId.get(rev.revisionId) ?? [];
    if (analyses.length === 0) continue;

    const isHuman = originIsHuman(rev);
    const isAi = originIsAi(rev);
    if (isHuman) humanCount += 1;
    if (isAi) aiCount += 1;

    if (isHuman) {
      let revisionHadDrift = false;
      // WEAKENED_INTEGRITY: edit risk + continuity drop
      const continuityDrop = analyses.find((a) => a.continuityImpactScore < 80);
      if (continuityDrop) {
        humanIndicators.push({
          type: 'WEAKENED_INTEGRITY',
          detail: `Section ${continuityDrop.sectionId}: continuityImpact=${continuityDrop.continuityImpactScore} after human edit by ${rev.editorIdentityType}.`,
          severity: continuityDrop.continuityImpactScore < 60 ? 'high' : 'medium',
          revisionId: rev.revisionId,
        });
        revisionHadDrift = true;
      }
      // INTRODUCED_HALLUCINATION
      if (hasRisk(analyses, 'unsupported_addition') || hasRisk(analyses, 'factual_degradation')) {
        const sev = maxSeverityForType(analyses, 'unsupported_addition') ?? maxSeverityForType(analyses, 'factual_degradation') ?? 'medium';
        humanIndicators.push({
          type: 'INTRODUCED_HALLUCINATION',
          detail: `Human edit added unsupported claims or raised hallucination pressure (severity ${sev}).`,
          severity: sev,
          revisionId: rev.revisionId,
        });
        revisionHadDrift = true;
      }
      // DILUTED_STRATEGY
      if (hasRisk(analyses, 'terminology_removal') || hasRisk(analyses, 'capability_suppression') || hasRisk(analyses, 'strategic_narrative_drift')) {
        humanIndicators.push({
          type: 'DILUTED_STRATEGY',
          detail: 'Human edit removed strategic terminology, suppressed capability, or drifted from strategic narrative.',
          severity: 'medium',
          revisionId: rev.revisionId,
        });
        revisionHadDrift = true;
      }
      if (revisionHadDrift) humanWithDrift += 1;
    }

    if (isAi) {
      let revisionHadDrift = false;
      // WEAKENED_NUANCE: AI recovery passes that strip hedge or assertive→tentative tone.
      if (hasRisk(analyses, 'tone_mutation')) {
        aiIndicators.push({
          type: 'WEAKENED_NUANCE',
          detail: 'AI recovery pass mutated tone (assertive ↔ tentative).',
          severity: 'medium',
          revisionId: rev.revisionId,
        });
        revisionHadDrift = true;
      }
      // OVERFIT_RECOVERY: AI pass that removed citations OR terminology beyond expectation.
      if (hasRisk(analyses, 'citation_removal') || hasRisk(analyses, 'operational_simplification')) {
        const sev = maxSeverityForType(analyses, 'citation_removal') ?? maxSeverityForType(analyses, 'operational_simplification') ?? 'medium';
        aiIndicators.push({
          type: 'OVERFIT_RECOVERY',
          detail: 'AI recovery removed citations or simplified operational language unexpectedly.',
          severity: sev,
          revisionId: rev.revisionId,
        });
        revisionHadDrift = true;
      }
      // CONTRADICTED_EDIT: AI pass whose parent was a human edit, and whose diff reintroduces something the human removed.
      const parent = rev.parentRevisionId ? input.branch.revisionTree[rev.parentRevisionId] : undefined;
      if (parent && originIsHuman(parent)) {
        const parentAnalyses = input.analysesByRevisionId.get(parent.revisionId) ?? [];
        const humanRemovedTerminology = parentAnalyses.some((a) => a.detectedRisks.some((r) => r.type === 'terminology_removal'));
        const aiRestoredTerminology = analyses.some((a) => !a.detectedRisks.some((r) => r.type === 'terminology_removal'))
          && analyses.some((a) => a.editRiskScore > 0);
        if (humanRemovedTerminology && aiRestoredTerminology) {
          aiIndicators.push({
            type: 'CONTRADICTED_EDIT',
            detail: `AI recovery undid the human terminology removal from parent revision ${parent.revisionId}.`,
            severity: 'medium',
            revisionId: rev.revisionId,
          });
          revisionHadDrift = true;
        }
      }
      if (revisionHadDrift) aiWithDrift += 1;
    }
  }

  // COLLABORATIVE_CONTRADICTION: two human revisions on the same section that produce inverse edits.
  const humanEditsBySection = new Map<string, Revision[]>();
  for (const rev of revisions) {
    if (!originIsHuman(rev)) continue;
    for (const edit of rev.affectedSections) {
      const arr = humanEditsBySection.get(edit.sectionId) ?? [];
      arr.push(rev);
      humanEditsBySection.set(edit.sectionId, arr);
    }
  }
  for (const [sectionId, revs] of humanEditsBySection) {
    if (revs.length < 2) continue;
    // Heuristic: if the latest edit's afterHtml is similar to a previous edit's beforeHtml, that's a back-and-forth.
    const sortedByTime = [...revs].sort((a, b) => a.revisionTimestamp.localeCompare(b.revisionTimestamp));
    for (let i = 1; i < sortedByTime.length; i += 1) {
      const prev = sortedByTime[i - 1];
      const curr = sortedByTime[i];
      const prevEdit = prev.affectedSections.find((e) => e.sectionId === sectionId);
      const currEdit = curr.affectedSections.find((e) => e.sectionId === sectionId);
      if (!prevEdit || !currEdit) continue;
      // Strict equality check on stripped HTML for contradiction signal.
      const stripped = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (stripped(currEdit.afterHtml) === stripped(prevEdit.beforeHtml)) {
        humanIndicators.push({
          type: 'COLLABORATIVE_CONTRADICTION',
          detail: `Section ${sectionId}: revision ${curr.revisionId} reverts to the state before revision ${prev.revisionId} (back-and-forth between editors).`,
          severity: 'medium',
          revisionId: curr.revisionId,
        });
        humanWithDrift += 1; // count it once
      }
    }
  }

  return {
    humanDriftIndicators: humanIndicators,
    aiDriftIndicators: aiIndicators,
    humanDriftFrequencyPercent: humanCount === 0 ? 0 : Math.round((humanWithDrift / humanCount) * 100),
    aiDriftFrequencyPercent: aiCount === 0 ? 0 : Math.round((aiWithDrift / aiCount) * 100),
  };
}
