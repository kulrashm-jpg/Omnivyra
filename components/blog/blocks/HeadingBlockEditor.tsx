'use client';

import React from 'react';
import type { HeadingBlock } from '../../../lib/blog/blockTypes';
import { generateAnchor } from '../../../lib/blog/blockUtils';

type Props = {
  block: HeadingBlock;
  onChange: (block: HeadingBlock) => void;
};

export function HeadingBlockEditor({ block, onChange }: Props) {
  const anchor = block.text ? generateAnchor(block.text) : '';

  return (
    <div className="space-y-2">
      {/* Level selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Level</span>
        {([2, 3] as const).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onChange({ ...block, level })}
            className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
              block.level === level
                ? 'bg-[#0A66C2] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            H{level}
          </button>
        ))}
      </div>

      {/* Heading text input */}
      {block.level === 2 ? (
        <input
          type="text"
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value, anchor: generateAnchor(e.target.value) })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xl font-bold text-[#0B1F33] placeholder-gray-400 focus:border-[#0A66C2] focus:outline-none"
          placeholder="Section heading…"
        />
      ) : (
        <input
          type="text"
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value, anchor: generateAnchor(e.target.value) })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-lg font-semibold text-[#0B1F33] placeholder-gray-400 focus:border-[#0A66C2] focus:outline-none"
          placeholder="Sub-section heading…"
        />
      )}

      {/* Anchor preview (read-only) */}
      {anchor && (
        <p className="text-xs text-gray-400">
          Anchor: <code className="font-mono text-gray-500">#{anchor}</code>
        </p>
      )}
    </div>
  );
}
