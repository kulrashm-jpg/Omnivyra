/**
 * Phase 3 — Semantic continuity analyzer.
 *
 * The existing generationContinuityValidator uses token-overlap thresholds.
 * That catches the obvious case where the planner input strips a whole field,
 * but it cannot detect:
 *
 *   • SUPERFICIAL_TOKEN_PRESERVATION — same words, restructured into a
 *     genuinely different argument.
 *   • HIDDEN_NARRATIVE_DRIFT — sequence of clauses changed even though words
 *     are preserved.
 *   • OPERATIONAL_SIMPLIFICATION — operational verbs (build, sequence,
 *     measure) replaced by softer language.
 *   • STRATEGIC_DILUTION — strategic terminology dropped in favor of generic.
 *   • ICP_EROSION — ICP-specific entities replaced by generalities.
 *
 * This analyzer combines six deterministic signals into three scores:
 *   semanticContinuityScore   — overall semantic similarity
 *   strategicIntegrityScore   — structural/strategic narrative preservation
 *   operationalIntegrityScore — operational-verb + sequence preservation
 *
 * No LLM. All checks are deterministic.
 */

import type {
  LongFormRecommendation,
  SemanticContinuityResult,
} from './longFormRecommendationTypes';
import type {
  EditorialContextBlock,
  PlanningInputPartial,
} from './longFormPlanningAdapter';

// ────────────────────────────────────────────────────────────────────────────
// Tokenization helpers
// ────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at',
  'is','are','was','were','be','been','being','as','from','that','this','these',
  'those','it','its','into','than','then','so','how','what','why','when','where',
  'who','which','can','could','should','would','will','our','your','their',
]);

function tokens(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function bigrams(text: string): Set<string> {
  const toks = tokens(text);
  const out = new Set<string>();
  for (let i = 0; i < toks.length - 1; i += 1) {
    out.add(`${toks[i]} ${toks[i + 1]}`);
  }
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((v) => { if (b.has(v)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

// ────────────────────────────────────────────────────────────────────────────
// Structural signals
// ────────────────────────────────────────────────────────────────────────────

const STRUCTURAL_MARKERS = [
  { tag: 'CND', re: /\b(if|when|unless|until)\b/i },
  { tag: 'CMP', re: /\b(vs\.?|versus|compared|instead of|rather than)\b/i },
  { tag: 'PRC', re: /\b(only works|only when|requires|must|needs|sequenced|before)\b/i },
  { tag: 'END', re: /\b(ends in|leads to|results in|so that|therefore)\b/i },
  { tag: 'NEG', re: /\b(not|never|without|avoid|stop)\b/i },
  { tag: 'EMP', re: /\b(critical|essential|key|core|primary)\b/i },
];

function structuralShape(text: string): Set<string> {
  const set = new Set<string>();
  for (const { tag, re } of STRUCTURAL_MARKERS) {
    if (re.test(text)) set.add(tag);
  }
  return set;
}

function structuralAlignment(source: string, target: string): number {
  const a = structuralShape(source);
  const b = structuralShape(target);
  if (a.size === 0 && b.size === 0) return 100;
  return Math.round(jaccard(a, b) * 100);
}

// ────────────────────────────────────────────────────────────────────────────
// Operational-verb preservation
// ────────────────────────────────────────────────────────────────────────────

const OPERATIONAL_VERBS = new Set([
  'build','sequence','measure','validate','observe','instrument','enforce',
  'detect','trace','orchestrate','coordinate','evaluate','govern','audit',
  'monitor','deploy','roll','rollout','catch','prevent','escalate','recover',
  'investigate','operate','scale','throttle','prioritize','triage','reconcile',
  'route','dispatch','classify','remediate','sanitize','redact','encrypt',
]);

function operationalVerbs(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(text)) {
    if (OPERATIONAL_VERBS.has(t)) out.add(t);
    // Stem common suffixes
    if (t.endsWith('s') && OPERATIONAL_VERBS.has(t.slice(0, -1))) out.add(t.slice(0, -1));
    if (t.endsWith('ed') && OPERATIONAL_VERBS.has(t.slice(0, -2))) out.add(t.slice(0, -2));
    if (t.endsWith('ing') && OPERATIONAL_VERBS.has(t.slice(0, -3))) out.add(t.slice(0, -3));
  }
  return out;
}

function operationalVerbPreservation(source: string, target: string): number {
  const a = operationalVerbs(source);
  const b = operationalVerbs(target);
  if (a.size === 0) return 100; // nothing to preserve
  let preserved = 0;
  a.forEach((v) => { if (b.has(v)) preserved += 1; });
  return Math.round((preserved / a.size) * 100);
}

// ────────────────────────────────────────────────────────────────────────────
// ICP / capability entity preservation
// ────────────────────────────────────────────────────────────────────────────

function entityPhrases(text: string): Set<string> {
  // Capture phrases with capitalized tokens (proper nouns, named entities,
  // domain abbreviations) — basic heuristic without NLP.
  const out = new Set<string>();
  const matches = text.match(/\b[A-Z][a-zA-Z0-9-]+(?:\s+[A-Z][a-zA-Z0-9-]+)*\b/g) ?? [];
  for (const m of matches) {
    if (m.length > 2 && m.toUpperCase() !== m.split('').filter((c) => /[A-Z]/.test(c)).join('')) {
      out.add(m.toLowerCase());
    } else if (m.length >= 2 && m === m.toUpperCase()) {
      // All-caps acronyms (RBAC, RFP, etc.)
      out.add(m.toLowerCase());
    }
  }
  // Also include multi-word lowercase phrases that look like ICP slugs.
  return out;
}

function icpEntityPreservation(source: string, target: string): number {
  const a = entityPhrases(source);
  const b = entityPhrases(target);
  if (a.size === 0) return 100;
  let preserved = 0;
  a.forEach((v) => { if (b.has(v)) preserved += 1; });
  return Math.round((preserved / a.size) * 100);
}

// ────────────────────────────────────────────────────────────────────────────
// Narrative tone
// ────────────────────────────────────────────────────────────────────────────

type Tone = 'assertive' | 'comparative' | 'instructional' | 'descriptive';

function detectTone(text: string): Tone {
  const lower = text.toLowerCase();
  if (/\b(vs\.?|versus|compared|instead of)\b/.test(lower)) return 'comparative';
  if (/\b(how to|step|first,|next,|sequence)\b/.test(lower)) return 'instructional';
  if (/\b(must|only works|requires|never|always|critical)\b/.test(lower)) return 'assertive';
  return 'descriptive';
}

function narrativeToneAlignment(source: string, target: string): number {
  const a = detectTone(source);
  const b = detectTone(target);
  if (a === b) return 100;
  // Adjacent tones share partial alignment.
  if ((a === 'assertive' && b === 'instructional') || (a === 'instructional' && b === 'assertive')) return 70;
  if ((a === 'descriptive' && b === 'instructional') || (a === 'instructional' && b === 'descriptive')) return 60;
  return 35;
}

// ────────────────────────────────────────────────────────────────────────────
// Capability concept density
// ────────────────────────────────────────────────────────────────────────────

function capabilityConceptDensity(sourceCapability: string, targetText: string): number {
  if (!sourceCapability.trim()) return 100;
  const sourceTokens = tokens(sourceCapability);
  if (sourceTokens.length === 0) return 100;
  const targetLower = targetText.toLowerCase();
  const present = sourceTokens.filter((t) => targetLower.includes(t)).length;
  return Math.round((present / sourceTokens.length) * 100);
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function analyzeSemanticContinuity(input: {
  recommendation: LongFormRecommendation;
  planningInput: PlanningInputPartial;
  editorialContext?: EditorialContextBlock;
}): SemanticContinuityResult {
  const { recommendation, planningInput } = input;
  const ctx = input.editorialContext ?? planningInput.editorialContext;

  // Source = full recommendation editorial surface.
  const sourceText = [
    recommendation.editorialAngle,
    recommendation.strategicNarrative,
    recommendation.whyThisFitsCompany.icpProblemMapping,
    recommendation.whyThisFitsCompany.capabilityConnection,
    recommendation.recommendedContentDirection.primaryAngle,
    recommendation.recommendedContentDirection.operationalProof.join(' '),
  ].join(' ');

  // Target = what survived into the planning input.
  const targetText = [
    planningInput.topic,
    planningInput.intent,
    planningInput.seoContext,
    ctx?.editorialAngle ?? '',
    ctx?.strategicNarrative ?? '',
    ctx?.whyThisFitsCompany.icpProblemMapping ?? '',
    ctx?.whyThisFitsCompany.capabilityConnection ?? '',
    ctx?.recommendedContentDirection.primaryAngle ?? '',
    (ctx?.recommendedContentDirection.operationalProof ?? []).join(' '),
  ].join(' ');

  const bigramOverlap = Math.round(jaccard(bigrams(sourceText), bigrams(targetText)) * 100);
  const structAlignment = structuralAlignment(sourceText, targetText);
  const opVerbPres = operationalVerbPreservation(sourceText, targetText);
  const icpEntPres = icpEntityPreservation(
    [recommendation.whyThisFitsCompany.icpProblemMapping, recommendation.strategicNarrative].join(' '),
    [planningInput.topic, planningInput.intent, planningInput.seoContext, ctx?.whyThisFitsCompany.icpProblemMapping ?? ''].join(' '),
  );
  const toneAlign = narrativeToneAlignment(
    recommendation.strategicNarrative + ' ' + recommendation.editorialAngle,
    (ctx?.strategicNarrative ?? '') + ' ' + planningInput.intent,
  );
  const capConceptDensity = capabilityConceptDensity(
    recommendation.whyThisFitsCompany.capabilityConnection,
    targetText,
  );

  // Composite scores.
  const semanticContinuityScore = Math.round(
    bigramOverlap * 0.25
    + structAlignment * 0.15
    + opVerbPres * 0.20
    + icpEntPres * 0.15
    + toneAlign * 0.10
    + capConceptDensity * 0.15,
  );
  const strategicIntegrityScore = Math.round(
    structAlignment * 0.40
    + toneAlign * 0.30
    + bigramOverlap * 0.30,
  );
  const operationalIntegrityScore = Math.round(
    opVerbPres * 0.50
    + capConceptDensity * 0.30
    + structAlignment * 0.20,
  );

  // Drift detections.
  const drifts: SemanticContinuityResult['driftDetections'] = [];

  // SUPERFICIAL_TOKEN_PRESERVATION — high token overlap but structural/tonal mismatch.
  if (bigramOverlap < 35 && opVerbPres < 50) {
    drifts.push({
      type: 'SUPERFICIAL_TOKEN_PRESERVATION',
      detail: `Bigram overlap=${bigramOverlap} and operational verbs preserved=${opVerbPres}. The wording is recognizably similar but the operational shape is gone.`,
      severity: 'high',
    });
  }
  // HIDDEN_NARRATIVE_DRIFT — structural alignment low even when text similar.
  if (structAlignment < 50 && bigramOverlap >= 40) {
    drifts.push({
      type: 'HIDDEN_NARRATIVE_DRIFT',
      detail: `Same tokens but structural markers (${Array.from(structuralShape(sourceText)).join(',')} → ${Array.from(structuralShape(targetText)).join(',')}) diverged.`,
      severity: 'medium',
    });
  }
  // OPERATIONAL_SIMPLIFICATION — operational verbs stripped.
  if (opVerbPres < 50 && recommendation.recommendedContentDirection.operationalProof.length > 0) {
    drifts.push({
      type: 'OPERATIONAL_SIMPLIFICATION',
      detail: `Only ${opVerbPres}% of operational verbs survived into the planning input.`,
      severity: opVerbPres < 30 ? 'high' : 'medium',
    });
  }
  // STRATEGIC_DILUTION — strategic terms missing from editorial / narrative.
  if (capConceptDensity < 45) {
    drifts.push({
      type: 'STRATEGIC_DILUTION',
      detail: `Capability concept density dropped to ${capConceptDensity}% — strategic terminology was paraphrased into generics.`,
      severity: capConceptDensity < 25 ? 'high' : 'medium',
    });
  }
  // ICP_EROSION — ICP entities not preserved.
  if (icpEntPres < 50 && recommendation.whyThisFitsCompany.icpProblemMapping.length > 25) {
    drifts.push({
      type: 'ICP_EROSION',
      detail: `Only ${icpEntPres}% of named ICP entities survived; ICP framing has been generalized.`,
      severity: icpEntPres < 25 ? 'high' : 'medium',
    });
  }

  return {
    semanticContinuityScore,
    strategicIntegrityScore,
    operationalIntegrityScore,
    signals: {
      bigramOverlap,
      structuralAlignment: structAlignment,
      operationalVerbPreservation: opVerbPres,
      icpEntityPreservation: icpEntPres,
      narrativeToneAlignment: toneAlign,
      capabilityConceptDensity: capConceptDensity,
    },
    driftDetections: drifts,
  };
}
