/**
 * BOLT Creator format → ContentCapability mapping.
 *
 * The BOLT Creator platform picker needs to know which capability in the
 * canonical registry (`lib/shared/social/platformCapabilities.ts`) each
 * creator format draws from, so it can re-filter active platforms as the
 * user toggles formats. Without this map the picker only honors the
 * coarse `creator` capability, hiding LinkedIn / Facebook / Pinterest /
 * Reddit for banner / image / PDF campaigns those platforms obviously
 * support.
 *
 * Adding a new creator format = one-line addition here plus an entry in
 * the form's CONTENT_FORMATS list.
 */

import type { ContentCapability } from '../social/platformCapabilities';

export type CreatorContentFormat =
  | 'video'
  | 'reel'
  | 'carousel'
  | 'image'
  | 'short'
  | 'banner'
  | 'infographic'
  | 'pdf'
  | 'slider';

export const CREATOR_FORMAT_CAPABILITY: Record<CreatorContentFormat, ContentCapability> = {
  video: 'video',
  reel: 'video',
  short: 'video',
  carousel: 'carousel',
  pdf: 'carousel',
  slider: 'carousel',
  image: 'image',
  banner: 'image',
  infographic: 'image',
};

export function getCreatorFormatCapability(format: string): ContentCapability | null {
  return CREATOR_FORMAT_CAPABILITY[format as CreatorContentFormat] ?? null;
}
