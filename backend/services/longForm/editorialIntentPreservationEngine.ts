/**
 * Phase 4 — Editorial intent preservation engine.
 *
 * Compares the original baseline article against the latest revision
 * across 8 intent dimensions. Detects fragmentation, narrative divergence,
 * and section-level contradictions. Deterministic; no LLM.
 */

import type {
  EditorialIntentPreservationResult,
  ExtractedClaim,
  IntentDimension,
  IntentDimensionResult,
  RevisionBranch,
  SectionGenerationContract,
} from './longFormRecommendationTypes';
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

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

function pct(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function detect(
  dimension: IntentDimension,
  preservationScore: number,
  detail: string,
  driftThreshold = 60,
): IntentDimensionResult {
  return {
    dimension,
    preservationScore,
    drifted: preservationScore < driftThreshold,
    detail,
  };
}

export interface PreserveEditorialIntentInput {
  branch: RevisionBranch;
  contract: SectionGenerationContract;
}

interface ResolvedSectionState {
  baselineHtml: string;
  latestHtml: string;
}

function resolveSectionStates(branch: RevisionBranch): Map<string, ResolvedSectionState> {
  // Baseline = section text after the baseline revision (originally rendered).
  const baseline = branch.revisionTree[branch.baselineRevisionId];
  const baselineMap = new Map<string, string>();
  if (baseline) {
    for (const sec of baseline.affectedSections) baselineMap.set(sec.sectionId, sec.afterHtml);
  }
  // Walk lineage from current → baseline to compute the latest html per section.
  const latestMap = new Map<string, string>();
  for (const sec of baselineMap.keys()) latestMap.set(sec, baselineMap.get(sec) ?? '');
  // Apply revisions in chronological order from baseline → current.
  const allRevs = Object.values(branch.revisionTree).filter((r) => r.parentRevisionId !== null);
  allRevs.sort((a, b) => a.revisionTimestamp.localeCompare(b.revisionTimestamp));
  for (const rev of allRevs) {
    for (const edit of rev.affectedSections) {
      latestMap.set(edit.sectionId, edit.afterHtml);
    }
  }
  const out = new Map<string, ResolvedSectionState>();
  for (const [sectionId, baselineHtml] of baselineMap) {
    out.set(sectionId, { baselineHtml, latestHtml: latestMap.get(sectionId) ?? baselineHtml });
  }
  return out;
}

export function preserveEditorialIntent(input: PreserveEditorialIntentInput): EditorialIntentPreservationResult {
  const sectionStates = resolveSectionStates(input.branch);
  const baselineFullText = Array.from(sectionStates.values()).map((s) => stripHtml(s.baselineHtml)).join(' ');
  const latestFullText = Array.from(sectionStates.values()).map((s) => stripHtml(s.latestHtml)).join(' ');
  const contract = input.contract;

  const dimensions: IntentDimensionResult[] = [];

  // 1. strategic_narrative
  if (contract.strategicNarrative && contract.strategicNarrative.trim().length > 0) {
    const narrTokens = tokens(contract.strategicNarrative);
    const baselineCoverage = Array.from(narrTokens).filter((t) => tokens(baselineFullText).has(t)).length;
    const latestCoverage = Array.from(narrTokens).filter((t) => tokens(latestFullText).has(t)).length;
    const score = narrTokens.size === 0 ? 100 : Math.round((latestCoverage / Math.max(baselineCoverage, 1)) * 100);
    dimensions.push(detect('strategic_narrative', Math.max(0, Math.min(100, score)),
      `Strategic narrative token coverage: ${latestCoverage}/${narrTokens.size} (baseline had ${baselineCoverage}).`));
  } else {
    dimensions.push(detect('strategic_narrative', 100, 'No strategic narrative to preserve.'));
  }

  // 2. editorial_angle
  {
    const angleTokens = tokens(contract.editorialAngle ?? '');
    const baselineHas = Array.from(angleTokens).filter((t) => tokens(baselineFullText).has(t)).length;
    const latestHas = Array.from(angleTokens).filter((t) => tokens(latestFullText).has(t)).length;
    const score = angleTokens.size === 0 ? 100 : Math.round((latestHas / Math.max(baselineHas, 1)) * 100);
    dimensions.push(detect('editorial_angle', Math.max(0, Math.min(100, score)),
      `Editorial angle token coverage: ${latestHas}/${angleTokens.size} (baseline had ${baselineHas}).`));
  }

  // 3. buyer_stage_alignment — checks whether stage-specific language (decision/eval/awareness markers) survived.
  {
    const stage = contract.targetBuyerStage;
    const stagePatterns: Record<string, RegExp[]> = {
      awareness: [/\bintroducing\b/i, /\bawareness\b/i, /\bgetting started\b/i],
      consideration: [/\bevaluat/i, /\bcompare\b/i, /\bconsider\b/i],
      evaluation: [/\bevaluat/i, /\bdecision\b/i, /\btrial\b/i, /\bdemo\b/i],
      decision: [/\bdecision\b/i, /\bROI\b/i, /\bprocurement\b/i, /\bcontract\b/i],
      expansion: [/\bexpansion\b/i, /\brenewal\b/i, /\badoption\b/i, /\benterprise rollout\b/i],
    };
    const patterns = stagePatterns[stage] ?? [];
    const baselineHits = patterns.filter((re) => re.test(baselineFullText)).length;
    const latestHits = patterns.filter((re) => re.test(latestFullText)).length;
    const score = patterns.length === 0 ? 80 : Math.round((latestHits / Math.max(baselineHits, 1)) * 100);
    dimensions.push(detect('buyer_stage_alignment', Math.max(0, Math.min(100, score)),
      `Buyer-stage markers (${stage}) preserved: ${latestHits}/${patterns.length} (baseline had ${baselineHits}).`, 50));
  }

  // 4. operational_sequencing — operational verbs preservation.
  {
    const opVerbs = ['instrument','deploy','route','sequence','enforce','orchestrate','validate','observe','monitor','detect','escalate','audit'];
    const beforeCount = opVerbs.filter((v) => new RegExp(`\\b${v}(?:s|ed|ing)?\\b`, 'i').test(baselineFullText)).length;
    const afterCount = opVerbs.filter((v) => new RegExp(`\\b${v}(?:s|ed|ing)?\\b`, 'i').test(latestFullText)).length;
    const score = beforeCount === 0 ? 100 : Math.round((afterCount / beforeCount) * 100);
    dimensions.push(detect('operational_sequencing', Math.max(0, Math.min(100, score)),
      `Operational verb preservation: ${afterCount}/${beforeCount}.`));
  }

  // 5. capability_emphasis
  {
    const cap = contract.capabilityEmphasis.primaryCapability;
    if (cap && cap.length >= 10) {
      const capTokens = tokens(cap);
      const beforeHits = Array.from(capTokens).filter((t) => tokens(baselineFullText).has(t)).length;
      const afterHits = Array.from(capTokens).filter((t) => tokens(latestFullText).has(t)).length;
      const score = capTokens.size === 0 ? 100 : Math.round((afterHits / Math.max(beforeHits, 1)) * 100);
      dimensions.push(detect('capability_emphasis', Math.max(0, Math.min(100, score)),
        `Capability token preservation: ${afterHits}/${capTokens.size}.`));
    } else {
      dimensions.push(detect('capability_emphasis', 100, 'No capability emphasis to preserve.'));
    }
  }

  // 6. terminology_emphasis
  {
    const terms = [...contract.terminologyEmphasis.domainVocabulary, ...contract.terminologyEmphasis.strategicTerminology];
    if (terms.length === 0) {
      dimensions.push(detect('terminology_emphasis', 100, 'No terminology emphasis to preserve.'));
    } else {
      const baselineLower = baselineFullText.toLowerCase();
      const latestLower = latestFullText.toLowerCase();
      const beforeHits = terms.filter((t) => baselineLower.includes(t.toLowerCase())).length;
      const afterHits = terms.filter((t) => latestLower.includes(t.toLowerCase())).length;
      const score = beforeHits === 0 ? 100 : Math.round((afterHits / beforeHits) * 100);
      dimensions.push(detect('terminology_emphasis', Math.max(0, Math.min(100, score)),
        `Terminology preservation: ${afterHits}/${terms.length} (baseline had ${beforeHits}).`));
    }
  }

  // 7. evidence_grounding — total claim count preservation.
  {
    let baselineClaims = 0;
    let latestClaims = 0;
    for (const [sectionId, state] of sectionStates) {
      const bef: ExtractedClaim[] = extractClaims({ sourceSectionId: sectionId, sectionText: state.baselineHtml });
      const lat: ExtractedClaim[] = extractClaims({ sourceSectionId: sectionId, sectionText: state.latestHtml });
      baselineClaims += bef.length;
      latestClaims += lat.length;
    }
    const score = baselineClaims === 0
      ? 100
      : Math.round(pct(Math.min(1, latestClaims / baselineClaims) * 0.5
        + Math.min(1, baselineClaims / Math.max(latestClaims, 1)) * 0.5));
    dimensions.push(detect('evidence_grounding', score,
      `Claim count baseline=${baselineClaims} latest=${latestClaims} (drift from either direction reduces this score).`));
  }

  // 8. citation_lineage — citation marker count preservation.
  {
    const markerRegex = /\b(according to|as reported by|cited by|in our (?:experience|deployments?|practice))\b|\[\d+\]/gi;
    const beforeCount = (baselineFullText.match(markerRegex) ?? []).length;
    const afterCount = (latestFullText.match(markerRegex) ?? []).length;
    const score = beforeCount === 0
      ? 100
      : afterCount >= beforeCount ? 100 : Math.round((afterCount / beforeCount) * 100);
    dimensions.push(detect('citation_lineage', score,
      `Citation markers: baseline=${beforeCount} latest=${afterCount}.`));
  }

  // Composite + fragmentation/divergence flags.
  const overallPreservationScore = Math.round(dimensions.reduce((sum, d) => sum + d.preservationScore, 0) / dimensions.length);
  const driftedCount = dimensions.filter((d) => d.drifted).length;
  const fragmentationDetected = driftedCount >= 3;
  const divergenceDetected = jaccard(tokens(baselineFullText), tokens(latestFullText)) < 0.4;

  // Section-level contradictions: a section's latest text contains negation of baseline tone.
  const sectionLevelContradictions: EditorialIntentPreservationResult['sectionLevelContradictions'] = [];
  for (const [sectionId, state] of sectionStates) {
    const beforeNeg = /\b(not|never|avoid(?:ing|s|ed)?)\b/i.test(state.baselineHtml);
    const latestNeg = /\b(not|never|avoid(?:ing|s|ed)?)\b/i.test(state.latestHtml);
    // If beforeNeg differs from latestNeg AND tokens overlap heavily, that's a contradiction signal.
    const overlap = jaccard(tokens(state.baselineHtml), tokens(state.latestHtml));
    if (beforeNeg !== latestNeg && overlap > 0.45) {
      sectionLevelContradictions.push({
        sectionId,
        detail: `Section ${sectionId} flipped negation polarity (baseline=${beforeNeg ? 'neg' : 'pos'} → latest=${latestNeg ? 'neg' : 'pos'}, overlap=${overlap.toFixed(2)}).`,
      });
    }
  }

  return {
    overallPreservationScore,
    dimensions,
    fragmentationDetected,
    divergenceDetected,
    sectionLevelContradictions,
  };
}
