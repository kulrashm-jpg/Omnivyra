'use client';

import React from 'react';
import type { DividerBlock, DividerVariant } from '../../../lib/blog/blockTypes';

type Props = {
  block: DividerBlock;
  onChange: (block: DividerBlock) => void;
};

export function DividerBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {([
          { value: 'subtle',        label: 'Subtle',        preview: <hr className="border-t border-gray-200 w-full" /> },
          { value: 'section_break', label: 'Section Break', preview: (
            <div className="flex items-center gap-3 w-full">
              <div className="flex-1 border-t border-gray-300" />
              <div className="flex gap-1">
                <span className="h-1 w-1 rounded-full bg-gray-400" />
                <span className="h-1 w-1 rounded-full bg-gray-400" />
                <span className="h-1 w-1 rounded-full bg-gray-400" />
              </div>
              <div className="flex-1 border-t border-gray-300" />
            </div>
          )},
        ] as { value: DividerVariant; label: string; preview: React.ReactNode }[]).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ ...block, variant: opt.value })}
            className={`flex-1 rounded-lg border px-4 py-4 transition-all ${
              block.variant === opt.value
                ? 'border-[#0A66C2] ring-2 ring-[#0A66C2]/20 bg-[#F5F9FF]'
                : 'border-gray-200 hover:border-gray-300 bg-white'
            }`}
          >
            <div className="flex items-center justify-center mb-2">{opt.preview}</div>
            <p className="text-xs font-medium text-gray-600 text-center">{opt.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
