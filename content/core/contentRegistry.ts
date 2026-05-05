import { CONTENT_TYPES, isContentType, type ContentType } from './contentTypes';

export { CONTENT_TYPES };
export type { ContentType };

export function getContentTypeConfig(type: ContentType) {
  return CONTENT_TYPES[type];
}

export function assertContentType(type: unknown): asserts type is ContentType {
  if (!isContentType(type)) {
    throw new Error(`Unsupported content type: ${String(type)}`);
  }
}

export function supportsContentFeature(type: ContentType, feature: string): boolean {
  return (CONTENT_TYPES[type].supports as readonly string[]).includes(feature);
}
