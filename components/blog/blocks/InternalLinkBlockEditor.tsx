'use client';

import React, { useState } from 'react';
import type { InternalLinkBlock } from '../../../lib/blog/blockTypes';
import { Search, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

type Props = {
  block: InternalLinkBlock;
  onChange: (block: InternalLinkBlock) => void;
};

export function InternalLinkBlockEditor({ block, onChange }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'found' | 'not_found'>('idle');

  const resolveSlug = async (slug: string) => {
    if (!slug.trim()) { setStatus('idle'); return; }
    setStatus('loading');
    try {
      const res = await fetch(`/api/blog/${encodeURIComponent(slug.trim())}`);
      if (!res.ok) { setStatus('not_found'); return; }
      const data = await res.json();
      onChange({
        ...block,
        slug: slug.trim(),
        title: data.title ?? '',
        excerpt: data.excerpt ?? '',
      });
      setStatus('found');
    } catch {
      setStatus('not_found');
    }
  };

  return (
    <div className="space-y-3">
      {/* Slug input */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Article slug *</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={block.slug}
            onChange={(e) => {
              onChange({ ...block, slug: e.target.value, title: '', excerpt: '' });
              setStatus('idle');
            }}
            onBlur={(e) => resolveSlug(e.target.value)}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] font-mono focus:border-[#0A66C2] focus:outline-none"
            placeholder="e.g. why-ai-matters-in-2026"
          />
          <button
            type="button"
            onClick={() => resolveSlug(block.slug)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-gray-500 hover:bg-gray-50 transition-colors"
            title="Resolve slug"
          >
            {status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Resolution status */}
      {status === 'not_found' && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Article not found. Check the slug and try again.
        </div>
      )}

      {/* Resolved preview */}
      {status === 'found' && block.title && (
        <div className="rounded-lg border border-[#0A66C2]/20 bg-[#F5F9FF] px-4 py-3">
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#0B1F33]">{block.title}</p>
              {block.excerpt && (
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{block.excerpt}</p>
              )}
              <p className="text-xs text-[#0A66C2] mt-1">/blog/{block.slug}</p>
            </div>
          </div>
        </div>
      )}

      {/* Manual title override (shown when resolved or after edit) */}
      {(status === 'found' || block.title) && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title override (optional)</label>
            <input
              type="text"
              value={block.title ?? ''}
              onChange={(e) => onChange({ ...block, title: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
              placeholder="Custom title"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Excerpt override (optional)</label>
            <input
              type="text"
              value={block.excerpt ?? ''}
              onChange={(e) => onChange({ ...block, excerpt: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
              placeholder="Custom excerpt"
            />
          </div>
        </div>
      )}
    </div>
  );
}
