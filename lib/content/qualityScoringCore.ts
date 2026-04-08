import {
  calculateQualityScore as calculateSharedQualityScore,
  getPublishBlockers as getSharedPublishBlockers,
  type FormMeta,
  type QualityScore,
  type ValidationIssue,
} from '../blog/blogValidation';

export type ContentFormMeta = FormMeta;
export type ContentQualityScore = QualityScore;
export type ContentValidationIssue = ValidationIssue;

export function calculateContentQualityScore(
  blocks: Parameters<typeof calculateSharedQualityScore>[0],
  form: ContentFormMeta,
): ContentQualityScore {
  return calculateSharedQualityScore(blocks, form);
}

export function getContentPublishBlockers(score: ContentQualityScore): ContentValidationIssue[] {
  return getSharedPublishBlockers(score);
}
