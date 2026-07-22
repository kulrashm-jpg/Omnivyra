import React, { useState } from 'react';
import { Calendar, Loader2, Send } from 'lucide-react';
import type { PlatformOption, PlatformState } from './schedulerShared';
import {
  validatePostForPlatform,
  platformValidationBadgeClass,
  platformValidationLabel,
} from '../../../lib/preview/platformLimitValidation';

type Props = {
  adaptingPlatform: string | null;
  sourceContentLabel: string;
  publishContentLabel: string;
  selectedOption: PlatformOption;
  selectedState: PlatformState;
  onChange: (patch: Partial<PlatformState>) => void;
  onSchedule: () => void;
  onPublish: () => void;
  onDelete: () => void;
  minScheduleValue: string;
  assetAction?: React.ReactNode;
};

export default function PostToSocialPlatformPanel({
  adaptingPlatform,
  sourceContentLabel,
  publishContentLabel,
  selectedOption,
  selectedState,
  onChange,
  onSchedule,
  onPublish,
  onDelete,
  minScheduleValue,
  assetAction,
}: Props) {
  const adapting = adaptingPlatform === selectedOption.key;
  const disabled = selectedState.busy || adapting;
  const canDelete = !!selectedState.scheduledPostId && selectedState.status === 'scheduled';
  const actionLabel = sourceContentLabel.toLowerCase();

  // WS2/WS6 — per-platform copy controls. `originalContent` is the reviewed
  // seed; "Keep Original" restores it and "Compare" diffs it against the current
  // (edited/adapted) copy. Editing the textarea marks the copy manuallyEdited so
  // nothing silently overwrites it. The "Adapt for <platform>" action is provided
  // by the controller through `assetAction` (it needs company/objective context).
  const [showCompare, setShowCompare] = useState(false);
  const original = selectedState.originalContent ?? '';
  const hasOriginal = original.trim().length > 0;
  const canRestore = hasOriginal && original !== selectedState.content;
  const handleKeepOriginal = () => onChange({ content: original, adapted: false, manuallyEdited: false });

  return (
    <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Source content</label>
        <div className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
          {sourceContentLabel}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Social format</label>
        <div className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
          {publishContentLabel}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">
          Social copy
          {adapting ? (
            <span className="ml-2 inline-flex items-center text-xs font-normal text-slate-500">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Adapting for {selectedOption.label}
            </span>
          ) : null}
        </label>

        {/* WS2 — per-platform copy controls. Adapt (controller-provided via
            assetAction) + Keep Original + Compare. Copy never auto-regenerates;
            these are the only ways it changes besides direct edits. */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {assetAction}
          <button
            type="button"
            onClick={handleKeepOriginal}
            disabled={disabled || !canRestore}
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Keep Original
          </button>
          <button
            type="button"
            onClick={() => setShowCompare((open) => !open)}
            disabled={!hasOriginal}
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {showCompare ? 'Hide comparison' : 'Compare'}
          </button>
          {selectedState.adapted ? (
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">Adapted</span>
          ) : selectedState.manuallyEdited ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">Edited</span>
          ) : (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500">Reviewed copy</span>
          )}
        </div>

        {(() => {
          const validation = validatePostForPlatform(selectedState.content || '', selectedOption.key);
          const borderClass = validation.state === 'invalid'
            ? 'border-red-300 focus-within:border-red-400'
            : validation.state === 'warning'
              ? 'border-amber-300 focus-within:border-amber-400'
              : 'border-slate-200';
          return (
            <>
              <textarea
                value={selectedState.content}
                onChange={(e) => onChange({ content: e.target.value, manuallyEdited: true, adapted: false })}
                rows={8}
                className={`w-full rounded-2xl border bg-white px-4 py-3 text-sm leading-7 text-slate-900 ${borderClass}`}
              />
              {validation.maxCount > 0 && (
                <div className="mt-2 flex items-center justify-end">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${platformValidationBadgeClass(validation.state)}`}
                    title={validation.state === 'invalid' ? `Over ${selectedOption.label} limit by ${validation.exceeded} chars` : undefined}
                  >
                    {platformValidationLabel(validation)}
                  </span>
                </div>
              )}
            </>
          );
        })()}

        {/* WS2 — inline comparison of the reviewed/original copy vs the current
            (edited/adapted) copy. Simple side-by-side; no external diff lib. */}
        {showCompare && hasOriginal ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Original</p>
              <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-6 text-slate-600">{original}</pre>
            </div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-400">Current</p>
              <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-6 text-slate-700">{selectedState.content}</pre>
            </div>
          </div>
        ) : null}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Hashtags</label>
        <input
          value={selectedState.hashtags}
          onChange={(e) => onChange({ hashtags: e.target.value })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          placeholder="#omnivyra #marketing"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Schedule for</label>
        <input
          type="datetime-local"
          value={selectedState.scheduledFor}
          min={minScheduleValue}
          onChange={(e) => onChange({ scheduledFor: e.target.value })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
        />
      </div>

      {selectedState.message ? (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            selectedState.status === 'error'
              ? 'bg-red-50 text-red-700'
              : selectedState.status === 'published'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-blue-50 text-blue-700'
          }`}
        >
          {selectedState.message}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSchedule}
          disabled={disabled}
          className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {selectedState.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
          {`Schedule ${actionLabel}`}
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={disabled}
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-60"
        >
          {selectedState.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {`Share ${actionLabel} now`}
        </button>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            className="inline-flex items-center rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-700 disabled:opacity-60"
          >
            {`Delete scheduled ${actionLabel}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
