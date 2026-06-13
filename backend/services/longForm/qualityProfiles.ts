/**
 * qualityProfiles.ts
 *
 * Content-type quality profiles for the shared thought-leadership gate.
 *
 * Why this exists
 * ---------------
 * `evaluateThoughtLeadershipQuality` + `validateFinalBlogOutcome` are a single
 * blog/thought-leadership-calibrated gate applied (content-type-agnostically) to
 * every non-story long-form type. Several subchecks encode blog conventions
 * (named framework, executive audience, executive title rubric, blog body word
 * floors, duplication ≤25 for long differentiated bodies) that newsletter and
 * white paper legitimately violate, producing false failures.
 *
 * This module turns that one gate into a PROFILE-DRIVEN gate. The `default`
 * profile reproduces the pre-profile behavior verbatim; article / blog / guide
 * all resolve to it (byte-identical). Newsletter and white paper get tailored
 * profiles. No thresholds were changed for the default — they are restated here
 * as the single source of truth.
 *
 * Pure / deterministic / never throws.
 */

import type { ContentDuplicationValidationResult } from './contentDuplicationValidator';
import { classifyNewsletterDuplication } from './newsletterDuplicationPolicy';

export type TitleRubric = 'executive' | 'formal' | 'inbox';
export type DuplicationPolicyMode = 'strict' | 'newsletter';
export type SeverityMode = 'hard' | 'soft';

export type ThoughtLeadershipSubcheck =
  | 'companyPov'
  | 'strategicValue'
  | 'executiveAudience'
  | 'rebrandResistance'
  | 'frameworkPresence'
  | 'genericContent'
  | 'editorialBody'
  | 'contentDuplication'
  | 'finalOutcome';

export interface QualityProfileThresholds {
  companyPov: number;
  strategicValue: number;
  finalOutcomeAggregate: number;
  titleScore: number;
  bodyScore: number;
  actionScore: number;
  povAlignmentScore: number;
  /** Max duplication score tolerated under the 'strict' policy. */
  duplicationMaxScore: number;
}

export interface QualityProfile {
  contentType: string;
  enabledSubchecks: ReadonlySet<ThoughtLeadershipSubcheck>;
  thresholds: QualityProfileThresholds;
  titleRubric: TitleRubric;
  duplicationPolicy: DuplicationPolicyMode;
  /** When false, blog body word-floor deductions are skipped (newsletters). */
  enforceBodyWordFloor: boolean;
  severityMode: SeverityMode;
}

const ALL_SUBCHECKS: ThoughtLeadershipSubcheck[] = [
  'companyPov',
  'strategicValue',
  'executiveAudience',
  'rebrandResistance',
  'frameworkPresence',
  'genericContent',
  'editorialBody',
  'contentDuplication',
  'finalOutcome',
];

// EXACT pre-profile thresholds — do not change; the default profile must
// reproduce the original gate behavior verbatim.
const DEFAULT_THRESHOLDS: QualityProfileThresholds = {
  companyPov: 80,
  strategicValue: 80,
  finalOutcomeAggregate: 82,
  titleScore: 78,
  bodyScore: 82,
  actionScore: 75,
  povAlignmentScore: 80,
  duplicationMaxScore: 25,
};

/**
 * The default profile == the original gate. article / blog / guide use it, so
 * their behavior is byte-identical to before this module existed.
 */
export const DEFAULT_QUALITY_PROFILE: QualityProfile = {
  contentType: 'default',
  enabledSubchecks: new Set(ALL_SUBCHECKS),
  thresholds: { ...DEFAULT_THRESHOLDS },
  titleRubric: 'executive',
  duplicationPolicy: 'strict',
  enforceBodyWordFloor: true,
  severityMode: 'hard',
};

const PROFILES: Record<string, QualityProfile> = {
  article: { ...DEFAULT_QUALITY_PROFILE, contentType: 'article' },
  blog: { ...DEFAULT_QUALITY_PROFILE, contentType: 'blog' },
  guide: { ...DEFAULT_QUALITY_PROFILE, contentType: 'guide' },

  // Newsletter: inbox voice, no named framework, short letter sections.
  newsletter: {
    contentType: 'newsletter',
    enabledSubchecks: new Set(
      ALL_SUBCHECKS.filter((s) => s !== 'executiveAudience' && s !== 'frameworkPresence'),
    ),
    thresholds: { ...DEFAULT_THRESHOLDS },
    titleRubric: 'inbox',
    duplicationPolicy: 'newsletter',     // reuse classifyNewsletterDuplication
    enforceBodyWordFloor: false,         // newsletters are short by design
    severityMode: 'soft',                // residual failures route through the newsletter quality layer
  },

  // White paper: retain POV / strategic value / actionability / framework, keep
  // hard enforcement; only the executive title rubric and the strict duplication
  // ceiling were false-failing formal, methodical documents.
  whitepaper: {
    contentType: 'whitepaper',
    enabledSubchecks: new Set(ALL_SUBCHECKS),
    thresholds: { ...DEFAULT_THRESHOLDS, duplicationMaxScore: 45 },
    titleRubric: 'formal',
    duplicationPolicy: 'strict',
    enforceBodyWordFloor: true,
    severityMode: 'hard',
  },
};

/** Resolve the profile for a content type. Unknown / undefined → default. */
export function getQualityProfile(contentType?: string): QualityProfile {
  if (!contentType) return DEFAULT_QUALITY_PROFILE;
  return PROFILES[contentType] ?? DEFAULT_QUALITY_PROFILE;
}

/**
 * Single source of truth for whether a duplication result is a HARD failure
 * under a profile. Used by BOTH the top-level duplication subcheck and the
 * finalOutcome "Duplicate structure" subcheck (no duplicated logic).
 *
 * For the default ('strict', max 25) this is `score > 25`, i.e. the exact
 * inverse of `ContentDuplicationValidationResult.passed` — byte-identical.
 */
export function duplicationFailsProfile(
  result: ContentDuplicationValidationResult,
  profile: QualityProfile,
): boolean {
  if (profile.duplicationPolicy === 'newsletter') {
    return classifyNewsletterDuplication(result).severe; // only severe blocks
  }
  return result.score > profile.thresholds.duplicationMaxScore;
}
