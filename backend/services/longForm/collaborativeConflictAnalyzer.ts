/**
 * Phase 8 — Collaborative conflict analyzer.
 *
 * Scans the revision tree for contradictory edits across reviewers.
 * Detection types:
 *   - CONTRADICTORY_REVIEWER_EDITS    same section, opposing prose
 *   - CONFLICTING_STRATEGIC_EDITS     strategist + other role with opposing narrative changes
 *   - CONFLICTING_FACTUAL_EDITS       factual content swung opposite directions
 *   - CONFLICTING_TERMINOLOGY_CHANGES one editor added a term, another removed
 *   - APPROVAL_DEADLOCK               2+ reviewers each blocked + opposing requests
 */

import type {
  ApprovalReadinessResult,
  CollaborativeConflict,
  CollaborativeConflictResult,
  CollaborativeConflictType,
  EditorialDiffAnalysis,
  Revision,
  RevisionBranch,
} from './longFormRecommendationTypes';

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

export interface AnalyzeCollaborativeConflictsInput {
  branch: RevisionBranch;
  analysesByRevisionId: Map<string, EditorialDiffAnalysis[]>;
  approval?: ApprovalReadinessResult;
}

export function analyzeCollaborativeConflicts(input: AnalyzeCollaborativeConflictsInput): CollaborativeConflictResult {
  const conflicts: CollaborativeConflict[] = [];

  // Build per-section edit lists (only revisions that touched the section).
  const editsBySection = new Map<string, Array<{ rev: Revision; before: string; after: string }>>();
  const revisions = Object.values(input.branch.revisionTree).filter((r) => r.parentRevisionId !== null);
  for (const rev of revisions) {
    for (const edit of rev.affectedSections) {
      const arr = editsBySection.get(edit.sectionId) ?? [];
      arr.push({ rev, before: edit.beforeHtml, after: edit.afterHtml });
      editsBySection.set(edit.sectionId, arr);
    }
  }

  function classifyByEditors(revsA: Revision, revsB: Revision): {
    type: CollaborativeConflictType;
    severity: 'low' | 'medium' | 'high';
  } {
    // CONFLICTING_STRATEGIC_EDITS when at least one revision is strategist.
    const isStrategic = revsA.editorIdentityType === 'strategist' || revsB.editorIdentityType === 'strategist';
    return {
      type: isStrategic ? 'CONFLICTING_STRATEGIC_EDITS' : 'CONTRADICTORY_REVIEWER_EDITS',
      severity: isStrategic ? 'high' : 'medium',
    };
  }

  // 1. CONTRADICTORY_REVIEWER_EDITS + CONFLICTING_STRATEGIC_EDITS — per section, revisions by different editors that flip prose.
  for (const [sectionId, edits] of editsBySection) {
    if (edits.length < 2) continue;
    edits.sort((a, b) => a.rev.revisionTimestamp.localeCompare(b.rev.revisionTimestamp));
    for (let i = 1; i < edits.length; i += 1) {
      const prev = edits[i - 1];
      const curr = edits[i];
      const sameEditor = prev.rev.editorIdentityType === curr.rev.editorIdentityType
        && prev.rev.editorId === curr.rev.editorId;
      if (sameEditor) continue;
      const overlap = jaccard(tokens(stripHtml(prev.after)), tokens(stripHtml(curr.after)));
      // High overlap + reverted negation polarity OR > 50% token churn → contradictory.
      const stripPrev = stripHtml(prev.after);
      const stripCurr = stripHtml(curr.after);
      const prevNeg = /\b(not|never|avoid(?:ing|s|ed)?)\b/i.test(stripPrev);
      const currNeg = /\b(not|never|avoid(?:ing|s|ed)?)\b/i.test(stripCurr);
      const polarityFlip = prevNeg !== currNeg;
      const revertsToParent = stripHtml(curr.after) === stripHtml(prev.before);
      if (polarityFlip && overlap > 0.4) {
        const { type, severity } = classifyByEditors(prev.rev, curr.rev);
        conflicts.push({
          type, severity, sectionId,
          involvedRevisionIds: [prev.rev.revisionId, curr.rev.revisionId],
          detail: `Section ${sectionId}: ${prev.rev.editorIdentityType} → ${curr.rev.editorIdentityType} flipped negation polarity (overlap=${overlap.toFixed(2)}).`,
        });
      } else if (revertsToParent) {
        const { type, severity } = classifyByEditors(prev.rev, curr.rev);
        conflicts.push({
          type, severity, sectionId,
          involvedRevisionIds: [prev.rev.revisionId, curr.rev.revisionId],
          detail: `Section ${sectionId}: ${curr.rev.editorIdentityType} (rev ${curr.rev.revisionId}) reverted ${prev.rev.editorIdentityType}'s changes (rev ${prev.rev.revisionId}).`,
        });
      }
    }
  }

  // 2. CONFLICTING_FACTUAL_EDITS — revisions whose diff analyses both flagged factual_degradation or unsupported_addition on overlapping sections.
  const editorsByFactualRisk = new Map<string, Set<string>>(); // sectionId → set of editorTypes
  for (const rev of revisions) {
    const analyses = input.analysesByRevisionId.get(rev.revisionId) ?? [];
    for (const a of analyses) {
      if (a.detectedRisks.some((r) => r.type === 'factual_degradation' || r.type === 'unsupported_addition')) {
        const set = editorsByFactualRisk.get(a.sectionId) ?? new Set();
        set.add(`${rev.editorIdentityType}:${rev.revisionId}`);
        editorsByFactualRisk.set(a.sectionId, set);
      }
    }
  }
  for (const [sectionId, editorSet] of editorsByFactualRisk) {
    if (editorSet.size >= 2) {
      conflicts.push({
        type: 'CONFLICTING_FACTUAL_EDITS', severity: 'high', sectionId,
        involvedRevisionIds: Array.from(editorSet).map((e) => e.split(':')[1]),
        detail: `Section ${sectionId}: ${editorSet.size} editors each introduced factual risk.`,
      });
    }
  }

  // 3. CONFLICTING_TERMINOLOGY_CHANGES — one revision flagged terminology_removal, another revision restored those terms.
  for (const sectionId of editsBySection.keys()) {
    const sectionEdits = editsBySection.get(sectionId)!;
    const removerRevs: Revision[] = [];
    const restorerRevs: Revision[] = [];
    for (const e of sectionEdits) {
      const analyses = input.analysesByRevisionId.get(e.rev.revisionId) ?? [];
      const removed = analyses.some((a) => a.detectedRisks.some((r) => r.type === 'terminology_removal'));
      if (removed) {
        removerRevs.push(e.rev);
      } else {
        // Restoration check — would need terminology diff; approximate via afterHtml having more tokens than beforeHtml.
        if (tokens(stripHtml(e.after)).size > tokens(stripHtml(e.before)).size + 5) restorerRevs.push(e.rev);
      }
    }
    if (removerRevs.length > 0 && restorerRevs.length > 0) {
      // Only count when different editors involved.
      const editors = new Set([
        ...removerRevs.map((r) => r.editorIdentityType),
        ...restorerRevs.map((r) => r.editorIdentityType),
      ]);
      if (editors.size > 1) {
        conflicts.push({
          type: 'CONFLICTING_TERMINOLOGY_CHANGES', severity: 'medium', sectionId,
          involvedRevisionIds: [...removerRevs, ...restorerRevs].map((r) => r.revisionId),
          detail: `Section ${sectionId}: one editor removed terminology, another expanded the text (likely re-introducing terms).`,
        });
      }
    }
  }

  // 4. APPROVAL_DEADLOCK — supplied approval state indicates ≥ 2 reviewers blocked.
  if (input.approval) {
    const blockedRoles = Object.entries(input.approval.perReviewerState)
      .filter(([, state]) => state === 'blocked')
      .map(([role]) => role);
    if (blockedRoles.length >= 2) {
      conflicts.push({
        type: 'APPROVAL_DEADLOCK', severity: 'high',
        involvedRevisionIds: [],
        detail: `${blockedRoles.length} reviewer roles blocked: ${blockedRoles.join(', ')}.`,
      });
    }
  }

  // Severity aggregate.
  let aggregate: 'none' | 'low' | 'medium' | 'high' = 'none';
  for (const c of conflicts) {
    if (c.severity === 'high') { aggregate = 'high'; break; }
    if (c.severity === 'medium' && (aggregate as string) !== 'high') aggregate = 'medium';
    if (c.severity === 'low' && aggregate === 'none') aggregate = 'low';
  }

  const resolutionRecommendations = conflicts.map((c, i) => {
    let action: string;
    let reason: string;
    switch (c.type) {
      case 'CONTRADICTORY_REVIEWER_EDITS':
        action = 'merge_with_strategist_arbitration';
        reason = 'Two reviewers proposed opposing changes — escalate to strategist for arbitration.';
        break;
      case 'CONFLICTING_STRATEGIC_EDITS':
        action = 'prefer_strategist_authority';
        reason = 'Strategist authority outweighs other reviewer roles for narrative decisions.';
        break;
      case 'CONFLICTING_FACTUAL_EDITS':
        action = 'compliance_arbitration';
        reason = 'Factual conflicts require compliance review and source verification.';
        break;
      case 'CONFLICTING_TERMINOLOGY_CHANGES':
        action = 'lock_terminology_to_contract';
        reason = 'Use the section contract terminology emphasis as the authoritative source.';
        break;
      case 'APPROVAL_DEADLOCK':
        action = 'reset_and_consolidate_review';
        reason = 'Reset blocked reviewer states; consolidate feedback into a single revision.';
        break;
    }
    return { conflictIndex: i, action, reason };
  });

  return { conflicts, conflictSeverity: aggregate, resolutionRecommendations };
}
