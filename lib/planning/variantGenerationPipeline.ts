/**
 * Variant Generation Pipeline — structure normalization only.
 * Does NOT set GENERATED or create content. Planning layer stays orchestration-only;
 * real generation is done by backend contentGenerationPipeline via executeMasterContentPipeline.
 */

import type { MasterContentDocument } from './masterContentDocument';

/**
 * Normalizes master content document structure only. Keeps all slots PENDING; content undefined.
 * Does not mutate input. Use when you need a clean clone without fake generation.
 */
export function runVariantGenerationPipeline(
  doc: MasterContentDocument | null
): MasterContentDocument | null {
  if (!doc) return null;

  const cloned: MasterContentDocument = {
    ...doc,
    platform_variants: {},
  };

  for (const platform of Object.keys(doc.platform_variants)) {
    const slot = doc.platform_variants[platform];
    cloned.platform_variants[platform] = {
      ...slot,
      status: slot.status ?? 'PENDING',
      content: slot.content,
    };
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[VariantGenerationPipeline]', 'normalize-only', cloned);
  }

  return cloned;
}
