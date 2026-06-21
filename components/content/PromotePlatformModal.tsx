'use client';

import React, { useEffect, useState } from 'react';
import { Share2, X, Loader2 } from 'lucide-react';

export type PromotablePlatform = {
  /** Canonical platform key (e.g. 'linkedin', 'x', 'facebook', 'reddit'). */
  key: string;
  label: string;
  /** Connected social account id, used by the scheduler / publisher. */
  accountId: string | null;
};

/**
 * Platform-selection modal for the promotion workflow (PHASE BLOG-PROMOTION-2).
 *
 * Opened when the user clicks "Promote on social". Lists ONLY connected
 * platforms (sourced from the existing connected-platform registry — no
 * hardcoded list) and lets the user pick which to generate promotional drafts
 * for. It does not generate or publish anything itself; it hands the selection
 * back to the caller, which calls the existing adaptation flow.
 */
export default function PromotePlatformModal({
  open,
  platforms,
  generating,
  onCancel,
  onGenerate,
}: {
  open: boolean;
  platforms: PromotablePlatform[];
  generating: boolean;
  onCancel: () => void;
  onGenerate: (selectedKeys: string[]) => void;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Default to all connected platforms selected each time the modal opens.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    platforms.forEach((p) => { next[p.key] = true; });
    setSelected(next);
  }, [open, platforms]);

  if (!open) return null;

  const selectedKeys = platforms.filter((p) => selected[p.key]).map((p) => p.key);
  const toggle = (key: string) => setSelected((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">Select platforms to promote</h2>
              <p className="text-xs text-slate-500">Generate platform-native promotional posts — text only.</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          {platforms.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No connected social platforms. Connect an account in Integrations to promote this content.
            </p>
          ) : (
            <div className="space-y-2">
              {platforms.map((p) => (
                <label
                  key={p.key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(selected[p.key])}
                    onChange={() => toggle(p.key)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-slate-800">{p.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onGenerate(selectedKeys)}
            disabled={generating || selectedKeys.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating…</> : 'Generate Promotion Drafts'}
          </button>
        </div>
      </div>
    </div>
  );
}
