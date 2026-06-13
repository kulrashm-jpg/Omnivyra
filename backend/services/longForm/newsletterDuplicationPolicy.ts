/**
 * newsletterDuplicationPolicy.ts
 *
 * NEWSLETTER-ONLY policy layer for the shared content-duplication gate.
 *
 * Why this exists
 * ---------------
 * The shared `validateContentDuplication` gate is correctly calibrated for
 * differentiated long-form (a distinct newsletter scores 0 and passes). But
 * its CALL SITE in longFormPlanningEngine hard-`throw`s on any residual
 * duplication, content-type-agnostically — which kills a newsletter job
 * before the newsletter quality layer can remediate, even for borderline
 * repetition that should be warned-and-shipped.
 *
 * This module owns the NEWSLETTER-ONLY decision of what to do with a failing
 * duplication result. It does NOT change thresholds and is NOT consulted for
 * article / blog / whitepaper / story / case-study (those keep the existing
 * hard-fail behavior verbatim).
 *
 * Pure / deterministic / never throws.
 */

import type { ContentDuplicationValidationResult } from './contentDuplicationValidator';

/** A newsletter is BLOCKED only on severe duplication. */
export const NEWSLETTER_SEVERE_SCORE = 80;
export const NEWSLETTER_SEVERE_SECTION_PAIRS = 3;

export type NewsletterDuplicationClassification = 'clean' | 'warning' | 'blocked';

export interface NewsletterDuplicationDecision {
  /** True when the shared validator did not pass (duplication present). */
  detected: boolean;
  /** True when duplication is severe enough to block publication. */
  severe: boolean;
  classification: NewsletterDuplicationClassification;
  /** Whether the asset is allowed to ship (clean or warning). */
  allow: boolean;
  /** Telemetry-friendly facts pulled straight from the validator result. */
  score: number;
  section_pair_count: number;
  section_pairs: ContentDuplicationValidationResult['repeatedSectionPairs'];
  issues: string[];
}

/**
 * Classify a shared duplication result under the newsletter policy.
 *
 *   - passed            → 'clean'   (allow, unchanged)
 *   - failed, severe    → 'blocked' (block; score >= 80 OR >= 3 section pairs)
 *   - failed, otherwise → 'warning' (allow; route through the newsletter layer)
 */
export function classifyNewsletterDuplication(
  result: ContentDuplicationValidationResult,
): NewsletterDuplicationDecision {
  const detected = !result.passed;
  const section_pair_count = result.repeatedSectionPairs.length;
  const severe = detected
    && (result.score >= NEWSLETTER_SEVERE_SCORE || section_pair_count >= NEWSLETTER_SEVERE_SECTION_PAIRS);

  const classification: NewsletterDuplicationClassification = !detected
    ? 'clean'
    : severe
      ? 'blocked'
      : 'warning';

  return {
    detected,
    severe,
    classification,
    allow: classification !== 'blocked',
    score: result.score,
    section_pair_count,
    section_pairs: result.repeatedSectionPairs,
    issues: result.issues,
  };
}
