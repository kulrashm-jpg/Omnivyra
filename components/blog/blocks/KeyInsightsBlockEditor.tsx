'use client';

import React from 'react';
import { Plus, X } from 'lucide-react';
import type { KeyInsightsBlock } from '../../../lib/blog/blockTypes';
import { newId } from '../../../lib/blog/blockUtils';

type Props = {
  block: KeyInsightsBlock;
  onChange: (block: KeyInsightsBlock) => void;
};

export function KeyInsightsBlockEditor({ block, onChange }: Props) {
  const updateItem = (index: number, value: string) => {
    const items = [...block.items];
    items[index] = value;
    onChange({ ...block, items });
  };

  const addItem = () => {
    onChange({ ...block, items: [...block.items, ''] });
  };

  const removeItem = (index: number) => {
    if (block.items.length <= 1) return;
    onChange({ ...block, items: block.items.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      {/* Title field */}
      <input
        type="text"
        value={block.title ?? 'Key Insights'}
        onChange={(e) => onChange({ ...block, title: e.target.value })}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-[#0B1F33] focus:border-[#0A66C2] focus:outline-none"
        placeholder="Block title (default: Key Insights)"
      />

      {/* Insight items */}
      <div className="space-y-2">
        {block.items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A66C2]/10 text-xs font-bold text-[#0A66C2]">
              {i + 1}
            </span>
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(i, e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
              placeholder={`Insight ${i + 1}…`}
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              disabled={block.items.length <= 1}
              className="mt-2 text-gray-400 hover:text-red-500 disabled:opacity-30"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-[#0A66C2] hover:text-[#0A66C2] transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add insight
      </button>
    </div>
  );
}
