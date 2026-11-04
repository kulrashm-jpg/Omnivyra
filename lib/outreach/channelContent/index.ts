/**
 * Outreach channel-content layer: per-channel profiles, deterministic
 * formatters and finding-returning validators. Pure; see `types.ts`.
 */
export * from './types';
export * from './profiles';
export * from './channels';
export { formatChannelContent, validateChannelContent } from './channelRules';
export {
  PERSONALIZATION_FIELDS,
  checkPlaceholders,
  findPlaceholders,
  isAuthorizedPersonalizationField,
} from './personalization';
export { analyzeSms, countEmoji, countLinks, normalizeText, SMS_LIMITS } from './textRules';
export type { SmsAnalysis } from './textRules';
export { formatSocialPost, getSocialChannelProfile, validateSocialPost } from './socialAdapter';
export type { SocialChannelProfile } from './socialAdapter';
