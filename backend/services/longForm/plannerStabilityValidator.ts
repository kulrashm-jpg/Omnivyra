/**
 * plannerStabilityValidator.ts
 *
 * Phase 6.3 — Pre-flight plan validation.
 *
 * The planner LLM still occasionally produces structurally unstable
 * plans: 0 sections, 18 sections, sections with no key_points, sections
 * that demand a 2800-word target on a 1200-word article, sections that
 * repeat each other. Those plans cascade into the orchestrator and
 * burn the recovery budget.
 *
 * This validator runs BEFORE generation starts. It returns a hard
 * verdict ("block this plan, regenerate or fail loudly") or a soft
 * verdict ("warn and continue with these adjustments").
 */

import type { ContentPlan, ContentPlanSection } from '../../../lib/content/longFormPlanningEngine';

// ── Public types ─────────────────────────────────────────────────────────────

export type PlannerStabilityRecommendation =
  | 'accept'
  | 'accept_with_warnings'
  | 'regenerate_plan'
  | 'reject';

export interface SectionDefect {
  sectionIndex: number;
  sectionTitle: string;
  reasons: string[];
}

export interface PlannerStabilityResult {
  stabilityScore: number;                 // 0..100 (higher = more stable)
  invalidSections: SectionDefect[];       // sections that BLOCK shipping the plan
  overloadSections: SectionDefect[];      // sections that demand too much per-section work
  sequencingIssues: string[];             // article-level ordering problems
  timeoutRisk: number;                    // 0..100 (higher = more timeout-prone)
  recommendation: PlannerStabilityRecommendation;
  reasoning: string[];
}

export interface ValidatePlannerStabilityInput {
  plan: ContentPlan;
  contentType: string;
  articleTargetWords: number;
  /** Per-content-type allowed section count. Default: 3..10. */
  allowedSectionRange?: { min: number; max: number };
  /** Maximum per-section word target multiplier above article target. Default: 1.25. */
  maxSectionWordRatio?: number;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SECTION_RANGE: Record<string, { min: number; max: number }> = {
  blog:        { min: 3, max: 8 },
  article:     { min: 3, max: 9 },
  whitepaper:  { min: 5, max: 12 },
  guide:       { min: 4, max: 12 },
  newsletter:  { min: 2, max: 6 },
  story:       { min: 3, max: 7 },
  'case-study': { min: 4, max: 8 },
};

const MIN_KEY_POINTS_PER_SECTION = 1;
const MIN_SECTION_WORD_TARGET = 60;
const SOFT_OVERLOAD_RATIO = 0.45;          // section >45% of article = overload
const HARD_OVERLOAD_RATIO = 0.65;
const TIMEOUT_RISK_THRESHOLDS = {
  sectionWordSoft:  450,
  sectionWordHard:  650,
  totalSectionsSoft: 9,
  totalSectionsHard: 12,
};

// ── Validators ───────────────────────────────────────────────────────────────

function rangeFor(contentType: string): { min: number; max: number } {
  return DEFAULT_SECTION_RANGE[contentType] ?? { min: 3, max: 10 };
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function validatePlannerStability(
  input: ValidatePlannerStabilityInput,
): PlannerStabilityResult {
  const reasoning: string[] = [];
  const invalidSections: SectionDefect[] = [];
  const overloadSections: SectionDefect[] = [];
  const sequencingIssues: string[] = [];

  const range = input.allowedSectionRange ?? rangeFor(input.contentType);
  const sections = input.plan.sections;
  const totalSections = sections.length;
  const ratio = input.maxSectionWordRatio ?? 1.25;
  const maxSectionAbsolute = Math.round(input.articleTargetWords * ratio);

  // ── Article-level section count ────────────────────────────────────────
  if (totalSections === 0) {
    return failClosed(`Plan has 0 sections.`);
  }
  if (totalSections < range.min) {
    sequencingIssues.push(`Section count ${totalSections} below minimum ${range.min} for ${input.contentType}.`);
  } else if (totalSections > range.max) {
    sequencingIssues.push(`Section count ${totalSections} above maximum ${range.max} for ${input.contentType}.`);
  }

  // ── Per-section sanity ────────────────────────────────────────────────
  const titlesSeen = new Map<string, number>();
  let totalWordTarget = 0;

  for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i];
    const defects: string[] = [];

    if (!s.section_title || s.section_title.trim().length === 0) {
      defects.push('empty section_title');
    }
    if (!s.section_goal || s.section_goal.trim().length < 8) {
      defects.push('section_goal missing or too short');
    }
    if (!Array.isArray(s.key_points) || s.key_points.length < MIN_KEY_POINTS_PER_SECTION) {
      defects.push(`fewer than ${MIN_KEY_POINTS_PER_SECTION} key_point(s)`);
    }

    const wt = typeof s.word_target === 'number' ? s.word_target : 0;
    totalWordTarget += wt;
    if (wt < MIN_SECTION_WORD_TARGET) {
      defects.push(`word_target ${wt} below minimum ${MIN_SECTION_WORD_TARGET}`);
    }

    // Duplicate-title detection (case-insensitive, normalized).
    if (s.section_title) {
      const key = s.section_title.toLowerCase().trim();
      const seenIdx = titlesSeen.get(key);
      if (seenIdx != null) {
        sequencingIssues.push(`Duplicate section title "${s.section_title}" at positions ${seenIdx} and ${i}.`);
      } else {
        titlesSeen.set(key, i);
      }
    }

    if (defects.length > 0) {
      invalidSections.push({ sectionIndex: i, sectionTitle: s.section_title, reasons: defects });
    }

    // Overload heuristics — section consumes a disproportionate share.
    const articleShare = input.articleTargetWords > 0 ? wt / input.articleTargetWords : 0;
    if (articleShare >= HARD_OVERLOAD_RATIO || wt >= maxSectionAbsolute) {
      overloadSections.push({
        sectionIndex: i,
        sectionTitle: s.section_title,
        reasons: [
          `word_target ${wt} (${(articleShare * 100).toFixed(0)}% of article ${input.articleTargetWords})`,
          `exceeds hard overload threshold ${(HARD_OVERLOAD_RATIO * 100).toFixed(0)}% or absolute cap ${maxSectionAbsolute}`,
        ],
      });
    } else if (articleShare >= SOFT_OVERLOAD_RATIO) {
      overloadSections.push({
        sectionIndex: i,
        sectionTitle: s.section_title,
        reasons: [`word_target ${wt} (${(articleShare * 100).toFixed(0)}% of article — soft overload)`],
      });
    }
  }

  // ── Cross-section similarity (early-stage semantic drift) ─────────────
  // Pure planning-time check on titles + key_points. Real cross-section
  // semantic repetition runs post-generation; this is just to catch the
  // planner producing two near-identical sections.
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const a = `${sections[i].section_title} ${(sections[i].key_points ?? []).join(' ')}`;
      const b = `${sections[j].section_title} ${(sections[j].key_points ?? []).join(' ')}`;
      const sim = jaccard(tokenize(a), tokenize(b));
      if (sim >= 0.55) {
        sequencingIssues.push(`Sections ${i} ("${sections[i].section_title}") and ${j} ("${sections[j].section_title}") have ${(sim * 100).toFixed(0)}% planning-time overlap.`);
      }
    }
  }

  // ── Total word budget feasibility ─────────────────────────────────────
  if (totalWordTarget > input.articleTargetWords * 1.7) {
    sequencingIssues.push(
      `Total per-section word target ${totalWordTarget} > 170% of article target ${input.articleTargetWords}. Section sizing inflated.`,
    );
  } else if (totalWordTarget < input.articleTargetWords * 0.4) {
    sequencingIssues.push(
      `Total per-section word target ${totalWordTarget} < 40% of article target ${input.articleTargetWords}. Article would be under-built.`,
    );
  }

  // ── Timeout-risk projection ────────────────────────────────────────────
  let timeoutRisk = 0;
  const maxSectionWords = Math.max(0, ...sections.map((s) => s.word_target ?? 0));
  if (maxSectionWords >= TIMEOUT_RISK_THRESHOLDS.sectionWordHard) timeoutRisk += 50;
  else if (maxSectionWords >= TIMEOUT_RISK_THRESHOLDS.sectionWordSoft) timeoutRisk += 25;
  if (totalSections >= TIMEOUT_RISK_THRESHOLDS.totalSectionsHard) timeoutRisk += 30;
  else if (totalSections >= TIMEOUT_RISK_THRESHOLDS.totalSectionsSoft) timeoutRisk += 15;
  if (overloadSections.length > 0) timeoutRisk += 20;
  timeoutRisk = Math.min(100, timeoutRisk);

  // ── Composite stability score + recommendation ─────────────────────────
  const baseScore = 100
    - invalidSections.length * 15
    - overloadSections.length * 8
    - sequencingIssues.length * 4
    - Math.round(timeoutRisk * 0.2);
  const stabilityScore = Math.max(0, Math.min(100, baseScore));

  let recommendation: PlannerStabilityRecommendation;
  if (invalidSections.length >= 2 || stabilityScore < 35) {
    recommendation = 'reject';
    reasoning.push(`Stability score ${stabilityScore} < 35 OR 2+ invalid sections → REJECT plan.`);
  } else if (invalidSections.length === 1 || stabilityScore < 55) {
    recommendation = 'regenerate_plan';
    reasoning.push(`Stability score ${stabilityScore} < 55 OR 1 invalid section → REGENERATE plan.`);
  } else if (overloadSections.length > 0 || sequencingIssues.length > 0 || timeoutRisk >= 50) {
    recommendation = 'accept_with_warnings';
    reasoning.push(`Stability score ${stabilityScore} ≥ 55 with ${overloadSections.length} overload / ${sequencingIssues.length} sequencing / timeout risk ${timeoutRisk} → ACCEPT with warnings.`);
  } else {
    recommendation = 'accept';
    reasoning.push(`Stability score ${stabilityScore} ≥ 55, no overloads, no sequencing issues. ACCEPT.`);
  }

  return {
    stabilityScore,
    invalidSections,
    overloadSections,
    sequencingIssues,
    timeoutRisk,
    recommendation,
    reasoning,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function failClosed(reason: string): PlannerStabilityResult {
  return {
    stabilityScore: 0,
    invalidSections: [],
    overloadSections: [],
    sequencingIssues: [reason],
    timeoutRisk: 100,
    recommendation: 'reject',
    reasoning: [`Hard reject: ${reason}`],
  };
}
