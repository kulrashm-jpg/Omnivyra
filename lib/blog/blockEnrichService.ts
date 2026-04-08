/**
 * blockEnrichService.ts — Client-side block enrichment service
 */

import type { ContentBlock, BlockType } from './blockTypes';

const ENRICHABLE: Set<BlockType> = new Set([
  'paragraph', 'heading', 'key_insights', 'callout', 'quote', 'list', 'summary',
]);

export function isEnrichable(type: BlockType): boolean {
  return ENRICHABLE.has(type);
}

/** Extract target block + surrounding context (windowSize blocks before and after). */
export function buildBlockContext(
  allBlocks: ContentBlock[],
  targetIndex: number,
  windowSize = 2,
): { block: ContentBlock; contextBlocks: ContentBlock[] } {
  const start = Math.max(0, targetIndex - windowSize);
  const end = Math.min(allBlocks.length, targetIndex + windowSize + 1);
  const contextBlocks = allBlocks.slice(start, end).filter((_, i) => start + i !== targetIndex);
  return { block: allBlocks[targetIndex], contextBlocks };
}

/** Call the enrich API and return the enriched block. */
export async function enrichBlock(params: {
  companyId: string;
  block: ContentBlock;
  contextBlocks: ContentBlock[];
  blogMeta: { title: string; excerpt: string; tags: string[] };
}): Promise<{ enriched_block: ContentBlock; changes_summary: string }> {
  const resp = await fetch('/api/blogs/enrich-block', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_id: params.companyId,
      block: params.block,
      context_blocks: params.contextBlocks,
      blog_meta: params.blogMeta,
    }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || 'Enrichment failed');
  }

  return resp.json();
}
