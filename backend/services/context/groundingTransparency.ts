/**
 * groundingTransparency.ts — CONTENT-INTELLIGENCE-002 Phase 4.
 *
 * Deterministic "Grounded From / Confidence / Freshness / Evidence / Missing"
 * projection over a CanonicalContext. Every AI recommendation can expose this
 * so the user sees exactly what grounded it — and what didn't.
 */
import {
  FIELD_LABELS,
  type CanonicalContext,
  type Fact,
  type GroundedSource,
  type GroundingTransparency,
} from './canonicalContextTypes';

/** Ordered sources shown in "Grounded From" (label → context field). */
const TRANSPARENCY_FIELDS: ReadonlyArray<keyof CanonicalContext> = [
  'websiteIntelligence', 'offerings', 'differentiators', 'icp', 'painPoints',
  'brandPositioning', 'evidence', 'contentHistory', 'campaignHistory',
  'competitiveObservations', 'seoObservations', 'marketSignals',
];

function factOf(ctx: CanonicalContext, field: keyof CanonicalContext): Fact<unknown> | null {
  const v = ctx[field] as unknown;
  return v && typeof v === 'object' && 'origin' in (v as object) ? (v as Fact<unknown>) : null;
}

export function computeTransparency(ctx: CanonicalContext): GroundingTransparency {
  const groundedFrom: GroundedSource[] = [];
  const missingContext: string[] = [];
  let freshestDays: number | null = null;
  let presentCount = 0;

  for (const field of TRANSPARENCY_FIELDS) {
    const label = FIELD_LABELS[field] ?? String(field);
    const fact = factOf(ctx, field);
    const present = !!fact;
    groundedFrom.push({ source: label, present });
    if (present) {
      presentCount += 1;
      const d = fact!.freshness.ageDays;
      if (d !== null && (freshestDays === null || d < freshestDays)) freshestDays = d;
    } else {
      missingContext.push(label);
    }
  }

  // Confidence blends overall quality with breadth of grounding. Deterministic.
  const breadth = TRANSPARENCY_FIELDS.length > 0 ? presentCount / TRANSPARENCY_FIELDS.length : 0;
  const confidence = Math.round(100 * (0.7 * ctx.quality.score + 0.3 * breadth));

  const freshnessLabel = freshestDays === null
    ? 'unknown'
    : freshestDays <= 1 ? 'today' : `${freshestDays} days`;

  const evidenceAvailable =
    !!ctx.evidence ||
    ctx.evidenceIntelligence.internal.length > 0 ||
    ctx.evidenceIntelligence.external.length > 0;

  return { groundedFrom, confidence, freshnessLabel, freshestDays, evidenceAvailable, missingContext };
}
