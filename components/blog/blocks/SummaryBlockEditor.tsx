'use client';

import React from 'react';
import type { SummaryBlock } from '../../../lib/blog/blockTypes';

type Props = {
  block: SummaryBlock;
  onChange: (block: SummaryBlock) => void;
};

export function SummaryBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        End-of-article synthesis. Appears as a highlighted closing block visible to all readers.
      </p>
      <textarea
        value={block.body}
        onChange={(e) => onChange({ ...block, body: e.target.value })}
        rows={4}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] leading-relaxed focus:border-[#0A66C2] focus:outline-none resize-none"
        placeholder="Summarise the key argument, decision, or action this article supports…"
      />
    </div>
  );
}
