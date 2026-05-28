'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Paperclip, Plus, Trash2, X } from 'lucide-react';
import {
  validatePostForPlatform,
  platformValidationBadgeClass,
  platformValidationLabel,
} from '../../lib/preview/platformLimitValidation';
import type { WriterAttachedAsset } from '../../lib/content/writerCreatorAssetLaunch';
import type { ThreadNodeAttachmentMap } from '../../lib/thread/threadStorage';

/** Runtime-observability hook fired by editor handlers. Caller-supplied so
 *  the editor stays decoupled from the trace registry. Errors thrown by
 *  the callback are swallowed by the editor; observability must NOT break
 *  editor UX. */
export type ThreadSegmentEditorRuntimeEvent =
  | { kind: 'node_reorder'; index: number; newPosition: number }
  | { kind: 'node_create'; index: number }
  | { kind: 'node_edit'; index: number; reason: 'remove' };

type Props = {
  segments: string[];
  onChange: (segments: string[]) => void;
  /** G11.C — platform context for per-segment live char-limit validation */
  platform?: string;
  /** G2 — per-node attachment assignments (position → asset IDs). Optional. */
  nodeAttachments?: ThreadNodeAttachmentMap;
  /** G2 — thread-level attached assets the user can distribute to nodes. Optional. */
  availableThreadAssets?: WriterAttachedAsset[];
  /** G2 — callback when per-node assignments change. Optional. */
  onNodeAttachmentsChange?: (next: ThreadNodeAttachmentMap) => void;
  /** Phase 3 — opt-in runtime instrumentation callback. */
  onRuntimeEvent?: (event: ThreadSegmentEditorRuntimeEvent) => void;
};

export default function ThreadSegmentsEditor({
  segments,
  onChange,
  platform,
  nodeAttachments,
  availableThreadAssets,
  onNodeAttachmentsChange,
  onRuntimeEvent,
}: Props) {
  // Safely fire the runtime hook — never throw into the editor.
  const fireRuntimeEvent = (e: ThreadSegmentEditorRuntimeEvent) => {
    if (!onRuntimeEvent) return;
    try { onRuntimeEvent(e); } catch { /* observability must not break editor UX */ }
  };
  const [openPickerForIndex, setOpenPickerForIndex] = useState<number | null>(null);
  const attachmentsEnabled = Boolean(onNodeAttachmentsChange && availableThreadAssets);
  const currentNodeAttachments = nodeAttachments ?? {};
  const threadAssetsById = new Map((availableThreadAssets ?? []).map((a) => [a.id, a]));

  const assignAssetToNode = (index: number, assetId: string) => {
    if (!onNodeAttachmentsChange) return;
    const existing = currentNodeAttachments[index] ?? [];
    if (existing.includes(assetId)) return;
    const next: ThreadNodeAttachmentMap = {
      ...currentNodeAttachments,
      [index]: [...existing, assetId],
    };
    onNodeAttachmentsChange(next);
  };

  const removeAssetFromNode = (index: number, assetId: string) => {
    if (!onNodeAttachmentsChange) return;
    const existing = currentNodeAttachments[index] ?? [];
    const filtered = existing.filter((id) => id !== assetId);
    const next: ThreadNodeAttachmentMap = { ...currentNodeAttachments };
    if (filtered.length === 0) delete next[index];
    else next[index] = filtered;
    onNodeAttachmentsChange(next);
  };
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
    fireRuntimeEvent({ kind: 'node_reorder', index, newPosition: nextIndex });
    onChange(next);

    // G2 — swap per-node attachments alongside the segment swap.
    if (onNodeAttachmentsChange) {
      const updated: ThreadNodeAttachmentMap = { ...currentNodeAttachments };
      const a = updated[index];
      const b = updated[nextIndex];
      if (a) updated[nextIndex] = a; else delete updated[nextIndex];
      if (b) updated[index] = b; else delete updated[index];
      onNodeAttachmentsChange(updated);
    }
  };

  const addSegment = () => {
    fireRuntimeEvent({ kind: 'node_create', index: segments.length });
    onChange([...segments, '']);
    // No per-node attachment changes — new position is empty by default.
  };

  const removeSegment = (index: number) => {
    if (segments.length <= 1) return;
    fireRuntimeEvent({ kind: 'node_edit', index, reason: 'remove' });
    onChange(segments.filter((_, entryIndex) => entryIndex !== index));

    // G2 — drop the removed position's attachments and shift higher positions down by 1.
    if (onNodeAttachmentsChange) {
      const updated: ThreadNodeAttachmentMap = {};
      for (const [posStr, ids] of Object.entries(currentNodeAttachments)) {
        const pos = Number(posStr);
        if (pos === index) continue;
        const newPos = pos > index ? pos - 1 : pos;
        updated[newPos] = ids;
      }
      onNodeAttachmentsChange(updated);
    }
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
            className={`w-full rounded-2xl border px-4 py-3 text-sm leading-7 text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-100 ${
              (() => {
                if (!platform) return 'border-slate-200 focus:border-violet-300';
                const v = validatePostForPlatform(segment, platform);
                if (v.state === 'invalid') return 'border-red-300 focus:border-red-400';
                if (v.state === 'warning') return 'border-amber-300 focus:border-amber-400';
                return 'border-slate-200 focus:border-violet-300';
              })()
            }`}
          />
          {platform && (() => {
            const v = validatePostForPlatform(segment, platform);
            if (v.maxCount === 0) return null;
            return (
              <div className="mt-2 flex items-center justify-end">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${platformValidationBadgeClass(v.state)}`}
                  title={v.state === 'invalid' ? `Over platform limit by ${v.exceeded} chars` : undefined}
                >
                  {platformValidationLabel(v)}
                </span>
              </div>
            );
          })()}

          {attachmentsEnabled && (() => {
            const assignedIds = currentNodeAttachments[index] ?? [];
            const assignedAssets = assignedIds
              .map((id) => threadAssetsById.get(id))
              .filter((a): a is WriterAttachedAsset => Boolean(a));
            const availableForThisNode = (availableThreadAssets ?? [])
              .filter((a) => !assignedIds.includes(a.id));
            const isPickerOpen = openPickerForIndex === index;

            return (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Attached to this post
                  </p>
                  {availableForThisNode.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOpenPickerForIndex(isPickerOpen ? null : index)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50/60 hover:text-violet-700"
                    >
                      <Paperclip className="h-3 w-3" />
                      {isPickerOpen ? 'Close picker' : 'Attach asset'}
                    </button>
                  )}
                </div>

                {assignedAssets.length === 0 ? (
                  <p className="mt-2 text-xs italic text-slate-400">
                    {(availableThreadAssets ?? []).length === 0
                      ? 'No thread-level assets yet. Use the "Add Asset" panel above to create one.'
                      : 'No assets distributed to this post yet.'}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {assignedAssets.map((asset) => (
                      <span
                        key={asset.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                      >
                        <Paperclip className="h-3 w-3 text-slate-400" />
                        <span className="max-w-[180px] truncate">{asset.title || asset.creatorType}</span>
                        <button
                          type="button"
                          onClick={() => removeAssetFromNode(index, asset.id)}
                          className="rounded-full p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Remove ${asset.title || 'asset'} from this post`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {isPickerOpen && availableForThisNode.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Distribute a thread-level asset to this post
                    </p>
                    <div className="space-y-1">
                      {availableForThisNode.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => {
                            assignAssetToNode(index, asset.id);
                            setOpenPickerForIndex(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-violet-50"
                        >
                          <Paperclip className="h-3 w-3 text-slate-400" />
                          <span className="flex-1 truncate font-semibold">{asset.title || asset.creatorType}</span>
                          <span className="text-[10px] text-slate-400">{asset.creatorType}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
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
