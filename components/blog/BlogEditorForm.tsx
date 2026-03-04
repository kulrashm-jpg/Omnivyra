'use client';

import React, { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Plus, X } from 'lucide-react';
import type { MediaBlockItem } from './BlogMediaBlock';

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

const MEDIA_TYPES: { value: MediaBlockItem['type']; label: string }[] = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'spotify_track', label: 'Spotify Track' },
  { value: 'spotify_podcast', label: 'Spotify Podcast' },
  { value: 'external_link', label: 'External Link' },
];

export type BlogFormState = {
  title: string;
  slug: string;
  excerpt: string;
  content_markdown: string;
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
};

export function BlogEditorForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  isSaving = false,
}: Props) {
  const [state, setState] = useState<BlogFormState>({
    ...defaultState,
    ...initial,
  });
  const [tagInput, setTagInput] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [newMediaType, setNewMediaType] = useState<MediaBlockItem['type']>('youtube');
  const [newMediaUrl, setNewMediaUrl] = useState('');

  const update = useCallback((updates: Partial<BlogFormState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

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

  const addMediaBlock = () => {
    const url = newMediaUrl.trim();
    if (!url) return;
    update({ media_blocks: [...state.media_blocks, { type: newMediaType, url }] });
    setNewMediaUrl('');
  };

  const removeMediaBlock = (index: number) => {
    update({ media_blocks: state.media_blocks.filter((_, i) => i !== index) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(state);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
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
          Marketing content keywords for discoverability and SEO. Add your own or pick suggestions below.
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
            placeholder="e.g. marketing content, campaign strategy"
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

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">Content (Markdown)</label>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="text-sm text-[#0B5ED7] hover:underline"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {showPreview ? (
          <div className="mt-1 min-h-[200px] rounded-lg border border-gray-300 bg-gray-50 p-4 prose prose-sm max-w-none">
            <ReactMarkdown>{state.content_markdown || '*No content*'}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={state.content_markdown}
            onChange={(e) => update({ content_markdown: e.target.value })}
            rows={14}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
            placeholder="Write in Markdown..."
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Media blocks</label>
        <div className="mt-2 space-y-2">
          {state.media_blocks.map((block, i) => (
            <div key={i} className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <span className="font-medium text-gray-600">{block.type}</span>
              <span className="truncate text-gray-500">{block.url}</span>
              <button type="button" onClick={() => removeMediaBlock(i)} className="ml-auto text-red-600 hover:underline">
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <select
              value={newMediaType}
              onChange={(e) => setNewMediaType(e.target.value as MediaBlockItem['type'])}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              {MEDIA_TYPES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input
              type="url"
              value={newMediaUrl}
              onChange={(e) => setNewMediaUrl(e.target.value)}
              placeholder="URL"
              className="w-72 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={addMediaBlock}
              className="inline-flex items-center gap-1 rounded bg-gray-200 px-3 py-1.5 text-sm hover:bg-gray-300"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>
      </div>

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
              onChange={(e) => update({ published_at: e.target.value ? new Date(e.target.value).toISOString() : '' })}
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
          <label htmlFor="featured" className="text-sm font-medium text-gray-700">Feature on blog listing</label>
        </div>
      </div>

      <div className="flex gap-3 border-t pt-6">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-lg bg-[#0B5ED7] px-4 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2.5 font-medium text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
