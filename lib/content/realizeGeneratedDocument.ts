/**
 * Generation → Editor asset-realization seam (CREATOR-038, STEP 1/2/9).
 *
 * This is THE single insertion point where a freshly generated long-form
 * document becomes editable blocks. Every long-form `pages/<type>/new.tsx`
 * prefill flow calls this instead of `resolveGeneratedPrefillBlocks` directly,
 * so realization happens exactly once per document load — before the editor
 * mounts — and the editor never receives an unrealized (empty-image) document.
 *
 * It is synchronous (placeholder builds URL strings with no IO), so it is a
 * drop-in replacement for the existing sync prefill call — no async refactor of
 * the fragile prefill effects. Richer providers (AI / org / stock) run later via
 * per-slot editor actions. Reuses the engine — no new pipeline.
 */

import type { ContentBlock } from '../blog/blockTypes';
import { resolveGeneratedPrefillBlocks, type GeneratedOutput } from './editorPrefill';
import { realizeDocumentAssetsSync, deriveAssetSlots, realizeAssetSlot, applySlotToBlocks, validateLayoutParity, type AssetSlot, type AssetProvider, type RealizationContext } from './assetRealization';
import { getEmptyImagePolicy, type EmptyImagePolicy } from './longformEmptyImagePolicy';

export interface RealizationDiagnostics {
  contentType: string;
  policy: EmptyImagePolicy;
  slotCount: number;
  realizedCount: number;
  failedCount: number;
  emptyAfter: number;          // images still without a url (0 for placeholder; >0 for stock/empty — editor fills)
  providersUsed: Record<string, number>;
  layoutParityOk: boolean;
  missingAssets: string[];
  durationMs?: number;
}

export interface RealizedDocument {
  content_blocks: ContentBlock[];
  slots: AssetSlot[];
  diagnostics: RealizationDiagnostics;
}

/**
 * Resolve generated output into editable blocks AND realize every visual asset
 * slot before the editor opens. Drop-in for `resolveGeneratedPrefillBlocks`.
 */
export function realizeGeneratedDocument(
  output: GeneratedOutput | null | undefined,
  fallbackBlocks: ContentBlock[],
  ctx: RealizationContext,
): RealizedDocument {
  const resolved = resolveGeneratedPrefillBlocks(output, fallbackBlocks);
  const policy = getEmptyImagePolicy();
  // STEP 2 — only 'placeholder' fills at the seam. 'stock'/'empty' preserve the
  // empty image blocks (block, layout, slot, editor actions intact); for 'stock'
  // the editor fills them via the stock provider on open.
  const { blocks, slots } = policy === 'placeholder'
    ? realizeDocumentAssetsSync(resolved, ctx)
    : { blocks: resolved, slots: deriveAssetSlots(resolved, ctx) };

  const providersUsed: Record<string, number> = {};
  for (const s of slots) if (s.provider) providersUsed[s.provider] = (providersUsed[s.provider] || 0) + 1;

  const parity = validateLayoutParity(resolved, blocks);
  const emptyAfter = deriveAssetSlots(blocks, ctx).filter((s) => !s.url).length;

  const diagnostics: RealizationDiagnostics = {
    contentType: ctx.contentType,
    policy,
    slotCount: slots.length,
    realizedCount: slots.filter((s) => s.status === 'realized').length,
    failedCount: slots.filter((s) => s.status === 'failed').length,
    emptyAfter,
    providersUsed,
    layoutParityOk: parity.ok,
    missingAssets: parity.missing,
  };

  // STEP 9 — runtime diagnostics (browser only; quiet on the server / in tests).
  if (typeof window !== 'undefined') {
    try { console.debug('[asset-realization]', diagnostics); } catch { /* noop */ }
  }

  return { content_blocks: blocks, slots, diagnostics };
}

/** Convenience for callers that only need the blocks (matches the old seam shape). */
export function realizeGeneratedBlocks(
  output: GeneratedOutput | null | undefined,
  fallbackBlocks: ContentBlock[],
  ctx: RealizationContext,
): ContentBlock[] {
  return realizeGeneratedDocument(output, fallbackBlocks, ctx).content_blocks;
}

/**
 * Editor-side upgrade for the 'stock' policy (STEP 2): realize ONLY the empty
 * IMAGE slots through the given provider chain (stock → placeholder), preserving
 * every other block. Reuses the engine; no new pipeline. Pure + deterministic
 * given the providers.
 */
export async function realizeEmptyImageSlots(
  blocks: ContentBlock[],
  providers: AssetProvider[],
  ctx: RealizationContext,
): Promise<{ blocks: ContentBlock[]; slots: AssetSlot[] }> {
  const empties = deriveAssetSlots(blocks, ctx).filter((s) => s.assetType === 'image' && !s.url);
  let next = blocks;
  const slots: AssetSlot[] = [];
  for (const slot of empties) {
    const realized = await realizeAssetSlot(slot, providers, ctx);
    slots.push(realized);
    next = applySlotToBlocks(next, realized);
  }
  return { blocks: next, slots };
}
