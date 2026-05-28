/**
 * strategicAssignmentConsumptionValidator.ts
 *
 * Phase 3.5 — Verifies that sections actually consumed the strategic
 * assignments built in Phase 2.7.
 *
 * Phase 2.7 distributed company anchors across sections (intro / body /
 * closing) into structured per-section assignments. The prompt rendered
 * these as "Section N must cover ICP X, pain Y, differentiator Z" — but
 * nothing validated that the model actually used them.
 *
 * This validator checks each section's text against its assignment bundle
 * and returns:
 *   - which assignments were consumed (substring or near-match present)
 *   - which were ignored
 *   - a per-section consumption ratio
 *   - per-section verdict
 *   - sections to retry
 *
 * No LLM calls. Pure string-matching with token fuzziness.
 */

import type { SectionStrategicAssignment } from '../../../lib/content/sectionStrategicAssignments';

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

const FUZZY_STOPWORDS = new Set<string>([
  'the','a','an','and','or','but','of','to','in','on','for','with','by','at','from','as','is','are','was','were','it','this','that','these','those',
]);

/**
 * Anchor-match strategy: an anchor is "consumed" if either
 *   (a) at least one substring-length-≥-6 phrase from the anchor appears
 *       verbatim in the section text, OR
 *   (b) ≥ 50% of the anchor's content tokens (after stopword removal,
 *       de-duplicated) appear in the section text.
 *
 * This catches cases where the model paraphrased the anchor instead of
 * quoting it.
 */
function anchorIsConsumed(anchor: string, sectionLower: string, sectionTokenSet: Set<string>): boolean {
  if (!anchor || anchor.length < 4) return true;
  const lowered = anchor.toLowerCase();
  // (a) Substring scan — break the anchor into short content phrases.
  const phrases = lowered
    .split(/[,:;.]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);
  for (const phrase of phrases) {
    if (sectionLower.includes(phrase)) return true;
    // Also accept the phrase with internal whitespace collapsed.
    const collapsed = phrase.replace(/\s+/g, ' ');
    if (sectionLower.includes(collapsed)) return true;
  }
  // (b) Token-coverage scan.
  const anchorTokens = Array.from(new Set(
    tokenize(lowered).filter((t) => !FUZZY_STOPWORDS.has(t)),
  ));
  if (anchorTokens.length === 0) return true;
  let hits = 0;
  for (const t of anchorTokens) if (sectionTokenSet.has(t)) hits += 1;
  return hits / anchorTokens.length >= 0.5;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SectionAssignmentConsumption {
  sectionIndex: number;
  sectionRole: SectionStrategicAssignment['section_role'];
  totalAssignments: number;
  consumedAssignments: number;
  unusedAssignments: Array<{ type: string; anchor: string }>;
  consumptionRatio: number;        // 0-1
  verdict: 'pass' | 'retry' | 'fail';
}

export interface StrategicAssignmentConsumptionResult {
  overallConsumptionRatio: number;
  perSection: SectionAssignmentConsumption[];
  sectionsToRetry: number[];
  verdict: 'pass' | 'retry' | 'fail';
}

const PER_SECTION_RETRY_THRESHOLD = 0.5;   // < 50% consumed → retry
const PER_SECTION_FAIL_THRESHOLD = 0.2;    // < 20% consumed → fail
const ARTICLE_RETRY_THRESHOLD = 0.55;
const ARTICLE_FAIL_THRESHOLD = 0.3;

// ── Main ─────────────────────────────────────────────────────────────────────

export function validateStrategicAssignmentConsumption(input: {
  sections: Array<{ index: number; html: string }>;
  assignments: SectionStrategicAssignment[];
}): StrategicAssignmentConsumptionResult {
  const perSection: SectionAssignmentConsumption[] = [];

  for (const a of input.assignments) {
    // Find the matching section. Section IDs are 1-indexed in assignments;
    // orchestrator sections may be 0-indexed. We accept either.
    const matchByIndex = input.sections.find((s) => s.index === a.section_id || s.index === a.section_id - 1);
    if (!matchByIndex) {
      perSection.push({
        sectionIndex: a.section_id,
        sectionRole: a.section_role,
        totalAssignments: a.required_context.length + a.required_positioning.length + a.required_pain_points.length + a.required_differentiators.length,
        consumedAssignments: 0,
        unusedAssignments: [
          ...a.required_context.map((anchor) => ({ type: 'context', anchor })),
          ...a.required_positioning.map((anchor) => ({ type: 'positioning', anchor })),
          ...a.required_pain_points.map((anchor) => ({ type: 'pain_point', anchor })),
          ...a.required_differentiators.map((anchor) => ({ type: 'differentiator', anchor })),
        ],
        consumptionRatio: 0,
        verdict: 'fail',
      });
      continue;
    }

    const plain = stripHtml(matchByIndex.html);
    const lowered = plain.toLowerCase();
    const tokenSet = new Set(tokenize(plain));

    const totalAnchors =
      a.required_context.length +
      a.required_positioning.length +
      a.required_pain_points.length +
      a.required_differentiators.length;

    if (totalAnchors === 0) {
      // No assignments to consume — section trivially passes this gate.
      perSection.push({
        sectionIndex: a.section_id,
        sectionRole: a.section_role,
        totalAssignments: 0,
        consumedAssignments: 0,
        unusedAssignments: [],
        consumptionRatio: 1,
        verdict: 'pass',
      });
      continue;
    }

    const unused: Array<{ type: string; anchor: string }> = [];
    let consumed = 0;
    for (const anchor of a.required_context) {
      if (anchorIsConsumed(anchor, lowered, tokenSet)) consumed += 1;
      else unused.push({ type: 'context', anchor });
    }
    for (const anchor of a.required_positioning) {
      if (anchorIsConsumed(anchor, lowered, tokenSet)) consumed += 1;
      else unused.push({ type: 'positioning', anchor });
    }
    for (const anchor of a.required_pain_points) {
      if (anchorIsConsumed(anchor, lowered, tokenSet)) consumed += 1;
      else unused.push({ type: 'pain_point', anchor });
    }
    for (const anchor of a.required_differentiators) {
      if (anchorIsConsumed(anchor, lowered, tokenSet)) consumed += 1;
      else unused.push({ type: 'differentiator', anchor });
    }

    const ratio = consumed / totalAnchors;
    const verdict: SectionAssignmentConsumption['verdict'] =
      ratio < PER_SECTION_FAIL_THRESHOLD ? 'fail' :
      ratio < PER_SECTION_RETRY_THRESHOLD ? 'retry' : 'pass';

    perSection.push({
      sectionIndex: a.section_id,
      sectionRole: a.section_role,
      totalAssignments: totalAnchors,
      consumedAssignments: consumed,
      unusedAssignments: unused,
      consumptionRatio: Number(ratio.toFixed(3)),
      verdict,
    });
  }

  const totalAssignments = perSection.reduce((sum, p) => sum + p.totalAssignments, 0);
  const totalConsumed = perSection.reduce((sum, p) => sum + p.consumedAssignments, 0);
  const overallRatio = totalAssignments === 0 ? 1 : totalConsumed / totalAssignments;

  const sectionsToRetry = perSection
    .filter((p) => p.verdict !== 'pass')
    .map((p) => p.sectionIndex);

  const articleVerdict: StrategicAssignmentConsumptionResult['verdict'] =
    overallRatio < ARTICLE_FAIL_THRESHOLD ? 'fail' :
    overallRatio < ARTICLE_RETRY_THRESHOLD ? 'retry' : 'pass';

  return {
    overallConsumptionRatio: Number(overallRatio.toFixed(3)),
    perSection,
    sectionsToRetry,
    verdict: articleVerdict,
  };
}
