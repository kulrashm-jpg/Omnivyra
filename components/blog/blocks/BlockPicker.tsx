'use client';

import React, { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import type { BlockType } from '../../../lib/blog/blockTypes';
import { BLOCK_GROUPS, BLOCK_LABELS, BLOCK_DESCRIPTIONS } from '../../../lib/blog/blockTypes';

type Props = {
  onSelect: (type: BlockType) => void;
};

// Icon characters for each block type (emoji-based, no dependency)
const BLOCK_ICONS: Record<BlockType, string> = {
  paragraph:     '¶',
  heading:       'H',
  key_insights:  '💡',
  callout:       '📌',
  quote:         '"',
  image:         '🖼',
  media:         '▶',
  divider:       '—',
  list:          '☰',
  references:    '📚',
  internal_link: '🔗',
  summary:       '✦',
};

export function BlockPicker({ onSelect }: Props) {
  const [open, setOpen] = React.useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-500 shadow-sm transition-all hover:border-[#0A66C2] hover:text-[#0A66C2] hover:shadow-md"
      >
        <Plus className="h-3.5 w-3.5" />
        Add block
      </button>

      {open && (
        <div className="absolute top-full left-1/2 z-50 mt-2 w-80 -translate-x-1/2 rounded-2xl border border-gray-100 bg-white shadow-2xl ring-1 ring-black/5">
          <div className="p-3 space-y-3">
            {BLOCK_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {group.types.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { onSelect(type); setOpen(false); }}
                      className="flex items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#F5F9FF] group/item"
                    >
                      <span className="mt-0.5 text-base leading-none">{BLOCK_ICONS[type]}</span>
                      <span>
                        <span className="block text-xs font-semibold text-[#0B1F33] group-hover/item:text-[#0A66C2]">
                          {BLOCK_LABELS[type]}
                        </span>
                        <span className="block text-[10px] text-gray-400 leading-tight mt-0.5">
                          {BLOCK_DESCRIPTIONS[type]}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
