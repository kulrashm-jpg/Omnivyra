'use client';

import React, { useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, Copy, GripVertical, ChevronDown as Collapse } from 'lucide-react';
import type { ContentBlock } from '../../../lib/blog/blockTypes';
import { BLOCK_LABELS } from '../../../lib/blog/blockTypes';

type Props = {
  block: ContentBlock;
  index: number;
  total: number;
  children: React.ReactNode;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
};

// One-line preview text shown when collapsed
function blockPreview(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':    return block.html.replace(/<[^>]+>/g, '').slice(0, 80) || '(empty)';
    case 'heading':      return block.text || '(empty heading)';
    case 'key_insights': return block.items.filter(Boolean).join(' · ').slice(0, 80) || '(no items)';
    case 'callout':      return (block.title || block.variant) + ': ' + block.body.slice(0, 60);
    case 'quote':        return '"' + block.text.slice(0, 70) + '"';
    case 'image':        return block.url || '(no URL)';
    case 'media':        return `${block.mediaType}: ${block.url || '(no URL)'}`;
    case 'divider':      return block.variant === 'section_break' ? '— section break —' : '— subtle divider —';
    case 'list':         return block.items.map((i) => i.text).filter(Boolean).join(', ').slice(0, 80) || '(empty list)';
    case 'references':   return block.items.map((r) => r.title).filter(Boolean).join(', ').slice(0, 80) || '(no references)';
    case 'internal_link': return block.title || block.slug || '(no slug)';
    case 'summary':      return block.body.slice(0, 80) || '(empty)';
  }
}

const VARIANT_BADGE: Record<string, string> = {
  paragraph:     'bg-gray-100 text-gray-600',
  heading:       'bg-indigo-100 text-indigo-700',
  key_insights:  'bg-[#0A66C2]/10 text-[#0A66C2]',
  callout:       'bg-amber-100 text-amber-700',
  quote:         'bg-violet-100 text-violet-700',
  image:         'bg-emerald-100 text-emerald-700',
  media:         'bg-pink-100 text-pink-700',
  divider:       'bg-gray-100 text-gray-500',
  list:          'bg-orange-100 text-orange-700',
  references:    'bg-teal-100 text-teal-700',
  internal_link: 'bg-sky-100 text-sky-700',
  summary:       'bg-[#0A66C2]/10 text-[#0A66C2]',
};

export function BlockWrapper({
  block,
  index,
  total,
  children,
  onMoveUp,
  onMoveDown,
  onDelete,
  onDuplicate,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    onDelete();
  };

  return (
    <div className="group relative rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 bg-gray-50 rounded-t-xl">
        {/* Grip handle (visual only) */}
        <GripVertical className="h-4 w-4 text-gray-300 shrink-0 cursor-grab" />

        {/* Block type badge */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold select-none ${VARIANT_BADGE[block.type] ?? 'bg-gray-100 text-gray-600'}`}
          title={collapsed ? 'Expand block' : 'Collapse block'}
        >
          {BLOCK_LABELS[block.type]}
          <Collapse className={`h-3 w-3 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>

        {/* Collapsed preview */}
        {collapsed && (
          <p className="flex-1 truncate text-xs text-gray-400 ml-1">{blockPreview(block)}</p>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {/* Move up */}
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 transition-colors"
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          {/* Move down */}
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30 transition-colors"
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {/* Duplicate */}
          <button
            type="button"
            onClick={onDuplicate}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
            title="Duplicate block"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {/* Delete */}
          <button
            type="button"
            onClick={handleDelete}
            onBlur={() => setConfirmDelete(false)}
            className={`rounded p-1 transition-colors ${
              confirmDelete
                ? 'bg-red-100 text-red-600 hover:bg-red-200'
                : 'text-gray-400 hover:bg-gray-200 hover:text-red-500'
            }`}
            title={confirmDelete ? 'Click again to confirm delete' : 'Delete block'}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Block content */}
      {!collapsed && (
        <div className="p-4">
          {children}
        </div>
      )}
    </div>
  );
}
