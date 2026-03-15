/**
 * Canonical audience categories for campaign targeting.
 * Single source of truth for target audience options across AI Chat, Trend Campaigns, and execution config.
 *
 * Design: No overlap between primary categories. Creators/Healthcare workers are professional segments.
 * SMB owners merged into Entrepreneurs (small-business owners are entrepreneurs).
 */

/** Primary target audience categories. Mutually exclusive. */
export const TARGET_AUDIENCE_CATEGORIES = [
  'Professionals',
  'Entrepreneurs',
  'Students',
  'Parents',
  'Educators',
  'Homemakers',
  'Job seekers',
  'Freelancers',
  'Retirees',
] as const;

export type TargetAudienceCategory = (typeof TARGET_AUDIENCE_CATEGORIES)[number];

/** Professional segment sub-options (when Target Audience = Professionals). */
export const PROFESSIONAL_SEGMENTS = [
  'Managers',
  'Job seekers',
  'Founders',
  'Corporate employees',
  'Healthcare workers',
  'Creators',
] as const;

export type ProfessionalSegment = (typeof PROFESSIONAL_SEGMENTS)[number];
