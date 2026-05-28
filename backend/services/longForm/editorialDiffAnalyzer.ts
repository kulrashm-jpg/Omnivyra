/**
 * Phase 2 — Editorial diff analyzer.
 *
 * For each `RevisionSectionEdit { sectionId, beforeHtml, afterHtml }`,
 * compute an editRiskScore + 4 delta scores + per-risk detections across
 * 9 risk types.
 *
 * Deterministic; no LLM. Reuses governance modules from prior phases:
 *   - sectionContinuityGovernor for continuity delta
 *   - hallucinationSuppressionGovernor for factual delta
 *   - claimExtractionEngine to detect added/removed claims
 *   - extracts citation markers via regex
 */

import type {
  EditRiskDetection,
  EditRiskType,
  EditorialDiffAnalysis,
  SectionGenerationContract,
} from './longFormRecommendationTypes';
import { governSectionContinuity } from './sectionContinuityGovernor';
import { suppressHallucinations } from './hallucinationSuppressionGovernor';
import { extractClaims } from './claimExtractionEngine';

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

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const re of patterns) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const g = new RegExp(re.source, flags);
    const matches = text.match(g);
    if (matches) count += matches.length;
  }
  return count;
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

const CITATION_MARKERS = [
  /\baccording to\b/i,
  /\bper (?:the |a )?[A-Z][a-zA-Z]+/,
  /\bas reported by\b/i,
  /\bcited by\b/i,
  /\[\d+\]/,
  /<cite[\s>]/i,
  /<a [^>]*href=/i,
  /\bin our (?:experience|deployment|practice|customer base)\b/i,
];

const HEDGE_MARKERS = [
  /\b(may|might|could|often|typically|usually|generally|in many cases)\b/i,
];

const ASSERTIVE_MARKERS = [
  /\b(must|only works|requires|never|always|critical)\b/i,
];

const OPERATIONAL_VERBS = [
  /\binstrument(?:s|ed|ing)?\b/i, /\bdeploy(?:s|ed|ing)?\b/i, /\broute(?:s|d|ing)?\b/i,
  /\bsequence(?:s|d|ing)?\b/i, /\benforce(?:s|d|ing)?\b/i, /\borchestrate(?:s|d|ing)?\b/i,
  /\bvalidate(?:s|d|ing)?\b/i, /\bobserve(?:s|d|ing)?\b/i, /\bmonitor(?:s|ed|ing)?\b/i,
  /\bdetect(?:s|ed|ing)?\b/i, /\bescalate(?:s|d|ing)?\b/i, /\baudit(?:s|ed|ing)?\b/i,
];

function detectToneShift(before: string, after: string): 'assertive_to_tentative' | 'tentative_to_assertive' | 'none' {
  const beforeAssertive = countMatches(before, ASSERTIVE_MARKERS);
  const afterAssertive = countMatches(after, ASSERTIVE_MARKERS);
  const beforeHedge = countMatches(before, HEDGE_MARKERS);
  const afterHedge = countMatches(after, HEDGE_MARKERS);
  // Density per 1000 chars.
  const factor = (count: number, len: number) => count / Math.max(len / 1000, 1);
  const beforeRatio = factor(beforeAssertive, before.length) - factor(beforeHedge, before.length);
  const afterRatio = factor(afterAssertive, after.length) - factor(afterHedge, after.length);
  if (beforeRatio > 1 && afterRatio < 0) return 'assertive_to_tentative';
  if (beforeRatio < 0 && afterRatio > 1) return 'tentative_to_assertive';
  return 'none';
}

export interface AnalyzeEditorialDiffInput {
  revisionId: string;
  contract: SectionGenerationContract;
  edits: Array<{ sectionId: string; beforeHtml: string; afterHtml: string }>;
}

export function analyzeEditorialDiff(input: AnalyzeEditorialDiffInput): EditorialDiffAnalysis[] {
  return input.edits.map((edit) => analyzeOneEdit(input.revisionId, input.contract, edit));
}

function analyzeOneEdit(
  revisionId: string,
  contract: SectionGenerationContract,
  edit: { sectionId: string; beforeHtml: string; afterHtml: string },
): EditorialDiffAnalysis {
  const before = stripHtml(edit.beforeHtml);
  const after = stripHtml(edit.afterHtml);
  const detected: EditRiskDetection[] = [];

  function detect(type: EditRiskType, severity: EditRiskDetection['severity'], detail: string, evidenceSpan?: string) {
    detected.push({ type, severity, detail, evidenceSpan });
  }

  // 1. Citation removal: count citation markers before vs. after.
  const beforeCit = countMatches(before, CITATION_MARKERS);
  const afterCit = countMatches(after, CITATION_MARKERS);
  if (beforeCit > 0 && afterCit < beforeCit) {
    detect('citation_removal', beforeCit - afterCit >= 2 ? 'high' : 'medium',
      `${beforeCit - afterCit} citation marker(s) removed (${beforeCit} → ${afterCit}).`);
  }

  // 2. Terminology removal: domain/strategic terms present in before but absent in after.
  const allTerms = [
    ...contract.terminologyEmphasis.domainVocabulary,
    ...contract.terminologyEmphasis.strategicTerminology,
  ];
  const removedTerms = allTerms.filter((t) =>
    t && before.toLowerCase().includes(t.toLowerCase()) && !after.toLowerCase().includes(t.toLowerCase()),
  );
  if (removedTerms.length > 0) {
    detect('terminology_removal', removedTerms.length >= 3 ? 'high' : removedTerms.length >= 2 ? 'medium' : 'low',
      `${removedTerms.length} terminology term(s) removed: ${removedTerms.slice(0, 3).join(', ')}${removedTerms.length > 3 ? '…' : ''}.`);
  }

  // 3. Capability suppression: primary capability present in before, absent in after.
  const cap = contract.capabilityEmphasis.primaryCapability;
  if (cap && cap.length >= 10) {
    const beforeHas = before.toLowerCase().includes(cap.toLowerCase().slice(0, 40))
      || tokens(cap).size > 0 && Array.from(tokens(cap)).every((t) => tokens(before).has(t));
    const afterHas = after.toLowerCase().includes(cap.toLowerCase().slice(0, 40))
      || tokens(cap).size > 0 && Array.from(tokens(cap)).every((t) => tokens(after).has(t));
    if (beforeHas && !afterHas) {
      detect('capability_suppression', 'high', `Primary capability "${cap.slice(0, 60)}" present in before, absent after edit.`);
    }
  }

  // 4. ICP erosion: icpProblemMapping tokens removed.
  const icp = contract.icpFraming.icpProblemMapping;
  if (icp && icp.length >= 15) {
    const icpTokens = Array.from(tokens(icp));
    if (icpTokens.length > 0) {
      const beforeHits = icpTokens.filter((t) => tokens(before).has(t)).length;
      const afterHits = icpTokens.filter((t) => tokens(after).has(t)).length;
      if (beforeHits >= 2 && afterHits < beforeHits / 2) {
        detect('icp_erosion', afterHits === 0 ? 'high' : 'medium',
          `ICP token coverage dropped from ${beforeHits}/${icpTokens.length} → ${afterHits}/${icpTokens.length}.`);
      }
    }
  }

  // 5. Operational simplification: operational verbs removed.
  const beforeOps = countMatches(before, OPERATIONAL_VERBS);
  const afterOps = countMatches(after, OPERATIONAL_VERBS);
  if (beforeOps >= 3 && afterOps < beforeOps / 2) {
    detect('operational_simplification', afterOps === 0 ? 'high' : 'medium',
      `Operational verb count dropped from ${beforeOps} → ${afterOps}.`);
  }

  // 6. Tone mutation: assertive → tentative or vice versa.
  const tone = detectToneShift(before, after);
  if (tone !== 'none') {
    detect('tone_mutation', 'medium', `Tone shifted (${tone.replace(/_/g, ' ')}).`);
  }

  // 7. Strategic narrative drift: continuity governor delta.
  const beforeCont = governSectionContinuity({ contract, sectionText: edit.beforeHtml });
  const afterCont = governSectionContinuity({ contract, sectionText: edit.afterHtml });
  const continuityImpactScore = clamp100(100 - Math.max(0, beforeCont.sectionContinuityScore - afterCont.sectionContinuityScore));
  if (beforeCont.sectionContinuityScore - afterCont.sectionContinuityScore >= 15) {
    detect('strategic_narrative_drift', beforeCont.sectionContinuityScore - afterCont.sectionContinuityScore >= 30 ? 'high' : 'medium',
      `Continuity dropped ${beforeCont.sectionContinuityScore} → ${afterCont.sectionContinuityScore}.`);
  }

  // 8. Factual degradation: hallucination pressure delta.
  const beforeHall = suppressHallucinations({ sectionText: edit.beforeHtml });
  const afterHall = suppressHallucinations({ sectionText: edit.afterHtml });
  const factualRiskDelta = afterHall.hallucinationPressureScore - beforeHall.hallucinationPressureScore;
  if (factualRiskDelta >= 15) {
    detect('factual_degradation', factualRiskDelta >= 30 ? 'high' : 'medium',
      `Hallucination pressure rose ${beforeHall.hallucinationPressureScore} → ${afterHall.hallucinationPressureScore}.`);
  }

  // 9. Unsupported additions: new high-risk claims added in the after text.
  const beforeClaims = extractClaims({ sourceSectionId: edit.sectionId, sectionText: edit.beforeHtml });
  const afterClaims = extractClaims({ sourceSectionId: edit.sectionId, sectionText: edit.afterHtml });
  const beforeClaimKeys = new Set(beforeClaims.map((c) => `${c.claimType}:${c.claimText.slice(0, 60).toLowerCase()}`));
  const newRiskyClaims = afterClaims.filter((c) =>
    !beforeClaimKeys.has(`${c.claimType}:${c.claimText.slice(0, 60).toLowerCase()}`)
    && (c.claimType === 'statistic' || c.claimType === 'benchmark_comparison'
      || (c.claimType === 'factual_claim' && c.confidenceHint === 'high')),
  );
  if (newRiskyClaims.length > 0) {
    detect('unsupported_addition', newRiskyClaims.length >= 3 ? 'high' : 'medium',
      `${newRiskyClaims.length} new high-risk claim(s) added in edit: e.g. "${newRiskyClaims[0].claimText.slice(0, 80)}".`);
  }

  // Composite scores.
  const severityWeight: Record<EditRiskDetection['severity'], number> = { low: 4, medium: 10, high: 22 };
  const editRiskScore = clamp100(detected.reduce((sum, d) => sum + severityWeight[d.severity], 0));
  // groundingRiskDelta: we don't have full source-integrity here; approximate via citation removal + unsupported additions.
  const groundingRiskDelta = clamp100(
    (Math.max(0, beforeCit - afterCit) * 12)
    + (newRiskyClaims.length * 10),
  );

  return {
    revisionId,
    sectionId: edit.sectionId,
    editRiskScore,
    continuityImpactScore,
    factualRiskDelta,
    groundingRiskDelta,
    detectedRisks: detected,
  };
}

export function aggregateEditRiskAcrossRevisions(analyses: EditorialDiffAnalysis[]): {
  averageEditRiskScore: number;
  topRiskTypes: EditRiskType[];
  totalDetections: number;
} {
  if (analyses.length === 0) {
    return { averageEditRiskScore: 0, topRiskTypes: [], totalDetections: 0 };
  }
  const avg = Math.round(analyses.reduce((sum, a) => sum + a.editRiskScore, 0) / analyses.length);
  const typeCounts = new Map<EditRiskType, number>();
  let total = 0;
  for (const a of analyses) {
    for (const d of a.detectedRisks) {
      total += 1;
      typeCounts.set(d.type, (typeCounts.get(d.type) ?? 0) + 1);
    }
  }
  const topRiskTypes = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
  return { averageEditRiskScore: avg, topRiskTypes, totalDetections: total };
}
