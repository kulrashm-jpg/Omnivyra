/**
 * Universal Long-Form Template Asset Realization Engine (CREATOR-037).
 *
 * One engine for EVERY long-form content type — blog, article, story, guide,
 * newsletter, whitepaper, case-study, research report, ebook, and any future
 * type. It works because all long-form types share a single `ContentBlock[]`
 * model (`lib/blog/blockTypes.ts`); this engine operates on that model and is
 * therefore content-type agnostic by construction.
 *
 * It does NOT introduce a renderer, a template system, or a generation pipeline.
 * It is a thin, pure, deterministic layer that:
 *   1. Audits every visual asset block in a document (STEP 1).
 *   2. Preserves template layout — every asset stays in the same position (STEP 2/9).
 *   3. Realizes each asset through a provider priority chain (STEP 3/8).
 *   4. Models each visual block as an editable Asset Slot (STEP 4).
 *   5. Regenerates / replaces ONE slot without touching anything else (STEP 6/7).
 *   6. Serializes cleanly for draft persistence + undo/redo (STEP 10).
 *
 * Determinism: no Date.now() / Math.random() here. Callers pass `stamp` when they
 * want a timestamp recorded; placeholders are seeded from stable block identity.
 */

import type { ContentBlock, ColumnsBlock, ImageBlock, MediaBlock, CreatorAssetBlock } from '../blog/blockTypes';

/* ── Canonical asset taxonomy (STEP 1) ─────────────────────────────────── */

export type AssetType = 'image' | 'media' | 'creator_asset';

/** Layout/visual purpose a slot serves — inferred from block type + page context. */
export type AssetPurpose =
  | 'hero' | 'cover' | 'inline' | 'side' | 'gallery' | 'comparison'
  | 'infographic' | 'chart' | 'diagram' | 'banner' | 'timeline'
  | 'background' | 'feature' | 'icon_grid' | 'media';

export type AssetProviderId = 'ai' | 'organization' | 'stock' | 'upload' | 'url' | 'placeholder';
export type AssetSlotStatus = 'empty' | 'pending' | 'realized' | 'failed';
export type AssetSlotSource = 'template' | 'generated';

/** One entry in a slot's replacement history — supports undo/redo + audit (STEP 10). */
export interface AssetSlotRevision {
  provider: AssetProviderId;
  url: string;
  reason: 'realize' | 'regenerate' | 'upload' | 'library' | 'url' | 'remove' | 'revert';
  at?: number;            // caller-supplied timestamp (kept out of the engine for determinism)
  prompt?: string;
}

/** The canonical runtime asset model (STEP 4). Plain data → serializes for free. */
export interface AssetSlot {
  slotId: string;
  blockId: string;
  templateAssetId?: string;
  assetType: AssetType;
  purpose: AssetPurpose;
  prompt: string;
  caption?: string;
  altText?: string;
  provider?: AssetProviderId;
  generation?: Record<string, unknown>;
  aspectRatio: string;
  layout: AssetLayout;
  history: AssetSlotRevision[];
  status: AssetSlotStatus;
  source: AssetSlotSource;
  url?: string;
}

export interface AssetLayout {
  indexPath: number[];      // path to the block: [topIdx] or [colsIdx, columnIdx, innerIdx]
  columnIndex?: number;     // set when the asset lives inside a ColumnsBlock cell
  align?: string;
  aspectRatio: string;
}

export interface RealizationContext {
  contentType: string;            // 'blog' | 'article' | 'newsletter' | … (any string; engine is agnostic)
  documentTitle?: string;
  templateName?: string;
  brandStyle?: string;
  stamp?: number;                 // optional deterministic timestamp for history entries
}

export interface RealizedAsset {
  url: string;
  provider: AssetProviderId;
  caption?: string;
  altText?: string;
  attribution?: string;
  generation?: Record<string, unknown>;
}

/** Pluggable provider — return null to fall through to the next provider (STEP 8). */
export interface AssetProvider {
  id: AssetProviderId;
  realize(slot: AssetSlot, ctx: RealizationContext): Promise<RealizedAsset | null>;
}

/* ── Aspect ratios + purpose inference ─────────────────────────────────── */

const ASPECT_BY_PURPOSE: Record<AssetPurpose, string> = {
  hero: '16:9', cover: '16:9', banner: '16:9', background: '16:9', comparison: '16:9', media: '16:9',
  inline: '4:3', feature: '4:3', chart: '16:10', diagram: '16:10',
  side: '3:4', infographic: '4:5', gallery: '1:1', icon_grid: '1:1', timeline: '21:9',
};

function purposeFromKeywords(text: string): AssetPurpose | null {
  const t = text.toLowerCase();
  const hit: Array<[RegExp, AssetPurpose]> = [
    [/\b(hero)\b/, 'hero'], [/\bcover\b/, 'cover'], [/\bbanner\b/, 'banner'],
    [/\b(infographic)\b/, 'infographic'], [/\b(diagram|schematic|architecture)\b/, 'diagram'],
    [/\b(chart|graph|plot)\b/, 'chart'], [/\b(timeline|roadmap)\b/, 'timeline'],
    [/\b(comparison|versus|vs\.?)\b/, 'comparison'], [/\b(background|backdrop)\b/, 'background'],
    [/\b(gallery|grid of)\b/, 'gallery'], [/\b(icon grid|icon set)\b/, 'icon_grid'],
    [/\b(feature illustration|illustration)\b/, 'feature'],
  ];
  for (const [re, p] of hit) if (re.test(t)) return p;
  return null;
}

/* ── Asset inventory (STEP 1) ──────────────────────────────────────────── */

export interface AssetBlockRef {
  blockId: string;
  assetType: AssetType;
  purpose: AssetPurpose;
  indexPath: number[];
  columnIndex?: number;
  isEmpty: boolean;
  hint?: string;
}

const isAssetBlock = (b: ContentBlock): b is ImageBlock | MediaBlock | CreatorAssetBlock =>
  b.type === 'image' || b.type === 'media' || b.type === 'creator_asset';

function blockIsEmpty(b: ImageBlock | MediaBlock | CreatorAssetBlock): boolean {
  if (b.type === 'image') return !b.url;
  if (b.type === 'media') return !b.url;
  return !b.url && !(b.files && b.files.length > 0) && !b.assetId;
}

function purposeForCreatorAsset(b: CreatorAssetBlock): AssetPurpose {
  switch (b.creatorType) {
    case 'infographic': return 'infographic';
    case 'banner': return 'banner';
    case 'carousel': case 'slider': return 'gallery';
    case 'brand_card': return 'feature';
    default: return 'inline';
  }
}

/**
 * Walk a document and classify every visual asset block, recursing into columns.
 * Purpose is inferred from block type, position (first-before-heading → hero,
 * inside-columns → side/comparison), and hint/alt keywords.
 */
export function inventoryAssetBlocks(blocks: ContentBlock[]): AssetBlockRef[] {
  const out: AssetBlockRef[] = [];
  let seenHeading = false;
  let assetCountTop = 0;

  blocks.forEach((b, i) => {
    if (b.type === 'heading') seenHeading = true;
    if (b.type === 'columns') {
      const cols = b as ColumnsBlock;
      const colImageCount = cols.columns.reduce((n, c) => n + c.blocks.filter((x) => x.type === 'image').length, 0);
      cols.columns.forEach((cell, ci) => {
        cell.blocks.forEach((inner, ii) => {
          if (!isAssetBlock(inner)) return;
          let purpose: AssetPurpose;
          if (inner.type === 'creator_asset') purpose = purposeForCreatorAsset(inner);
          else if (inner.type === 'media') purpose = 'media';
          else purpose = purposeFromKeywords(`${inner.hint || ''} ${inner.alt || ''}`) || (cols.columnCount >= 2 && colImageCount >= 2 ? 'comparison' : 'side');
          out.push({ blockId: inner.id, assetType: inner.type as AssetType, purpose, indexPath: [i, ci, ii], columnIndex: ci, isEmpty: blockIsEmpty(inner), hint: inner.hint });
        });
      });
      return;
    }
    if (!isAssetBlock(b)) return;
    let purpose: AssetPurpose;
    if (b.type === 'creator_asset') purpose = purposeForCreatorAsset(b);
    else if (b.type === 'media') purpose = 'media';
    else {
      const kw = purposeFromKeywords(`${b.hint || ''} ${b.alt || ''}`);
      if (kw) purpose = kw;
      else if (!seenHeading && assetCountTop === 0) purpose = 'hero';
      else purpose = 'inline';
    }
    assetCountTop += 1;
    out.push({ blockId: b.id, assetType: b.type as AssetType, purpose, indexPath: [i], isEmpty: blockIsEmpty(b), hint: b.hint });
  });

  return out;
}

/* ── Prompt synthesis from page context (STEP 3) ───────────────────────── */

function plainText(b: ContentBlock): string {
  if (b.type === 'paragraph') return b.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (b.type === 'heading') return b.text;
  if (b.type === 'summary') return b.body;
  return '';
}

function nearestHeading(blocks: ContentBlock[], topIndex: number): string {
  for (let i = Math.min(topIndex, blocks.length - 1); i >= 0; i--) {
    if (blocks[i]?.type === 'heading') return (blocks[i] as { text: string }).text;
  }
  return '';
}

function nearbyParagraph(blocks: ContentBlock[], topIndex: number): string {
  for (let i = topIndex; i < blocks.length && i < topIndex + 3; i++) {
    const t = plainText(blocks[i]);
    if (t) return t.slice(0, 180);
  }
  for (let i = topIndex - 1; i >= 0 && i > topIndex - 3; i--) {
    const t = plainText(blocks[i]);
    if (t) return t.slice(0, 180);
  }
  return '';
}

function buildPrompt(ref: AssetBlockRef, blocks: ContentBlock[], ctx: RealizationContext): string {
  const topIndex = ref.indexPath[0];
  const parts = [
    ref.hint,
    ctx.documentTitle && `Document: ${ctx.documentTitle}`,
    nearestHeading(blocks, topIndex) && `Section: ${nearestHeading(blocks, topIndex)}`,
    nearbyParagraph(blocks, topIndex) && `Context: ${nearbyParagraph(blocks, topIndex)}`,
    `Purpose: ${ref.purpose} image (${ASPECT_BY_PURPOSE[ref.purpose]})`,
    ctx.brandStyle && `Style: ${ctx.brandStyle}`,
    ctx.templateName && `Template: ${ctx.templateName}`,
  ].filter(Boolean);
  return parts.join('. ');
}

/* ── Slot derivation (STEP 4) ──────────────────────────────────────────── */

function slotIdFor(blockId: string): string { return `slot-${blockId}`; }

export function deriveAssetSlots(blocks: ContentBlock[], ctx: RealizationContext): AssetSlot[] {
  const inv = inventoryAssetBlocks(blocks);
  const byId = indexBlocksById(blocks);
  return inv.map((ref) => {
    const block = byId.get(ref.blockId);
    const aspect = ASPECT_BY_PURPOSE[ref.purpose];
    const existingUrl = block && (block.type === 'image' || block.type === 'media') ? block.url
      : block && block.type === 'creator_asset' ? (block.url || (block.files && block.files[0])) : undefined;
    const caption = block && (block.type === 'image' || block.type === 'creator_asset') ? block.caption : undefined;
    const altText = block && block.type === 'image' ? block.alt : undefined;
    return {
      slotId: slotIdFor(ref.blockId),
      blockId: ref.blockId,
      templateAssetId: ref.blockId,
      assetType: ref.assetType,
      purpose: ref.purpose,
      prompt: buildPrompt(ref, blocks, ctx),
      caption,
      altText,
      provider: existingUrl ? 'url' : undefined,
      aspectRatio: aspect,
      layout: { indexPath: ref.indexPath, columnIndex: ref.columnIndex, align: block?.format?.align, aspectRatio: aspect },
      history: [],
      status: existingUrl ? 'realized' : 'empty',
      source: ctx.contentType ? 'generated' : 'generated',
      url: existingUrl || undefined,
    };
  });
}

/* ── Provider chain + realization (STEP 3) ─────────────────────────────── */

/** Deterministic placeholder realization — pure, no IO. Seed varies by attempt
 *  so a regenerate produces a visibly different image. */
function placeholderRealize(slot: AssetSlot): RealizedAsset {
  const [w, h] = slot.aspectRatio.split(':').map((n) => parseInt(n, 10));
  const width = 1200;
  const height = Math.round((1200 * (h || 9)) / (w || 16));
  const attempt = typeof (slot.generation as { attempt?: number } | undefined)?.attempt === 'number' ? (slot.generation as { attempt: number }).attempt : 0;
  const base = `${slot.purpose}-${slot.blockId}${attempt ? `-r${attempt}` : ''}`;
  const seed = base.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 56) || 'asset';
  return { url: `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`, provider: 'placeholder', generation: { seed, width, height, attempt } };
}

/** Deterministic last-resort provider — guarantees no empty box ever ships. */
export const placeholderProvider: AssetProvider = {
  id: 'placeholder',
  async realize(slot) { return placeholderRealize(slot); },
};

/**
 * SYNCHRONOUS realization — used at the generation→editor seam so the editor
 * opens with zero empty image blocks WITHOUT awaiting network. Reuses the same
 * slot derivation + write-back; only the deterministic placeholder runs here.
 * Richer providers (AI / org / stock) run later via per-slot editor actions.
 */
export function realizeDocumentAssetsSync(blocks: ContentBlock[], ctx: RealizationContext): { blocks: ContentBlock[]; slots: AssetSlot[] } {
  const derived = deriveAssetSlots(blocks, ctx);
  let next = blocks;
  const slots: AssetSlot[] = [];
  for (const slot of derived) {
    let realized = slot;
    if (slot.status !== 'realized' || !slot.url) {
      const r = placeholderRealize(slot);
      realized = { ...slot, url: r.url, provider: r.provider, generation: r.generation, status: 'realized', history: [...slot.history, { provider: r.provider, url: r.url, reason: 'realize', at: ctx.stamp, prompt: slot.prompt }] };
    }
    slots.push(realized);
    next = applySlotToBlocks(next, realized);
  }
  return { blocks: next, slots };
}

/** Build an organization-library provider from a resolver (reuses existing asset infra). */
export function makeOrganizationProvider(resolve: (slot: AssetSlot, ctx: RealizationContext) => Promise<RealizedAsset | null>): AssetProvider {
  return { id: 'organization', realize: (s, c) => resolve(s, c) };
}
export function makeStockProvider(resolve: (slot: AssetSlot, ctx: RealizationContext) => Promise<RealizedAsset | null>): AssetProvider {
  return { id: 'stock', realize: (s, c) => resolve(s, c) };
}
/** AI image provider — wire a real generation service here. Returns null until one exists. */
export function makeAiProvider(generate: (prompt: string, slot: AssetSlot, ctx: RealizationContext) => Promise<RealizedAsset | null>): AssetProvider {
  return { id: 'ai', realize: (s, c) => generate(s.prompt, s, c) };
}

/** Default priority chain (STEP 3): AI → Organization → Stock → Placeholder. */
export function defaultProviderChain(overrides?: Partial<Record<AssetProviderId, AssetProvider>>): AssetProvider[] {
  const chain: AssetProvider[] = [];
  if (overrides?.ai) chain.push(overrides.ai);
  if (overrides?.organization) chain.push(overrides.organization);
  if (overrides?.stock) chain.push(overrides.stock);
  chain.push(overrides?.placeholder || placeholderProvider);
  return chain;
}

/** Realize a single slot through the provider chain. Placeholder guarantees success. */
export async function realizeAssetSlot(slot: AssetSlot, providers: AssetProvider[], ctx: RealizationContext, reason: AssetSlotRevision['reason'] = 'realize'): Promise<AssetSlot> {
  for (const p of providers) {
    let realized: RealizedAsset | null = null;
    try { realized = await p.realize(slot, ctx); } catch { realized = null; }
    if (realized && realized.url) {
      return {
        ...slot,
        url: realized.url,
        provider: realized.provider,
        caption: realized.caption ?? slot.caption,
        altText: realized.altText ?? slot.altText,
        generation: realized.generation ?? slot.generation,
        status: 'realized',
        history: [...slot.history, { provider: realized.provider, url: realized.url, reason, at: ctx.stamp, prompt: slot.prompt }],
      };
    }
  }
  return { ...slot, status: 'failed' };
}

/* ── Write a realized slot back into the document (position-preserving) ── */

export function applySlotToBlocks(blocks: ContentBlock[], slot: AssetSlot): ContentBlock[] {
  return mapBlockById(blocks, slot.blockId, (b) => {
    if (b.type === 'image') return { ...b, url: slot.url || b.url, alt: slot.altText ?? b.alt, caption: slot.caption ?? b.caption };
    if (b.type === 'media') return { ...b, url: slot.url || b.url };
    if (b.type === 'creator_asset') return { ...b, url: slot.url || b.url, caption: slot.caption ?? b.caption };
    return b;
  });
}

/** Derive → realize → write-back, for the whole document. */
export async function realizeDocumentAssets(blocks: ContentBlock[], providers: AssetProvider[], ctx: RealizationContext): Promise<{ blocks: ContentBlock[]; slots: AssetSlot[] }> {
  const derived = deriveAssetSlots(blocks, ctx);
  let next = blocks;
  const slots: AssetSlot[] = [];
  for (const slot of derived) {
    const realized = slot.status === 'realized' ? slot : await realizeAssetSlot(slot, providers, ctx);
    slots.push(realized);
    next = applySlotToBlocks(next, realized);
  }
  return { blocks: next, slots };
}

/* ── Independent slot edits (STEP 5/6/7) — touch ONE slot only ─────────── */

export async function regenerateSlot(slot: AssetSlot, providers: AssetProvider[], ctx: RealizationContext): Promise<AssetSlot> {
  // Force a fresh realization even if already realized; nearby assets are never read.
  // Bump the attempt counter so even a placeholder fallback yields a new image.
  const attempt = (typeof (slot.generation as { attempt?: number } | undefined)?.attempt === 'number' ? (slot.generation as { attempt: number }).attempt : 0) + 1;
  const fresh: AssetSlot = { ...slot, status: 'pending', generation: { ...(slot.generation || {}), attempt } };
  return realizeAssetSlot(fresh, providers, ctx, 'regenerate');
}

function withRevision(slot: AssetSlot, provider: AssetProviderId, url: string, reason: AssetSlotRevision['reason'], stamp?: number, extra?: Partial<AssetSlot>): AssetSlot {
  return { ...slot, url, provider, status: 'realized', ...extra, history: [...slot.history, { provider, url, reason, at: stamp }] };
}

export function applyUploadToSlot(slot: AssetSlot, upload: { url: string; altText?: string; caption?: string }, stamp?: number): AssetSlot {
  return withRevision(slot, 'upload', upload.url, 'upload', stamp, { altText: upload.altText ?? slot.altText, caption: upload.caption ?? slot.caption });
}
export function applyLibraryAssetToSlot(slot: AssetSlot, asset: { url: string; altText?: string; caption?: string }, stamp?: number): AssetSlot {
  return withRevision(slot, 'organization', asset.url, 'library', stamp, { altText: asset.altText ?? slot.altText, caption: asset.caption ?? slot.caption });
}
export function applyUrlToSlot(slot: AssetSlot, url: string, stamp?: number): AssetSlot {
  return withRevision(slot, 'url', url, 'url', stamp);
}
export function setSlotCaption(slot: AssetSlot, caption: string): AssetSlot { return { ...slot, caption }; }
export function setSlotAltText(slot: AssetSlot, altText: string): AssetSlot { return { ...slot, altText }; }
export function removeSlotAsset(slot: AssetSlot, stamp?: number): AssetSlot {
  return { ...slot, url: undefined, provider: undefined, status: 'empty', history: [...slot.history, { provider: slot.provider || 'placeholder', url: '', reason: 'remove', at: stamp }] };
}

/** Undo the most recent slot change by reverting to the prior history url (STEP 10). */
export function revertSlot(slot: AssetSlot, stamp?: number): AssetSlot {
  if (slot.history.length < 2) return slot;
  const prev = slot.history[slot.history.length - 2];
  return { ...slot, url: prev.url || undefined, provider: prev.provider, status: prev.url ? 'realized' : 'empty', history: [...slot.history, { provider: prev.provider, url: prev.url, reason: 'revert', at: stamp }] };
}

/* ── Layout preservation + runtime validation (STEP 2 / 9) ─────────────── */

export interface LayoutReport {
  ok: boolean;
  templateAssetCount: number;
  realizedAssetCount: number;
  missing: string[];      // template asset blockIds absent from the realized doc
  duplicated: string[];   // blockIds appearing more than once
  reordered: boolean;     // asset sequence (by purpose) differs from the template
}

/**
 * Compare the template's asset layout to a generated/realized document. Confirms
 * every visual block exists, none are duplicated, and order is preserved.
 */
export function validateLayoutParity(templateBlocks: ContentBlock[], realizedBlocks: ContentBlock[]): LayoutReport {
  const t = inventoryAssetBlocks(templateBlocks);
  const r = inventoryAssetBlocks(realizedBlocks);
  const rIds = new Set(r.map((x) => x.blockId));
  const counts = new Map<string, number>();
  for (const x of r) counts.set(x.blockId, (counts.get(x.blockId) || 0) + 1);
  const missing = t.filter((x) => !rIds.has(x.blockId)).map((x) => x.blockId);
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const tSeq = t.map((x) => x.purpose).join(',');
  const rSeq = r.filter((x) => t.some((y) => y.blockId === x.blockId)).map((x) => x.purpose).join(',');
  return { ok: missing.length === 0 && duplicated.length === 0 && tSeq === rSeq, templateAssetCount: t.length, realizedAssetCount: r.length, missing, duplicated, reordered: tSeq !== rSeq };
}

/**
 * Ensure the realized/generated document preserves the template's asset layout:
 * any template asset-bearing top-level block absent from the generated doc is
 * re-inserted at its proportional position. Never reorders or duplicates.
 */
export function reconcileTemplateLayout(templateBlocks: ContentBlock[], generatedBlocks: ContentBlock[]): { blocks: ContentBlock[]; reinserted: string[] } {
  const genIds = new Set(collectAllIds(generatedBlocks));
  const reinserted: string[] = [];
  const result = [...generatedBlocks];
  const total = templateBlocks.length || 1;

  templateBlocks.forEach((tb, ti) => {
    const bearsAsset = isAssetBlock(tb) || (tb.type === 'columns' && (tb as ColumnsBlock).columns.some((c) => c.blocks.some(isAssetBlock)));
    if (!bearsAsset) return;
    if (genIds.has(tb.id)) return; // already present somewhere
    const pos = Math.min(result.length, Math.round((ti / total) * result.length));
    result.splice(pos, 0, tb);
    genIds.add(tb.id);
    reinserted.push(tb.id);
  });

  return { blocks: result, reinserted };
}

/* ── Serialization for draft persistence (STEP 10) ─────────────────────── */

export function serializeSlots(slots: AssetSlot[]): string { return JSON.stringify(slots); }
export function deserializeSlots(json: string): AssetSlot[] { try { return JSON.parse(json) as AssetSlot[]; } catch { return []; } }

/* ── Internal block-tree helpers ───────────────────────────────────────── */

function indexBlocksById(blocks: ContentBlock[]): Map<string, ContentBlock> {
  const m = new Map<string, ContentBlock>();
  const walk = (list: ContentBlock[]) => list.forEach((b) => { m.set(b.id, b); if (b.type === 'columns') (b as ColumnsBlock).columns.forEach((c) => walk(c.blocks)); });
  walk(blocks);
  return m;
}

function collectAllIds(blocks: ContentBlock[]): string[] {
  const ids: string[] = [];
  const walk = (list: ContentBlock[]) => list.forEach((b) => { ids.push(b.id); if (b.type === 'columns') (b as ColumnsBlock).columns.forEach((c) => walk(c.blocks)); });
  walk(blocks);
  return ids;
}

/** Immutably replace a block by id anywhere in the tree (incl. column cells). */
function mapBlockById(blocks: ContentBlock[], id: string, fn: (b: ContentBlock) => ContentBlock): ContentBlock[] {
  return blocks.map((b) => {
    if (b.id === id) return fn(b);
    if (b.type === 'columns') {
      const cols = b as ColumnsBlock;
      return { ...cols, columns: cols.columns.map((c) => ({ ...c, blocks: mapBlockById(c.blocks, id, fn) })) };
    }
    return b;
  });
}
