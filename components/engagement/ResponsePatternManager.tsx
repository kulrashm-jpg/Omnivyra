/**
 * ResponsePatternManager — modal for saving response patterns.
 */

import React, { useState } from 'react';

export type PatternBlock = {
  type: string;
  label: string;
  required?: boolean;
};

export type PatternStructure = {
  blocks?: PatternBlock[];
};

const DEFAULT_BLOCKS: PatternBlock[] = [
  { type: 'greeting', label: 'Greeting', required: true },
  { type: 'acknowledgement', label: 'Acknowledgement', required: true },
  { type: 'helpful_info', label: 'Helpful information', required: true },
  { type: 'cta', label: 'Optional CTA', required: false },
];

export interface ResponsePatternManagerProps {
  open: boolean;
  onClose: () => void;
  onSave: (patternCategory: string, patternStructure: PatternStructure) => Promise<void>;
  initialText?: string;
}

export const ResponsePatternManager = React.memo(function ResponsePatternManager({
  open,
  onClose,
  onSave,
  initialText = '',
}: ResponsePatternManagerProps) {
  const [patternCategory, setPatternCategory] = useState('');
  const [blocks, setBlocks] = useState<PatternBlock[]>(DEFAULT_BLOCKS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const cat = patternCategory.trim();
    if (!cat) {
      setError('Category is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(cat, { blocks });
      onClose();
      setPatternCategory('');
      setBlocks(DEFAULT_BLOCKS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pattern');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setPatternCategory('');
    setBlocks(DEFAULT_BLOCKS);
    setError(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={handleClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-800 mb-3">Save Response Pattern</h3>
        <p className="text-sm text-slate-600 mb-4">
          Store a semantic structure (not fixed text) for reuse in AI-generated replies.
        </p>

        <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
        <input
          type="text"
          value={patternCategory}
          onChange={(e) => setPatternCategory(e.target.value)}
          placeholder="e.g. question_request"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm mb-4"
        />

        <label className="block text-sm font-medium text-slate-700 mb-1">Structure (blocks)</label>
        <div className="space-y-2 mb-4">
          {blocks.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={b.label}
                onChange={(e) => {
                  const next = [...blocks];
                  next[i] = { ...next[i], label: e.target.value };
                  setBlocks(next);
                }}
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder="Label"
              />
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={!!b.required}
                  onChange={(e) => {
                    const next = [...blocks];
                    next[i] = { ...next[i], required: e.target.checked };
                    setBlocks(next);
                  }}
                />
                Required
              </label>
            </div>
          ))}
        </div>

        {initialText && (
          <p className="text-xs text-slate-500 mb-4">
            Source text: &quot;{initialText.slice(0, 80)}...&quot;
          </p>
        )}

        {error && (
          <div className="mb-4 p-2 rounded bg-red-50 text-red-700 text-sm" role="alert">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded"
          >
            {saving ? 'Saving…' : 'Save Pattern'}
          </button>
        </div>
      </div>
    </div>
  );
});
