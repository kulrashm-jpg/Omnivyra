'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

type Props = {
  segments: string[];
  onChange: (segments: string[]) => void;
};

export default function ThreadSegmentsEditor({ segments, onChange }: Props) {
  const updateSegment = (index: number, value: string) => {
    const next = [...segments];
    next[index] = value;
    onChange(next);
  };

  const moveSegment = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= segments.length) return;
    const next = [...segments];
    const current = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = current;
    onChange(next);
  };

  const addSegment = () => {
    onChange([...segments, '']);
  };

  const removeSegment = (index: number) => {
    if (segments.length <= 1) return;
    onChange(segments.filter((_, entryIndex) => entryIndex !== index));
  };

  return (
    <div className="space-y-4">
      {segments.map((segment, index) => (
        <div key={`${index}-${segments.length}`} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Thread Post {index + 1}</p>
              <p className="mt-1 text-sm text-slate-600">Edit the sequence one post at a time.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => moveSegment(index, -1)}
                disabled={index === 0}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveSegment(index, 1)}
                disabled={index === segments.length - 1}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeSegment(index)}
                disabled={segments.length <= 1}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <textarea
            rows={5}
            value={segment}
            onChange={(event) => updateSegment(index, event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-7 text-slate-800 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addSegment}
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
      >
        <Plus className="h-4 w-4" />
        Add another thread post
      </button>
    </div>
  );
}
