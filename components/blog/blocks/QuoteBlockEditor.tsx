'use client';

import React from 'react';
import type { QuoteBlock } from '../../../lib/blog/blockTypes';

type Props = {
  block: QuoteBlock;
  onChange: (block: QuoteBlock) => void;
};

export function QuoteBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-3">
      <textarea
        value={block.text}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
        rows={3}
        className="w-full rounded-lg border border-l-4 border-l-[#0A66C2] border-gray-200 bg-[#F5F9FF]/60 px-4 py-3 text-base italic text-[#3D4F61] leading-relaxed focus:border-l-[#0A66C2] focus:outline-none resize-none"
        placeholder="Quote text…"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          value={block.author ?? ''}
          onChange={(e) => onChange({ ...block, author: e.target.value })}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
          placeholder="Author (optional)"
        />
        <input
          type="text"
          value={block.source ?? ''}
          onChange={(e) => onChange({ ...block, source: e.target.value })}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
          placeholder="Source / URL (optional)"
        />
      </div>
    </div>
  );
}
