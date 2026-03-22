'use client';

import React from 'react';
import { Plus, X } from 'lucide-react';
import type { ReferencesBlock } from '../../../lib/blog/blockTypes';
import { newId } from '../../../lib/blog/blockUtils';

type Props = {
  block: ReferencesBlock;
  onChange: (block: ReferencesBlock) => void;
};

export function ReferencesBlockEditor({ block, onChange }: Props) {
  const addRef = () => {
    onChange({
      ...block,
      items: [...block.items, { id: newId(), title: '', url: '' }],
    });
  };

  const updateRef = (index: number, field: 'title' | 'url', value: string) => {
    const items = block.items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item,
    );
    onChange({ ...block, items });
  };

  const removeRef = (index: number) => {
    if (block.items.length <= 1) return;
    onChange({ ...block, items: block.items.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {block.items.map((item, i) => (
          <div key={item.id} className="flex items-start gap-2">
            <span className="mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
              {i + 1}
            </span>
            <div className="flex-1 grid grid-cols-2 gap-2">
              <input
                type="text"
                value={item.title}
                onChange={(e) => updateRef(i, 'title', e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
                placeholder="Reference title"
              />
              <input
                type="url"
                value={item.url}
                onChange={(e) => updateRef(i, 'url', e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
                placeholder="https://..."
              />
            </div>
            <button
              type="button"
              onClick={() => removeRef(i)}
              disabled={block.items.length <= 1}
              className="mt-2.5 text-gray-400 hover:text-red-500 disabled:opacity-30"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRef}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-[#0A66C2] hover:text-[#0A66C2] transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add reference
      </button>
    </div>
  );
}
