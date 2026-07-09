/**
 * Platform content guidelines.
 *
 * Agent-B split (behavior-preserving): the guideline DATA lives in
 * platform-guidelinesDataA (linkedin/twitter/instagram + the shared types)
 * and platform-guidelinesDataB (youtube/facebook); merged here so the
 * public PLATFORM_GUIDELINES record and all helpers are unchanged.
 */
import { PLATFORM_GUIDELINES_A, type PlatformContentGuidelines, type ContentType } from './platform-guidelinesDataA';
import { PLATFORM_GUIDELINES_B } from './platform-guidelinesDataB';

export type { PlatformContentGuidelines, ContentType, MediaRequirement } from './platform-guidelinesDataA';

export const PLATFORM_GUIDELINES: Record<string, PlatformContentGuidelines> = {
  ...PLATFORM_GUIDELINES_A,
  ...PLATFORM_GUIDELINES_B,
};
// Helper functions for content optimization
export const getPlatformGuidelines = (platform: string): PlatformContentGuidelines => {
  return PLATFORM_GUIDELINES[platform] || PLATFORM_GUIDELINES.linkedin;
};

export const getContentTypeGuidelines = (platform: string, contentType: string): ContentType | null => {
  const guidelines = getPlatformGuidelines(platform);
  return guidelines.contentTypes.find(type => type.type === contentType) || null;
};

export const validateContent = (platform: string, contentType: string, content: string, hashtags: string[]): ValidationResult => {
  const typeGuidelines = getContentTypeGuidelines(platform, contentType);
  if (!typeGuidelines) {
    return { isValid: false, errors: ['Invalid content type'], warnings: [], score: 0 };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Character limit validation
  if (content.length > typeGuidelines.characterLimit) {
    errors.push(`Content exceeds character limit of ${typeGuidelines.characterLimit}`);
  } else if (content.length < typeGuidelines.characterLimit * 0.1) {
    warnings.push('Content is very short - consider adding more detail');
  }

  // Hashtag validation
  if (hashtags.length > typeGuidelines.hashtagLimit) {
    errors.push(`Too many hashtags. Maximum allowed: ${typeGuidelines.hashtagLimit}`);
  } else if (hashtags.length < typeGuidelines.hashtagLimit * 0.3) {
    warnings.push(`Consider adding more hashtags for better reach (recommended: ${typeGuidelines.hashtagLimit})`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    score: calculateContentScore(platform, contentType, content, hashtags)
  };
};

export const calculateContentScore = (platform: string, contentType: string, content: string, hashtags: string[]): number => {
  let score = 0;
  const typeGuidelines = getContentTypeGuidelines(platform, contentType);
  if (!typeGuidelines) return 0;

  // Character count score (optimal length gets highest score)
  const optimalLength = typeGuidelines.characterLimit * 0.3;
  const lengthRatio = Math.min(content.length / optimalLength, 1);
  score += lengthRatio * 30;

  // Hashtag score
  const hashtagRatio = Math.min(hashtags.length / typeGuidelines.hashtagLimit, 1);
  score += hashtagRatio * 20;

  // Engagement indicators
  if (content.includes('?')) score += 10; // Questions
  if (content.includes('!')) score += 5; // Excitement
  if (hashtags.length > 0) score += 10; // Hashtags present
  if (content.length > 50) score += 15; // Substantial content
  if (content.includes('http')) score += 10; // Links

  return Math.min(score, 100);
};

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  score: number;
}























