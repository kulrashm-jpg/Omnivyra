'use client';

import React from 'react';

type Accent = 'blue' | 'violet' | 'pink' | 'slate' | 'amber';

type Props = {
  options: string[];
  onPick: (option: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  accent?: Accent;
};

const ACCENT_STYLES: Record<Accent, { chip: string; secondary: string }> = {
  blue: {
    chip: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
    secondary: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50',
  },
  violet: {
    chip: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
    secondary: 'border-violet-200 text-violet-700 hover:bg-violet-50',
  },
  pink: {
    chip: 'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100',
    secondary: 'border-pink-200 text-pink-700 hover:bg-pink-50',
  },
  slate: {
    chip: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
    secondary: 'border-slate-200 text-slate-700 hover:bg-slate-50',
  },
  amber: {
    chip: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    secondary: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  },
};

export default function SuggestionOptionPicker({
  options,
  onPick,
  onSelectAll,
  onClear,
  accent = 'blue',
}: Props) {
  if (!options.length) return null;

  const styles = ACCENT_STYLES[accent];

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">Pick suggestions or apply them all at once.</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSelectAll}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${styles.secondary}`}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {options.map((option, idx) => (
          <button
            key={`${option}-${idx}`}
            type="button"
            onClick={() => onPick(option)}
            className={`rounded-full border px-2 py-1 text-[11px] transition ${styles.chip}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
