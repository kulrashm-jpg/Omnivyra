import {
  CONTENT_TYPE_FILE_RULES,
  isOwnedLongformContentType,
  type OwnedLongformContentType,
  type PlannedContentType,
} from './contentTypeFileRules';

export { isOwnedLongformContentType };
export type { OwnedLongformContentType, PlannedContentType };

export const CONTENT_TYPE_OWNERSHIP: Record<PlannedContentType, string> = Object.fromEntries(
  Object.entries(CONTENT_TYPE_FILE_RULES).map(([contentType, rule]) => [contentType, rule.namespace]),
) as Record<PlannedContentType, string>;

export function getOwnedModuleNamespace(contentType: PlannedContentType): string {
  return CONTENT_TYPE_OWNERSHIP[contentType];
}
