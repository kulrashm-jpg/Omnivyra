import React from 'react';
import { Calendar, Loader2, Send } from 'lucide-react';
import type { PlatformOption, PlatformState } from './schedulerShared';

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
        <textarea
          value={selectedState.content}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={8}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900"
        />
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
        {assetAction}
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
