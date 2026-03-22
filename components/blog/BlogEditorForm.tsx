'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, XCircle } from 'lucide-react';
import { calculateQualityScore, getPublishBlockers } from '../../lib/blog/blogValidation';
import type { ContentBlock, BlockType } from '../../lib/blog/blockTypes';
import type { MediaBlockItem } from './BlogMediaBlock';
import {
  moveBlockUp,
  moveBlockDown,
  deleteBlock,
  duplicateBlock,
  insertBlockAfter,
  syncHeadingAnchors,
} from '../../lib/blog/blockUtils';
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
} from './blocks';
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
} from '../../lib/blog/blockTypes';

const CATEGORY_OPTIONS = [
  'Marketing Intelligence',
  'AI-driven Campaign Strategy',
  'Brand Execution Systems',
  'Momentum Modeling',
  'Strategic Automation',
];

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
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

type Props = {
  initial?: Partial<BlogFormState>;
  onSubmit: (state: BlogFormState) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  isSaving?: boolean;
  /** Called whenever form state changes — use to drive an external quality panel */
  onStateChange?: (state: BlogFormState) => void;
};

// ── Per-block editor dispatcher ───────────────────────────────────────────────

function BlockEditor({
  block,
  onChange,
}: {
  block: ContentBlock;
  onChange: (b: ContentBlock) => void;
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
}: Props) {
  const [state, setState] = useState<BlogFormState>({
    ...defaultState,
    ...initial,
  });
  const [tagInput, setTagInput] = useState('');
  const [publishGate, setPublishGate] = useState<{ blockers: string[] } | null>(null);
  const migrated = useRef(false);

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

  // Notify parent of state changes for external quality panel
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

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

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── Metadata ────────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Title *</label>
        <input
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
          onChange={(e) => update({ slug: e.target.value })}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
          placeholder="url-slug"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Excerpt</label>
        <textarea
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
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Category</label>
        <select
          value={state.category}
          onChange={(e) => update({ category: e.target.value })}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">Select</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
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
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">Content</label>

        {/* First "Add block" picker when list is empty */}
        {state.content_blocks.length === 0 && (
          <BlockPicker onSelect={(type) => handleAddBlock(-1, type)} />
        )}

        <div className="space-y-3">
          {state.content_blocks.map((block, i) => (
            <React.Fragment key={block.id}>
              <BlockWrapper
                block={block}
                index={i}
                total={state.content_blocks.length}
                onMoveUp={() => handleMoveUp(i)}
                onMoveDown={() => handleMoveDown(i)}
                onDelete={() => handleDelete(i)}
                onDuplicate={() => handleDuplicate(i)}
              >
                <BlockEditor block={block} onChange={(b) => updateBlock(i, b)} />
              </BlockWrapper>
              {/* "Add block" between / after each block */}
              <BlockPicker onSelect={(type) => handleAddBlock(i, type)} />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── SEO ─────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">SEO meta title</label>
          <input
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
      <div className="flex gap-3 border-t pt-6">
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
        {state.status === 'published' && (
          <p className="ml-auto self-center text-xs text-gray-400">
            Quality check runs on publish
          </p>
        )}
      </div>

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
