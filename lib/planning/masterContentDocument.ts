/**
 * Master Content Document — scaffold for multi-platform generation.
 * Structure only: no persistence, no AI calls, no content generation.
 */

import type { RepurposingContext } from './repurposingContext';

export interface PlatformVariantSlot {
  execution_id: string;
  status: 'PENDING' | 'GENERATED';
  content?: string;
}

export interface MasterContentDocument {
  master_title: string;
  source_execution_id: string;
  platforms: string[];
  platform_variants: Record<string, PlatformVariantSlot>;
}

/**
 * Build master content document from repurposing context. Read-only scaffolding.
 */
export function buildMasterContentDocument(
  repurposingContext: RepurposingContext | null | undefined,
  currentExecutionId: string
): MasterContentDocument | null {
  if (!repurposingContext) return null;

  const platformVariants: Record<string, PlatformVariantSlot> = {};

  const idLower = (s: string) => String(s ?? '').toLowerCase();
  const platformsByLength = [...repurposingContext.platforms].sort(
    (a, b) => b.length - a.length
  );

  for (const id of repurposingContext.sibling_execution_ids) {
    const platform =
      platformsByLength.find((p) => idLower(id).includes(idLower(p))) ??
      'unknown';

    platformVariants[platform] = {
      execution_id: id,
      status: 'PENDING',
    };
  }

  const doc: MasterContentDocument = {
    master_title: repurposingContext.master_title,
    source_execution_id: currentExecutionId,
    platforms: repurposingContext.platforms,
    platform_variants: platformVariants,
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('[MasterContentDocument]', doc);
  }

  return doc;
}
