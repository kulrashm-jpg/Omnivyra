/**
 * Backend re-export of the engagement capability map.
 * The single source of truth lives in lib/engagementCapabilities.ts so the
 * UI and the API routes agree by construction.
 */

export {
  resolveEngagementCapability,
  normalizePlatformSlug,
  ENGAGEMENT_PLATFORMS,
  ENGAGEMENT_CAPABILITY_MATRIX,
  VERIFIED_ENGAGEMENT_PLATFORMS,
  VERIFIED_PUBLISH_PLATFORMS,
  CAPABILITY_MAP_VERSION,
  isEngagementPlatformVerified,
  isPublishPlatformVerified,
} from '../../lib/engagementCapabilities';
export type {
  EngagementActionKey,
  EngagementCapability,
  EngagementPlatform,
  AccountType,
} from '../../lib/engagementCapabilities';
