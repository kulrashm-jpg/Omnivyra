/**
 * Carousel Phase B — Commit B2 (acceptance gate + targeted regeneration).
 *
 * Consumes the B1 evaluator (carouselQualityEvaluator) UNCHANGED and the shared
 * generationAcceptanceEvaluator to derive an accept / repair / reject decision
 * under a staged enforcement mode (shadow | warn | strict). All logic here is
 * pure and side-effect-free (the engine owns regeneration + telemetry I/O), so
 * the full decision matrix is unit-testable at zero API cost.
 *
 * Scoring algorithms and telemetry foundations are NOT modified here.
 */
import { evaluateCarouselQuality, type CarouselQualityInput } from './carouselQualityEvaluator';
import { evaluateGenerationAcceptance } from '../../../lib/shared/generationAcceptanceEvaluator';
import type { EditorGradeResult, EditorGradeStatus } from '../../../lib/shared/editorGradeReadiness';

export type CarouselEnforcementMode = 'shadow' | 'warn' | 'strict';
export type CarouselQualityAction = 'accept' | 'accept_with_warnings' | 'regenerate' | 'reject';

/** Bounded quality-retry budget (separate from completeness retries) + a shared
 *  hard ceiling on total generation attempts to prevent runaway loops. */
export const MAX_CAROUSEL_QUALITY_RETRIES = 1;
export const MAX_TOTAL_CAROUSEL_ATTEMPTS = 6;

/** Resolve the enforcement mode from the environment. Defaults to SHADOW so an
 *  un-configured deploy behaves exactly like B1 (measure + record, never block). */
export function resolveCarouselQualityMode(): CarouselEnforcementMode {
  const raw = String(process.env.CAROUSEL_QUALITY_ENFORCEMENT_MODE || '').toLowerCase().trim();
  return raw === 'warn' || raw === 'strict' ? raw : 'shadow';
}

export type CarouselQualityAssessment = {
  result: EditorGradeResult;
  status: EditorGradeStatus;
  score: number;
  failingChecks: string[];
  recommendedActions: string[];
};

/** Score a carousel (B1) and pass the EditorGradeResult through the shared
 *  acceptance evaluator to derive status + failing checks. No decisions here. */
export function assessCarouselQuality(input: CarouselQualityInput): CarouselQualityAssessment {
  const result = evaluateCarouselQuality(input);
  const content = (Array.isArray(input.slides) ? input.slides : [])
    .map((s) => `${typeof s.headline === 'string' ? s.headline : ''}\n${typeof s.body_text === 'string' ? s.body_text : ''}`)
    .join('\n\n');
  const acceptance = evaluateGenerationAcceptance({
    content,
    logicalContentType: 'carousel',
    phase: 'generation',
    editorGradeResults: [result],
    metadata: { archetype: input.archetype ?? null, cta_intensity: input.ctaIntensity ?? null },
  });
  return {
    result,
    status: acceptance.editor_grade_status,
    score: acceptance.editor_grade_score,
    failingChecks: acceptance.failing_checks,
    recommendedActions: acceptance.recommended_actions,
  };
}

/** Pure decision matrix. SHADOW never blocks; WARN annotates but ships; STRICT
 *  regenerates repairable failures within budget, else rejects. */
export function decideCarouselQualityAction(args: {
  mode: CarouselEnforcementMode;
  status: EditorGradeStatus;
  qualityRetries: number;
  totalAttempts: number;
  maxQualityRetries?: number;
  maxTotalAttempts?: number;
}): CarouselQualityAction {
  const maxQ = args.maxQualityRetries ?? MAX_CAROUSEL_QUALITY_RETRIES;
  const maxT = args.maxTotalAttempts ?? MAX_TOTAL_CAROUSEL_ATTEMPTS;
  if (args.mode === 'shadow') return 'accept';
  if (args.mode === 'warn') return args.status === 'approved' ? 'accept' : 'accept_with_warnings';
  // strict
  if (args.status === 'approved') return 'accept';
  if (args.qualityRetries < maxQ && args.totalAttempts < maxT) return 'regenerate';
  return 'reject';
}

/** Per-dimension regeneration scope (informational — used for directives +
 *  telemetry). Mechanism is directed whole-deck regeneration that reuses the
 *  existing generation path. */
const DIMENSION_DIRECTIVES: Record<string, { scope: 'slide' | 'deck'; instruction: string }> = {
  'carousel.slide_uniqueness': { scope: 'slide', instruction: 'Two or more slides overlap. Rewrite the duplicated slide(s) with genuinely distinct ideas; never restate a point already made.' },
  'carousel.cta_quality': { scope: 'slide', instruction: 'The final CTA slide is weak or misaligned. Rewrite ONLY the CTA so it is specific and actionable and matches the required CTA intensity.' },
  'carousel.insight_density': { scope: 'slide', instruction: 'Add concrete specifics (a number, a named example, or a mechanism) to the thin slides; remove abstract-only content.' },
  'carousel.genericity': { scope: 'slide', instruction: 'Replace generic advice and AI-filler phrasing with specific, sourced, point-of-view claims.' },
  'carousel.narrative_progression': { scope: 'deck', instruction: 'Strengthen the arc: each slide must build on the previous one and escalate toward the CTA; keep the hook and CTA beats.' },
};

/** Build a targeted regeneration directive from the failing dimensions. CTA
 *  failures include the required intensity. Returns '' when nothing actionable. */
export function buildQualityRetryDirective(failingChecks: string[], ctaIntensity?: string | null): string {
  const lines: string[] = [];
  for (const id of failingChecks) {
    const entry = DIMENSION_DIRECTIVES[id];
    if (!entry) continue;
    if (id === 'carousel.cta_quality' && ctaIntensity) {
      lines.push(`- ${entry.instruction} (CTA intensity: ${ctaIntensity}.)`);
    } else {
      lines.push(`- ${entry.instruction}`);
    }
  }
  if (lines.length === 0) return '';
  return [
    'QUALITY REVISION REQUIREMENT: the previous draft was complete but did not meet editor-grade quality. Regenerate the full deck, keeping what worked and fixing:',
    ...lines,
    'Do not introduce placeholder text. Keep the exact arc role order and slide count.',
  ].join('\n');
}

/** Classify the regeneration scope of a failure set (telemetry/diagnostics). */
export function classifyRegenerationScope(failingChecks: string[]): 'slide' | 'deck' | 'none' {
  let sawSlide = false;
  for (const id of failingChecks) {
    const entry = DIMENSION_DIRECTIVES[id];
    if (!entry) continue;
    if (entry.scope === 'deck') return 'deck';
    sawSlide = true;
  }
  return sawSlide ? 'slide' : 'none';
}
