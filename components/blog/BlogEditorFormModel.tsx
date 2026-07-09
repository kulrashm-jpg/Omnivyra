/** Part 1/2 of BlogEditorForm.tsx — verbatim split (barrel preserved; importers unchanged). */
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


export const CATEGORY_OPTIONS = [
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

export function inferCategory(title: string, tags: string[]): string {
  const signal = [title, ...tags].join(' ').toLowerCase();
  for (const [keywords, category] of CATEGORY_KEYWORD_MAP) {
    if (keywords.some(kw => signal.includes(kw))) return category;
  }
  return '';
}

export const MARKETING_KEYWORD_SUGGESTIONS = [
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

export const defaultState: BlogFormState = {
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

export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export type Props = {
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

export function BlockEditor({
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

