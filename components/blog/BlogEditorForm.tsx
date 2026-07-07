'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, XCircle, Search, Loader2, Eye } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { calculateQualityScore, getPublishBlockers } from '../../lib/blog/blogValidation';
import type { ContentBlock, BlockType } from '../../lib/blog/blockTypes';
import type { BlogFormatType } from '../../lib/blog/blogStructureTemplates';
import type { MediaBlockItem } from './BlogMediaBlock';
import { BlogMasthead, BlogHeroImage, BlogArticleBody, estimateReadMins } from './BlogArticleLayout';
import {
  buildImageQuery,
  searchImages,
  type ImageResult,
} from '../../lib/media/imageService';
import { deriveAssetSlots, applySlotToBlocks, type AssetSlot, type RealizationContext } from '../../lib/content/assetRealization';
import { getRuntimeProviderChain } from '../../lib/content/assetRealizationProviders';
import { realizeEmptyImageSlots } from '../../lib/content/realizeGeneratedDocument';
import { getEmptyImagePolicy } from '../../lib/content/longformEmptyImagePolicy';
import { aiGenerateViaRenderInline, organizationResolveViaCatalog } from '../../lib/content/clientAssetProviders';
import { buildImageAssetActions, type UploadResult } from '../../lib/content/assetSlotEditorActions';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';
import {
  moveBlockUp,
  moveBlockDown,
  deleteBlock,
  duplicateBlock,
  insertBlockAfter,
  syncHeadingAnchors,
} from '../../lib/blog/blockUtils';
import {
  getFormattedBlockClass,
  getFormattedListClass,
} from '../../lib/content/blockFormatting';
import { migrateMarkdownToBlocks } from '../../lib/blog/blockMigration';
import {
  BlockWrapper,
  BlockPicker,
  ParagraphBlockEditor,
  HeadingBlockEditor,
  KeyInsightsBlockEditor,
  CalloutBlockEditor,
  QuoteBlockEditor,
  ImageBlockEditor,
  MediaBlockEditor,
  DividerBlockEditor,
  ListBlockEditor,
  ReferencesBlockEditor,
  InternalLinkBlockEditor,
  SummaryBlockEditor,
  ColumnsBlockEditor,
  CreatorAssetBlockEditor,
  ImageStockSearchPopover,
} from '../content/blocks';
import { useCompanyContext } from '../CompanyContext';
import { isEnrichable, buildBlockContext, enrichBlock } from '../../lib/blog/blockEnrichService';
import type {
  ParagraphBlock,
  HeadingBlock,
  KeyInsightsBlock,
  CalloutBlock,
  QuoteBlock,
  ImageBlock,
  MediaBlock,
  DividerBlock,
  ListBlock,
  ReferencesBlock,
  InternalLinkBlock,
  SummaryBlock,
  ColumnsBlock,
  CreatorAssetBlock,
} from '../../lib/blog/blockTypes';

const CATEGORY_OPTIONS = [
  'Marketing Intelligence',
  'AI-driven Campaign Strategy',
  'Brand Execution Systems',
  'Momentum Modeling',
  'Strategic Automation',
];

// Keyword → category map for auto-inference
const CATEGORY_KEYWORD_MAP: [string[], string][] = [
  [['ai marketing', 'ai-driven', 'artificial intelligence', 'llm', 'generative', 'ai campaign', 'ai strategy', 'ai content'], 'AI-driven Campaign Strategy'],
  [['momentum', 'momentum model', 'growth model', 'traction', 'virality', 'compounding'], 'Momentum Modeling'],
  [['automation', 'workflow', 'automated', 'pipeline', 'systematic', 'playbook', 'system'], 'Strategic Automation'],
  [['brand', 'brand voice', 'brand execution', 'brand identity', 'positioning', 'messaging'], 'Brand Execution Systems'],
  [['intelligence', 'data-driven', 'analytics', 'insight', 'signal', 'performance', 'metrics', 'reporting'], 'Marketing Intelligence'],
  [['strategy', 'campaign', 'demand generation', 'go-to-market', 'gtm', 'marketing strategy'], 'AI-driven Campaign Strategy'],
];

function inferCategory(title: string, tags: string[]): string {
  const signal = [title, ...tags].join(' ').toLowerCase();
  for (const [keywords, category] of CATEGORY_KEYWORD_MAP) {
    if (keywords.some(kw => signal.includes(kw))) return category;
  }
  return '';
}

const MARKETING_KEYWORD_SUGGESTIONS = [
  'marketing intelligence',
  'campaign strategy',
  'content marketing',
  'AI marketing',
  'execution intelligence',
  'momentum modeling',
  'brand execution',
  'strategic automation',
  'thought leadership',
  'conversion optimization',
  'distribution strategy',
  'marketing systems',
];

export type BlogFormState = {
  title: string;
  slug: string;
  excerpt: string;
  content_markdown: string;
  content_blocks: ContentBlock[];
  format_type?: BlogFormatType;
  featured_image_url: string;
  category: string;
  tags: string[];
  media_blocks: MediaBlockItem[];
  seo_meta_title: string;
  seo_meta_description: string;
  status: 'draft' | 'scheduled' | 'published';
  is_featured: boolean;
  published_at: string;
};

const defaultState: BlogFormState = {
  title: '',
  slug: '',
  excerpt: '',
  content_markdown: '',
  content_blocks: [],
  format_type: undefined,
  featured_image_url: '',
  category: '',
  tags: [],
  media_blocks: [],
  seo_meta_title: '',
  seo_meta_description: '',
  status: 'draft',
  is_featured: false,
  published_at: '',
};

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

type Props = {
  initial?: Partial<BlogFormState>;
  onSubmit: (state: BlogFormState) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  isSaving?: boolean;
  /** Called whenever form state changes — use to drive an external quality panel */
  onStateChange?: (state: BlogFormState) => void;
  /** External state patch (e.g., AI improvements) applied into the live form state. */
  externalPatch?: Partial<BlogFormState> | null;
  /** Company ID for AI enrichment and stock image search */
  companyId?: string;
};

// ── Per-block editor dispatcher ───────────────────────────────────────────────

function BlockEditor({
  block,
  onChange,
  companyId,
}: {
  block: ContentBlock;
  onChange: (b: ContentBlock) => void;
  companyId?: string;
}) {
  switch (block.type) {
    case 'paragraph':
      return <ParagraphBlockEditor block={block as ParagraphBlock} onChange={(b) => onChange(b)} />;
    case 'heading':
      return <HeadingBlockEditor block={block as HeadingBlock} onChange={(b) => onChange(b)} />;
    case 'key_insights':
      return <KeyInsightsBlockEditor block={block as KeyInsightsBlock} onChange={(b) => onChange(b)} />;
    case 'callout':
      return <CalloutBlockEditor block={block as CalloutBlock} onChange={(b) => onChange(b)} />;
    case 'quote':
      return <QuoteBlockEditor block={block as QuoteBlock} onChange={(b) => onChange(b)} />;
    case 'image':
      return <ImageBlockEditor block={block as ImageBlock} onChange={(b) => onChange(b)} />;
    case 'media':
      return <MediaBlockEditor block={block as MediaBlock} onChange={(b) => onChange(b)} />;
    case 'divider':
      return <DividerBlockEditor block={block as DividerBlock} onChange={(b) => onChange(b)} />;
    case 'list':
      return <ListBlockEditor block={block as ListBlock} onChange={(b) => onChange(b)} />;
    case 'references':
      return <ReferencesBlockEditor block={block as ReferencesBlock} onChange={(b) => onChange(b)} />;
    case 'internal_link':
      return <InternalLinkBlockEditor block={block as InternalLinkBlock} onChange={(b) => onChange(b)} />;
    case 'summary':
      return <SummaryBlockEditor block={block as SummaryBlock} onChange={(b) => onChange(b)} />;
    case 'columns':
      return (
        <ColumnsBlockEditor
          block={block as ColumnsBlock}
          onChange={(b) => onChange(b)}
          renderBlock={(innerBlock, innerOnChange) => (
            <BlockEditor block={innerBlock} onChange={innerOnChange} companyId={companyId} />
          )}
        />
      );
    case 'creator_asset':
      return <CreatorAssetBlockEditor block={block as CreatorAssetBlock} companyId={companyId} onChange={(b) => onChange(b)} />;
  }
}


// ── Main form ─────────────────────────────────────────────────────────────────

export function BlogEditorForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  isSaving = false,
  onStateChange,
  externalPatch,
  companyId,
}: Props) {
  const { selectedCompanyId } = useCompanyContext();
  const effectiveCompanyId = companyId || selectedCompanyId || undefined;
  const [state, setState] = useState<BlogFormState>({
    ...defaultState,
    ...initial,
  });
  const [tagInput, setTagInput] = useState('');
  const [publishGate, setPublishGate] = useState<{ blockers: string[] } | null>(null);
  const [imgSearchOpen, setImgSearchOpen] = useState(false);
  const [imgSearchQuery, setImgSearchQuery] = useState('');
  const [imgSearchLoading, setImgSearchLoading] = useState(false);
  const [imgSearchResults, setImgSearchResults] = useState<ImageResult[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [catDropOpen, setCatDropOpen] = useState(false);
  const [featImgErr, setFeatImgErr] = useState(false);
  const migrated = useRef(false);
  const catRef = useRef<HTMLDivElement>(null);

  // DnD sensors — pointer for mouse/touch, keyboard for accessibility
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Lazy migration: convert legacy markdown→blocks on first mount
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    if (state.content_blocks.length === 0 && state.content_markdown) {
      const blocks = migrateMarkdownToBlocks(state.content_markdown, state.media_blocks);
      setState((prev) => ({ ...prev, content_blocks: blocks }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((updates: Partial<BlogFormState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Auto-infer category — uses setState functional form so it ALWAYS reads
  // the latest state, not a stale closure capture of state.category.
  useEffect(() => {
    setState((prev) => {
      if (prev.category) return prev; // don't override manual selection
      const inferred = inferCategory(prev.title, prev.tags);
      return inferred ? { ...prev, category: inferred } : prev;
    });
  }, [state.title, state.tags]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close category dropdown on outside click
  useEffect(() => {
    if (!catDropOpen) return;
    const close = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) setCatDropOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [catDropOpen]);

  // Notify parent of state changes for external quality panel
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  // Apply externally provided AI patches into editor state.
  useEffect(() => {
    if (!externalPatch) return;
    setState((prev) => ({ ...prev, ...externalPatch }));
  }, [externalPatch]);

  const handleTitleChange = (title: string) => {
    update({ title });
    if (!initial?.slug || state.slug === slugFromTitle(state.title)) {
      update({ slug: slugFromTitle(title) });
    }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !state.tags.includes(t)) {
      update({ tags: [...state.tags, t] });
      setTagInput('');
    }
  };

  const removeTag = (index: number) => {
    update({ tags: state.tags.filter((_, i) => i !== index) });
  };

  // ── Block operations ────────────────────────────────────────────────────────

  const updateBlock = (index: number, block: ContentBlock) => {
    const next = [...state.content_blocks];
    next[index] = block;
    update({ content_blocks: next });
  };

  const handleMoveUp = (index: number) => {
    update({ content_blocks: moveBlockUp(state.content_blocks, index) });
  };

  const handleMoveDown = (index: number) => {
    update({ content_blocks: moveBlockDown(state.content_blocks, index) });
  };

  const handleDelete = (index: number) => {
    update({ content_blocks: deleteBlock(state.content_blocks, index) });
  };

  const handleDuplicate = (index: number) => {
    update({ content_blocks: duplicateBlock(state.content_blocks, index) });
  };

  const handleAddBlock = (afterIndex: number, type: BlockType) => {
    update({ content_blocks: insertBlockAfter(state.content_blocks, afterIndex, type) });
  };

  // ── Stock image search + AI enrich state ──────────────────────────────────

  const [stockSearchBlockIdx, setStockSearchBlockIdx] = useState<number | null>(null);
  const [enrichLoadingBlockId, setEnrichLoadingBlockId] = useState<string | null>(null);

  /** Find the nearest heading above a given block index (for image search context). */
  const findNearestHeading = (blocks: ContentBlock[], idx: number): string => {
    for (let i = idx - 1; i >= 0; i--) {
      if (blocks[i].type === 'heading') return (blocks[i] as HeadingBlock).text;
    }
    return '';
  };

  const handleStockImageSelect = (idx: number, img: ImageResult) => {
    const block = state.content_blocks[idx] as ImageBlock;
    updateBlock(idx, {
      ...block,
      url: img.full,
      alt: img.alt || block.alt,
      attribution: `Photo by ${img.author} on ${img.source.charAt(0).toUpperCase() + img.source.slice(1)}`,
      attributionUrl: img.attribution,
    });
    setStockSearchBlockIdx(null);
  };

  // ── Asset-slot actions (CREATOR-038/039) — per-image AI/upload/import/replace ───
  // Production provider chain: AI (render-inline, flag-gated) → Organization
  // (Creator Asset Catalog) → Stock (governed, de-duped per doc) → Placeholder.
  const assetUsedUrls = useRef(new Set<string>()).current;
  const realizationProviders = useRef(getRuntimeProviderChain({
    aiGenerate: aiGenerateViaRenderInline,
    organizationResolve: organizationResolveViaCatalog,
    organizationId: effectiveCompanyId,
    usedUrls: assetUsedUrls,
  })).current;
  const slotCtx = useCallback((): RealizationContext => ({ contentType: String(state.format_type || 'long-form'), documentTitle: state.title }), [state.format_type, state.title]);
  // Seed asset slots ONCE from the realized prefill (not lazy) so each image
  // already carries provider / prompt / caption / alt / history / status.
  const [assetSlots, setAssetSlots] = useState<Record<string, AssetSlot>>(() =>
    Object.fromEntries(deriveAssetSlots(state.content_blocks, { contentType: String(state.format_type || 'long-form'), documentTitle: state.title }).map((s) => [s.blockId, s])),
  );
  const slotForImage = (block: ImageBlock): AssetSlot =>
    assetSlots[block.id]
    || deriveAssetSlots(state.content_blocks, slotCtx()).find((s) => s.blockId === block.id)
    || deriveAssetSlots([block], slotCtx())[0];
  const applyImageSlot = (i: number, b: ImageBlock, slot: AssetSlot) => {
    updateBlock(i, b);
    setAssetSlots((prev) => ({ ...prev, [slot.blockId]: slot }));
  };
  const pickImageUpload = (): Promise<UploadResult | null> => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        const { data: { user } } = await getSupabaseBrowser().auth.getUser();
        if (!user?.id) { resolve(null); return; }
        const fd = new FormData();
        fd.append('file', file);
        fd.append('user_id', user.id);
        if (effectiveCompanyId) fd.append('campaign_id', effectiveCompanyId);
        fd.append('platform', 'blog');
        const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
        const json = await res.json().catch(() => null);
        const url = json?.data?.file_url || json?.data?.url;
        resolve(url ? { url, altText: file.name.replace(/\.[^.]+$/, '') } : null);
      } catch { resolve(null); }
    };
    input.click();
  });
  const buildImageActions = (i: number, block: ImageBlock) => buildImageAssetActions({
    block,
    slot: slotForImage(block),
    providers: realizationProviders,
    ctx: slotCtx(),
    apply: (b, s) => applyImageSlot(i, b, s),
    pickUpload: pickImageUpload,
    pickUrl: () => { const u = typeof window !== 'undefined' ? window.prompt('Paste image URL') : null; return u && u.trim() ? u.trim() : null; },
    pickOrganizationAsset: async () => { const r = await organizationResolveViaCatalog(slotForImage(block), slotCtx()); return r?.url ? { url: r.url, altText: r.altText } : null; },
    openMediaLibrary: () => setStockSearchBlockIdx(stockSearchBlockIdx === i ? null : i),
    stamp: () => Date.now(),
  });

  // STEP 2 — 'stock' policy: fill freshly-generated empty image slots via the
  // stock provider (placeholder only if stock fails) once, on open. Existing
  // drafts (already filled) have no empties → no-op. AI/org are NOT auto-run
  // (no credit spend); the user invokes those per slot.
  useEffect(() => {
    if (getEmptyImagePolicy() !== 'stock') return;
    let cancelled = false;
    void (async () => {
      const chain = getRuntimeProviderChain({ organizationId: effectiveCompanyId, usedUrls: assetUsedUrls });
      const res = await realizeEmptyImageSlots(state.content_blocks, chain, slotCtx());
      if (cancelled || res.slots.length === 0) return;
      setState((prev) => {
        let cb = prev.content_blocks;
        for (const s of res.slots) cb = applySlotToBlocks(cb, s);
        return { ...prev, content_blocks: cb };
      });
      setAssetSlots((prev) => { const m = { ...prev }; for (const s of res.slots) m[s.blockId] = s; return m; });
    })();
    return () => { cancelled = true; };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnrichBlock = async (idx: number) => {
    if (!effectiveCompanyId) return;
    const block = state.content_blocks[idx];
    if (!isEnrichable(block.type)) return;

    setEnrichLoadingBlockId(block.id);
    try {
      const { block: targetBlock, contextBlocks } = buildBlockContext(state.content_blocks, idx);
      const result = await enrichBlock({
        companyId: effectiveCompanyId,
        block: targetBlock,
        contextBlocks,
        blogMeta: {
          title: state.title,
          excerpt: state.excerpt,
          tags: state.tags,
        },
      });
      updateBlock(idx, result.enriched_block);
    } catch (err) {
      console.error('[enrich-block] Failed:', err);
    } finally {
      setEnrichLoadingBlockId(null);
    }
  };

  /** Determine AI action for a block: stock search for images, enrich for text blocks. */
  const getAiAction = (block: ContentBlock, idx: number) => {
    if (block.type === 'image') {
      return {
        onAiAction: () => setStockSearchBlockIdx(stockSearchBlockIdx === idx ? null : idx),
        aiActionLabel: 'Stock Images',
        aiActionLoading: false,
      };
    }
    if (isEnrichable(block.type) && effectiveCompanyId) {
      return {
        onAiAction: () => handleEnrichBlock(idx),
        aiActionLabel: 'Enrich with AI',
        aiActionLoading: enrichLoadingBlockId === block.id,
      };
    }
    return {};
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveBlockId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveBlockId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = state.content_blocks.findIndex((b) => b.id === active.id);
    const newIndex = state.content_blocks.findIndex((b) => b.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    update({ content_blocks: arrayMove(state.content_blocks, oldIndex, newIndex) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Enforce quality gate when publishing
    if (state.status === 'published') {
      const score = calculateQualityScore(state.content_blocks, {
        title:                state.title,
        excerpt:              state.excerpt,
        seo_meta_title:       state.seo_meta_title,
        seo_meta_description: state.seo_meta_description,
        tags:                 state.tags,
      });
      const blockers = getPublishBlockers(score);
      if (blockers.length > 0) {
        setPublishGate({ blockers: blockers.map((b) => b.message) });
        return;
      }
    }

    const synced = syncHeadingAnchors(state.content_blocks);
    onSubmit({ ...state, content_blocks: synced });
  };

  const runImgSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setImgSearchLoading(true);
    const imgs = await searchImages({ query: q, perPage: 9 });
    setImgSearchResults(imgs);
    setImgSearchLoading(false);
  }, []);

  const openImageSearch = useCallback(() => {
    const q = buildImageQuery({
      title: state.title,
      excerpt: state.excerpt,
      tags: state.tags,
    });
    setImgSearchOpen(true);
    setImgSearchQuery(q);
    setImgSearchResults([]);
    if (q) void runImgSearch(q);
  }, [state.title, state.excerpt, state.tags, runImgSearch]);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── Metadata ────────────────────────────────────────────────────────── */}
      <div id="blog-field-title">
        <label className="block text-sm font-medium text-gray-700">Title *</label>
        <input
          id="blog-input-title"
          type="text"
          required
          value={state.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          placeholder="Post title"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Slug (URL)</label>
        <input
          type="text"
          value={state.slug}
          onChange={(e) => update({ slug: slugFromTitle(e.target.value) })}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
          placeholder="url-slug"
        />
        {state.slug && (
          <p className="mt-1 text-xs text-gray-400 font-mono truncate">/blog/{state.slug}</p>
        )}
      </div>

      <div id="blog-field-excerpt">
        <label className="block text-sm font-medium text-gray-700">Excerpt</label>
        <textarea
          id="blog-input-excerpt"
          value={state.excerpt}
          onChange={(e) => update({ excerpt: e.target.value })}
          rows={2}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          placeholder="Short summary for listings and SEO"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Featured image URL</label>
        <input
          type="url"
          value={state.featured_image_url}
          onChange={(e) => update({ featured_image_url: e.target.value })}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          placeholder="https://..."
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => (imgSearchOpen ? setImgSearchOpen(false) : openImageSearch())}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#0B5ED7]/25 bg-[#0B5ED7]/5 px-2.5 py-1.5 text-xs font-semibold text-[#0B5ED7] hover:bg-[#0B5ED7]/10"
          >
            <Search className="h-3.5 w-3.5" />
            {imgSearchOpen ? 'Hide stock image search' : 'Search stock images'}
          </button>
          {state.featured_image_url && (
            <button
              type="button"
              onClick={() => update({ featured_image_url: '' })}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear URL
            </button>
          )}
        </div>

        {imgSearchOpen && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 flex gap-1.5">
              <input
                type="text"
                value={imgSearchQuery}
                onChange={(e) => setImgSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runImgSearch(imgSearchQuery);
                  }
                }}
                placeholder="Search by keyword"
                className="flex-1 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => void runImgSearch(imgSearchQuery)}
                disabled={imgSearchLoading || !imgSearchQuery.trim()}
                className="inline-flex items-center justify-center rounded bg-[#0B5ED7] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {imgSearchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Go'}
              </button>
            </div>

            {imgSearchLoading && (
              <p className="py-2 text-center text-xs text-gray-500">Searching images...</p>
            )}

            {!imgSearchLoading && imgSearchResults.length === 0 && (
              <p className="py-2 text-center text-xs text-gray-500">No images found. Try different keywords.</p>
            )}

            {!imgSearchLoading && imgSearchResults.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {imgSearchResults.map((img) => (
                  <button
                    key={`${img.source}-${img.id}`}
                    type="button"
                    onClick={() => {
                      update({ featured_image_url: img.full });
                      setImgSearchOpen(false);
                    }}
                    className={`group overflow-hidden rounded border bg-white text-left ${state.featured_image_url === img.full ? 'ring-2 ring-[#0B5ED7]' : 'hover:ring-2 hover:ring-gray-300'}`}
                    title={`${img.source} - ${img.author}`}
                  >
                    <img src={img.thumb} alt={img.alt || 'stock image'} className="h-20 w-full object-cover" />
                    <div className="truncate px-1.5 py-1 text-[10px] text-gray-500">{img.source}</div>
                  </button>
                ))}
              </div>
            )}

            {imgSearchResults.length > 0 && (
              <p className="mt-2 text-[10px] text-gray-400">Images from Unsplash, Pexels, and Pixabay via integrated APIs.</p>
            )}
          </div>
        )}
      </div>

      {/* Category — creatable combobox: pick a preset OR type a custom value */}
      <div ref={catRef} className="relative">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700">Category</label>
          <div className="flex items-center gap-2">
            {state.category && !CATEGORY_OPTIONS.includes(state.category) && (
              <span className="text-[11px] text-purple-600 font-medium">custom</span>
            )}
            {state.category && CATEGORY_OPTIONS.includes(state.category) && (
              <span className="text-[11px] text-indigo-600 font-medium">auto-detected</span>
            )}
            {state.category && (
              <button
                type="button"
                onClick={() => update({ category: '' })}
                className="text-gray-400 hover:text-gray-600"
                title="Clear category (re-run auto-detect)"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <input
          type="text"
          value={state.category}
          onChange={(e) => { update({ category: e.target.value }); setCatDropOpen(true); }}
          onFocus={() => setCatDropOpen(true)}
          placeholder="Select or type a new category…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        {catDropOpen && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            {CATEGORY_OPTIONS
              .filter((c) => !state.category || c.toLowerCase().includes(state.category.toLowerCase()))
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { update({ category: c }); setCatDropOpen(false); }}
                  className={`block w-full text-left px-4 py-2 text-sm transition-colors hover:bg-indigo-50
                    ${state.category === c ? 'font-semibold text-indigo-700 bg-indigo-50' : 'text-gray-700'}`}
                >
                  {c}
                </button>
              ))}
            {state.category.trim() && !CATEGORY_OPTIONS.includes(state.category) && (
              <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
                Custom: <span className="font-semibold text-gray-700">{state.category}</span> — press Tab or click outside to confirm
              </div>
            )}
            {!state.category.trim() && (
              <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
                Or type a new topic to create a custom category
              </div>
            )}
          </div>
        )}
      </div>

      <div id="blog-field-tags">
        <label className="block text-sm font-medium text-gray-700">Keywords / Tags</label>
        <p className="mt-0.5 text-xs text-gray-500">
          Marketing content keywords for discoverability and SEO.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {state.tags.map((t, i) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm"
            >
              {t}
              <button type="button" onClick={() => removeTag(i)} className="text-gray-500 hover:text-red-600">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            className="min-w-[8rem] rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder="e.g. campaign strategy"
          />
          <button type="button" onClick={addTag} className="text-sm font-medium text-[#0B5ED7] hover:underline">
            Add
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {MARKETING_KEYWORD_SUGGESTIONS.filter((k) => !state.tags.includes(k)).map((keyword) => (
            <button
              key={keyword}
              type="button"
              onClick={() => {
                if (!state.tags.includes(keyword)) update({ tags: [...state.tags, keyword] });
              }}
              className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:border-[#0B5ED7] hover:text-[#0B5ED7]"
            >
              + {keyword}
            </button>
          ))}
        </div>
      </div>

      {/* ── Block editor ────────────────────────────────────────────────────── */}
      <div id="blog-section-content">
        <label className="block text-sm font-medium text-gray-700 mb-3">Content</label>

        {/* First "Add block" picker when list is empty */}
        {state.content_blocks.length === 0 && (
          <BlockPicker onSelect={(type) => handleAddBlock(-1, type)} />
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={state.content_blocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {state.content_blocks.map((block, i) => (
                <BlockWrapper
                  key={block.id}
                  block={block}
                  index={i}
                  total={state.content_blocks.length}
                  onMoveUp={() => handleMoveUp(i)}
                  onMoveDown={() => handleMoveDown(i)}
                  onDelete={() => handleDelete(i)}
                  onDuplicate={() => handleDuplicate(i)}
                  {...getAiAction(block, i)}
                >
                  {block.type === 'image' ? (
                    <>
                      <ImageBlockEditor
                        block={block as ImageBlock}
                        onChange={(b) => updateBlock(i, b)}
                        onSearchStock={() => setStockSearchBlockIdx(stockSearchBlockIdx === i ? null : i)}
                        assetActions={buildImageActions(i, block as ImageBlock)}
                      />
                      {stockSearchBlockIdx === i && (
                        <div className="mt-3">
                          <ImageStockSearchPopover
                            blogTitle={state.title}
                            blogExcerpt={state.excerpt}
                            blogTags={state.tags}
                            nearestHeading={findNearestHeading(state.content_blocks, i)}
                            onSelect={(img) => handleStockImageSelect(i, img)}
                            onClose={() => setStockSearchBlockIdx(null)}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <BlockEditor block={block} onChange={(b) => updateBlock(i, b)} companyId={effectiveCompanyId} />
                  )}
                </BlockWrapper>
              ))}
            </div>

            {/* Single Add Block control at the end of the list.
                Previously this rendered between EVERY block which
                stretched the editor visually and made the page feel
                like a wall of formatting affordances. One picker at
                the end + drag-to-reorder + per-block hover toolbar
                covers the same operations without the clutter. */}
            {state.content_blocks.length > 0 && (
              <div className="mt-4 flex justify-center">
                <BlockPicker onSelect={(type) => handleAddBlock(state.content_blocks.length - 1, type)} />
              </div>
            )}
          </SortableContext>

          {/* Ghost block shown under the pointer while dragging */}
          <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
            {activeBlockId ? (() => {
              const dragged = state.content_blocks.find((b) => b.id === activeBlockId);
              if (!dragged) return null;
              const idx = state.content_blocks.findIndex((b) => b.id === activeBlockId);
              return (
                <div className="rounded-xl border-2 border-indigo-400 bg-white shadow-2xl opacity-95 pointer-events-none">
                  <BlockWrapper
                    block={dragged}
                    index={idx}
                    total={state.content_blocks.length}
                    onMoveUp={() => {}}
                    onMoveDown={() => {}}
                    onDelete={() => {}}
                    onDuplicate={() => {}}
                  >
                    <BlockEditor block={dragged} onChange={() => {}} companyId={effectiveCompanyId} />
                  </BlockWrapper>
                </div>
              );
            })() : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ── SEO ─────────────────────────────────────────────────────────────── */}

      <div id="blog-section-seo" className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">SEO meta title</label>
          <input
            id="blog-input-seo-title"
            type="text"
            value={state.seo_meta_title}
            onChange={(e) => update({ seo_meta_title: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            placeholder="Defaults to post title"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">SEO meta description</label>
          <input
            id="blog-input-seo-description"
            type="text"
            value={state.seo_meta_description}
            onChange={(e) => update({ seo_meta_description: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            placeholder="Short description for search"
          />
        </div>
      </div>

      {/* ── Publishing ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">Status</label>
          <select
            value={state.status}
            onChange={(e) => update({ status: e.target.value as BlogFormState['status'] })}
            className="mt-1 rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="published">Publish now</option>
          </select>
        </div>
        {state.status === 'scheduled' && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Publish at (ISO)</label>
            <input
              type="datetime-local"
              value={state.published_at ? state.published_at.slice(0, 16) : ''}
              onChange={(e) =>
                update({ published_at: e.target.value ? new Date(e.target.value).toISOString() : '' })
              }
              className="mt-1 rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
        )}
        <div className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            id="featured"
            checked={state.is_featured}
            onChange={(e) => update({ is_featured: e.target.checked })}
            className="rounded border-gray-300"
          />
          <label htmlFor="featured" className="text-sm font-medium text-gray-700">
            Feature on blog listing
          </label>
        </div>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-3 border-t pt-6 flex-wrap">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-lg bg-[#0B5ED7] px-4 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2.5 font-medium text-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { setPreviewOpen(true); setFeatImgErr(false); }}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-50"
        >
          <Eye className="h-4 w-4" />
          Preview
        </button>
        {state.status === 'published' && (
          <p className="ml-auto self-center text-xs text-gray-400">
            Quality check runs on publish
          </p>
        )}
      </div>

      {/* ── Preview modal ─────────────────────────────────────────────────── */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Preview — projected post</p>
              <p className="text-sm text-gray-700 font-medium truncate max-w-xl">{state.title || 'Untitled'}</p>
            </div>
            <div className="flex items-center gap-3">
              {state.category && (
                <span className="rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700">
                  {state.category}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                ✕ Close Preview
              </button>
            </div>
          </div>

          {/* Body — the SAME publish-ready shell used by the template picker and the
              published page, so what you finalize here is exactly what ships. */}
          <div className="mx-auto w-full max-w-3xl px-6 py-10">
            <BlogMasthead
              meta={{
                kicker: state.category || null,
                title: state.title || 'Untitled',
                subtitle: state.excerpt || null,
                readMins: estimateReadMins(state.content_blocks),
              }}
              templateName={null}
            />

            {/* Tags */}
            {state.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 -mt-4 mb-8">
                {state.tags.map(t => (
                  <span key={t} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">{t}</span>
                ))}
              </div>
            )}

            {/* Hero image (swappable while finalizing) */}
            <BlogHeroImage src={state.featured_image_url || null} />

            {/* Content blocks — canonical BlockRenderer, not a preview-only renderer */}
            <BlogArticleBody blocks={state.content_blocks} templateName={null} />

            {/* SEO preview */}
            {(state.seo_meta_title || state.seo_meta_description) && (
              <div className="mt-12 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">SEO Preview</p>
                <p className="text-blue-700 text-sm font-medium">{state.seo_meta_title || state.title}</p>
                <p className="text-green-700 text-xs">yoursite.com/blog/{state.slug || 'post-slug'}</p>
                <p className="text-gray-600 text-xs mt-1">{state.seo_meta_description}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Publish gate modal ───────────────────────────────────────────────── */}
      {publishGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
              <XCircle className="h-5 w-5 shrink-0 text-red-500" />
              <h3 className="text-base font-bold text-gray-900">Cannot publish — fix these issues first</h3>
              <button
                type="button"
                onClick={() => setPublishGate(null)}
                className="ml-auto text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="px-6 py-4 space-y-2">
              {publishGate.blockers.map((msg, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                  {msg}
                </li>
              ))}
            </ul>
            <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
              <button
                type="button"
                onClick={() => setPublishGate(null)}
                className="rounded-lg bg-[#0B5ED7] px-4 py-2 text-sm font-semibold text-white"
              >
                Fix issues
              </button>
              <button
                type="button"
                onClick={() => {
                  setPublishGate(null);
                  update({ status: 'draft' });
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
              >
                Save as draft instead
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
