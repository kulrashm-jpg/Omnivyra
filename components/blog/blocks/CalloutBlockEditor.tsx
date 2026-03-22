'use client';

import React from 'react';
import type { CalloutBlock, CalloutVariant } from '../../../lib/blog/blockTypes';

type Props = {
  block: CalloutBlock;
  onChange: (block: CalloutBlock) => void;
};

const VARIANTS: { value: CalloutVariant; label: string; color: string }[] = [
  { value: 'insight', label: '💡 Insight', color: 'bg-[#0A66C2]/10 text-[#0A66C2] border-[#0A66C2]/30' },
  { value: 'note',    label: '📝 Note',    color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'warning', label: '⚠️ Warning', color: 'bg-red-50 text-red-700 border-red-200' },
];

export function CalloutBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-3">
      {/* Variant selector */}
      <div className="flex gap-2">
        {VARIANTS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => onChange({ ...block, variant: v.value })}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
              block.variant === v.value
                ? v.color + ' ring-2 ring-offset-1 ring-current'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Optional title */}
      <input
        type="text"
        value={block.title ?? ''}
        onChange={(e) => onChange({ ...block, title: e.target.value })}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-[#0B1F33] focus:border-[#0A66C2] focus:outline-none"
        placeholder="Title (optional)"
      />

      {/* Body */}
      <textarea
        value={block.body}
        onChange={(e) => onChange({ ...block, body: e.target.value })}
        rows={3}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] leading-relaxed focus:border-[#0A66C2] focus:outline-none resize-none"
        placeholder="Callout content…"
      />
    </div>
  );
}
