/**
 * sectionStrategicAssignments.ts
 *
 * Phase 2.7 — Replace the must_include_points blob with section-level
 * strategic assignments.
 *
 * Previously, `runBlogGeneration` synthesized a comma-joined string of
 * "everything the company cares about" and shoved it into a single answer
 * key (`must_include_points`). The model treated this as a flat checklist,
 * leading to:
 *   - checklist-style prose ("First, we'll discuss X. Then Y. Then Z.")
 *   - repetitive narrative inflation (every section name-drops every anchor)
 *   - low strategic specificity (no signal about which anchor belongs where)
 *
 * The new design distributes context anchors across N sections, where N is
 * derived from the target word count. Each section gets its own bundle of
 * `required_context`, `required_positioning`, `required_pain_points`, and
 * `required_differentiators`. The rendered prompt block tells the model
 * "section 1 must cover X and Y; section 2 must cover Z and W" instead of
 * "must include: X, Y, Z, W".
 *
 * Distribution rules (deterministic):
 *   - Pain points: round-robin across body sections (skip intro/conclusion)
 *   - Differentiators: front-loaded into early body sections
 *   - Transformation outcome: assigned to closing section
 *   - Authority domains: surface as positioning across all sections
 *   - Core problem statement: introduction section anchor
 *
 * Generation logic is NOT redesigned. Only the SHAPE of context injection
 * changes. The prompt builder still consumes one string value from the
 * answers Record; that string is now structured per-section rather than
 * a flat blob.
 */

import type { CompanyContext } from '../blog/blogRunnerTypes';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SectionStrategicAssignment {
  /** 1-indexed position in the article (1 = intro, last = closing). */
  section_id: number;
  /** Role of this section in the narrative arc. */
  section_role: 'introduction' | 'body' | 'closing';
  /** Anchors that establish company context (core problem, ICP, etc). */
  required_context: string[];
  /** Anchors that establish positioning (differentiation, authority). */
  required_positioning: string[];
  /** Pain points this specific section must reference. */
  required_pain_points: string[];
  /** Differentiators this specific section must reference. */
  required_differentiators: string[];
}

export interface SectionStrategicAssignmentBundle {
  /** Total estimated section count used to compute distribution. */
  total_sections: number;
  /** Per-section anchor assignments. */
  assignments: SectionStrategicAssignment[];
  /** True iff the bundle produced any non-empty assignments. */
  hasAssignments: boolean;
}

// ── Section count estimation ─────────────────────────────────────────────────

/**
 * Estimate H2-level section count from target word count. Mirrors the
 * heuristic in `blogGenerationEngine.ts:371-376` so the assignments line up
 * with the structure the model will actually produce.
 *
 *   ≤ 800 words  → 3 sections (intro + 1 body + closing)
 *   ≤ 1200 words → 5 sections (intro + 3 body + closing)
 *   ≤ 1600 words → 6 sections (intro + 4 body + closing)
 *   > 1600 words → 7 sections (intro + 5 body + closing)
 */
export function estimateSectionCount(targetWordCount: number | undefined): number {
  if (!targetWordCount || targetWordCount <= 0) return 5;
  if (targetWordCount <= 800) return 3;
  if (targetWordCount <= 1200) return 5;
  if (targetWordCount <= 1600) return 6;
  return 7;
}

// ── Distribution ─────────────────────────────────────────────────────────────

function distributeRoundRobin<T>(items: T[], buckets: number): T[][] {
  const out: T[][] = Array.from({ length: buckets }, () => []);
  if (buckets === 0) return out;
  items.forEach((item, idx) => {
    out[idx % buckets].push(item);
  });
  return out;
}

function distributeFrontLoaded<T>(items: T[], buckets: number): T[][] {
  const out: T[][] = Array.from({ length: buckets }, () => []);
  if (buckets === 0) return out;
  // Place earlier items into earlier buckets, but spread overflow across
  // remaining buckets to avoid concentrating everything in section 1.
  items.forEach((item, idx) => {
    const target = Math.min(idx, buckets - 1);
    out[target].push(item);
  });
  return out;
}

// ── Builder ──────────────────────────────────────────────────────────────────

export function buildSectionStrategicAssignments(
  context: CompanyContext | undefined | null,
  options: { targetWordCount?: number; companyName?: string } = {},
): SectionStrategicAssignmentBundle {
  const total = estimateSectionCount(options.targetWordCount);
  const assignments: SectionStrategicAssignment[] = [];

  if (!context) {
    for (let i = 1; i <= total; i++) {
      assignments.push({
        section_id: i,
        section_role: i === 1 ? 'introduction' : i === total ? 'closing' : 'body',
        required_context: [],
        required_positioning: [],
        required_pain_points: [],
        required_differentiators: [],
      });
    }
    return { total_sections: total, assignments, hasAssignments: false };
  }

  // Body section count excludes the dedicated intro (1) and closing (1).
  const bodyCount = Math.max(1, total - 2);
  const bodyIndexStart = 2; // 1 = intro, 2..(total-1) = body, total = closing

  const painPoints = context.painSymptoms ?? [];
  const differentiators = splitToList(context.competitiveAdvantages, 6);
  const authorityDomains = context.authorityDomains ?? [];
  const keyMessages = splitToList(context.keyMessages, 4);

  const painBuckets = distributeRoundRobin(painPoints, bodyCount);
  const differentiatorBuckets = distributeFrontLoaded(differentiators, bodyCount);

  for (let i = 1; i <= total; i++) {
    const role: SectionStrategicAssignment['section_role'] =
      i === 1 ? 'introduction' : i === total ? 'closing' : 'body';

    const required_context: string[] = [];
    const required_positioning: string[] = [];
    const required_pain_points: string[] = [];
    const required_differentiators: string[] = [];

    if (role === 'introduction') {
      if (context.coreProblemStatement) required_context.push(`Core problem: ${context.coreProblemStatement}`);
      if (context.idealCustomerProfile) required_context.push(`ICP: ${context.idealCustomerProfile}`);
      else if (context.audience) required_context.push(`Audience: ${context.audience}`);
      if (context.awarenessGap) required_context.push(`Awareness gap: ${context.awarenessGap}`);
      if (context.uniqueValue) required_positioning.push(`Unique value: ${context.uniqueValue}`);
      // Surface first 2 differentiators in the intro for early positioning.
      required_differentiators.push(...differentiators.slice(0, 2));
    } else if (role === 'closing') {
      if (context.desiredTransformation) required_context.push(`Transformation outcome: ${context.desiredTransformation}`);
      if (context.transformationMechanism) required_context.push(`Transformation mechanism: ${context.transformationMechanism}`);
      if (context.lifeAfterSolution) required_context.push(`Life after solution: ${context.lifeAfterSolution}`);
      if (context.uniqueValue) required_positioning.push(`Reaffirm unique value: ${context.uniqueValue}`);
      // Surface key messages in the closing for memorable hooks.
      required_positioning.push(...keyMessages);
    } else {
      // Body section: pick this section's pain points and differentiators
      const bodyIdx = i - bodyIndexStart;
      required_pain_points.push(...(painBuckets[bodyIdx] ?? []));
      required_differentiators.push(...(differentiatorBuckets[bodyIdx] ?? []));
      if (context.problemImpact && bodyIdx === 0) {
        required_context.push(`Problem impact: ${context.problemImpact}`);
      }
      if (context.lifeWithProblem && bodyIdx === 1 && bodyCount >= 3) {
        required_context.push(`Life with problem: ${context.lifeWithProblem}`);
      }
      if (context.productsServices && bodyIdx === bodyCount - 1) {
        required_context.push(`Products/services to reference naturally: ${context.productsServices}`);
      }
    }

    // Authority domains rotate as positioning anchors across body sections.
    if (role === 'body' && authorityDomains.length > 0) {
      const idx = (i - bodyIndexStart) % authorityDomains.length;
      required_positioning.push(`Authority lens: ${authorityDomains[idx]}`);
    }

    assignments.push({
      section_id: i,
      section_role: role,
      required_context,
      required_positioning,
      required_pain_points,
      required_differentiators,
    });
  }

  const hasAssignments = assignments.some(
    (a) =>
      a.required_context.length > 0 ||
      a.required_positioning.length > 0 ||
      a.required_pain_points.length > 0 ||
      a.required_differentiators.length > 0,
  );

  return { total_sections: total, assignments, hasAssignments };
}

// ── Rendering for prompt injection ───────────────────────────────────────────

/**
 * Render the assignments into a structured per-section directive string.
 *
 * This string replaces the old comma-joined `must_include_points` blob.
 * The model receives explicit anchors PER SECTION rather than a global
 * checklist, which is what removes the checklist-style flattening.
 */
export function renderSectionStrategicAssignmentsForPrompt(
  bundle: SectionStrategicAssignmentBundle,
): string {
  if (!bundle.hasAssignments) return '';

  const lines: string[] = [
    `STRATEGIC ASSIGNMENTS (one bundle per section — do NOT collapse into a global checklist):`,
  ];

  for (const a of bundle.assignments) {
    const parts: string[] = [];
    if (a.required_context.length) parts.push(`context: ${a.required_context.join(' | ')}`);
    if (a.required_positioning.length) parts.push(`positioning: ${a.required_positioning.join(' | ')}`);
    if (a.required_pain_points.length) parts.push(`pain points: ${a.required_pain_points.join(' | ')}`);
    if (a.required_differentiators.length) parts.push(`differentiators: ${a.required_differentiators.join(' | ')}`);
    if (parts.length === 0) continue;
    lines.push(`Section ${a.section_id} [${a.section_role}]: ${parts.join('; ')}`);
  }

  return lines.join('\n');
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function splitToList(value: string | undefined, max: number): string[] {
  if (!value) return [];
  // Accept either a pre-split list (semicolons/commas) or a single string.
  return value
    .split(/[;,]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max);
}
