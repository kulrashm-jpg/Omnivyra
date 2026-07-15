import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, Sparkles, X } from 'lucide-react';
import ContentRenderer from '@/components/ContentRenderer';
import RichTextEditor from '@/components/RichTextEditorLazy'; // W5-2: lazy tiptap chunk
import PlatformIcon from '@/components/ui/PlatformIcon';
import ImagePicker from './ImagePicker';
import type { RefineChatMessage, ScheduleItem, WorkspacePayload } from './types';

type Props = {
  item: ScheduleItem;
  index: number;
  payload: WorkspacePayload;
  matchedVariant: Record<string, unknown> | null | undefined;
  intelligence: {
    confidence_score: number;
    strategist_suggestions: Array<{ id: string; label: string; description: string; action: string }>;
  } | null;
  repurposingByScheduleId: Record<string, boolean>;
  isGeneratingMaster: boolean;
  finalizedByScheduleId: Record<string, boolean>;
  isDailyTopicView: boolean;
  handleRepurposeForPlatform: (schedule: ScheduleItem) => void;
  removeScheduleRow: (id: string) => void;
  labelize: (value: string) => string;
  platformRulesByPlatform: Record<string, { guidelines: string[] }>;
  normalizeKey: (value: unknown) => string;
  stripBakedHashtags: (content: string) => string;
  improvingSuggestionKey: string | null;
  improvedByScheduleId: Record<string, boolean>;
  executeImproveAll: (item: ScheduleItem, matchedVariant: Record<string, unknown>, action: string) => Promise<void>;
  updateEditedVariant: (item: ScheduleItem, matchedVariant: Record<string, unknown> | null | undefined, html: string) => void;
  showRefineByScheduleId: Record<string, boolean>;
  setShowRefineByScheduleId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  refineMessagesByScheduleId: Record<string, RefineChatMessage[]>;
  refineInputByScheduleId: Record<string, string>;
  setRefineInputByScheduleId: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isRefiningByScheduleId: Record<string, boolean>;
  handleRefineWithAi: (schedule: ScheduleItem) => void;
  imageByScheduleId: Record<string, { url: string; thumb: string; attribution: string } | null>;
  setImageByScheduleId: React.Dispatch<React.SetStateAction<Record<string, { url: string; thumb: string; attribution: string } | null>>>;
  showImagePickerByScheduleId: Record<string, boolean>;
  setShowImagePickerByScheduleId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  updateSchedule: (id: string, patch: Partial<ScheduleItem>) => void;
  schedulingByScheduleId: Record<string, boolean>;
  scheduleFinalizedContent: (schedule: ScheduleItem) => void;
  connectedPlatforms: Set<string>;
  finalizeRepurposeForSchedule: (schedule: ScheduleItem) => void;
};

export default function ActivityWorkspacePlatformCard({
  item,
  index,
  payload,
  matchedVariant,
  intelligence,
  repurposingByScheduleId,
  isGeneratingMaster,
  finalizedByScheduleId,
  isDailyTopicView,
  handleRepurposeForPlatform,
  removeScheduleRow,
  labelize,
  platformRulesByPlatform,
  normalizeKey,
  stripBakedHashtags,
  improvingSuggestionKey,
  improvedByScheduleId,
  executeImproveAll,
  updateEditedVariant,
  showRefineByScheduleId,
  setShowRefineByScheduleId,
  refineMessagesByScheduleId,
  refineInputByScheduleId,
  setRefineInputByScheduleId,
  isRefiningByScheduleId,
  handleRefineWithAi,
  imageByScheduleId,
  setImageByScheduleId,
  showImagePickerByScheduleId,
  setShowImagePickerByScheduleId,
  updateSchedule,
  schedulingByScheduleId,
  scheduleFinalizedContent,
  connectedPlatforms,
  finalizeRepurposeForSchedule,
}: Props) {
  const rawGeneratedContent = String((matchedVariant as any)?.generated_content || '').trim();
  const isMediaBlueprint = rawGeneratedContent.startsWith('[PLATFORM MEDIA BLUEPRINT]');
  const hasContent = !!rawGeneratedContent && !isMediaBlueprint;
  const repurposeLabel = index === 0 ? 'Repurpose' : `Repurpose ${index + 1}`;
  const isRepurposing = !!repurposingByScheduleId[item.id];
  const isBusy = isRepurposing || isGeneratingMaster;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <PlatformIcon platform={item.platform} size={18} showLabel />
          <span className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-500">
            {labelize(item.contentType)}
          </span>
          {item.weekNumber != null && !item.isPrimary && (
            <span className="inline-flex items-center rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
              Week {item.weekNumber}
            </span>
          )}
          {(item.scheduledFor || item.date) && (
            <span className="text-xs text-gray-400">
              {item.scheduledFor
                ? new Date(item.scheduledFor).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : item.date + (item.time ? ` ${item.time}` : '')}
            </span>
          )}
          {item.status === 'scheduled' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Scheduled
            </span>
          )}
          {finalizedByScheduleId[item.id] && item.status !== 'scheduled' && <span className="text-xs font-medium text-amber-600">Finalized</span>}
          {hasContent && item.status !== 'scheduled' && !finalizedByScheduleId[item.id] && <span className="text-xs font-medium text-indigo-500">Generated</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRepurposeForPlatform(item)}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isBusy ? (isGeneratingMaster && !isRepurposing ? 'Creating master...' : 'Repurposing...') : repurposeLabel}
          </button>
          {!isDailyTopicView && (
            <button
              type="button"
              onClick={() => removeScheduleRow(item.id)}
              className="rounded p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-600"
              title="Remove platform"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {isMediaBlueprint ? (
        <div className="flex items-start gap-3 bg-blue-50/40 p-5">
          <div className="text-2xl">Media</div>
          <div>
            <div className="mb-0.5 text-sm font-semibold text-blue-800">Media asset required</div>
            <div className="text-xs text-blue-700">
              This {item.contentType} variant is waiting for your creator to upload the media asset.
              Once the asset is attached via the Creator Panel below, regenerate to produce the final platform-ready post copy.
            </div>
          </div>
        </div>
      ) : hasContent ? (
        <div className="divide-y divide-gray-100">
          <div className="space-y-3 p-4">
            {platformRulesByPlatform[normalizeKey(item.platform)]?.guidelines?.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
                <span className="font-semibold">Platform rules applied: </span>
                {platformRulesByPlatform[normalizeKey(item.platform)].guidelines.join(' · ')}
              </div>
            )}
            <ContentRenderer
              content={stripBakedHashtags(String((matchedVariant as any)?.generated_content || ''))}
              platform={item.platform}
              contentType={item.contentType}
              renderMode="social"
            />
            {Array.isArray((matchedVariant as any)?.discoverability_meta?.hashtags) &&
              ((matchedVariant as any).discoverability_meta.hashtags as string[]).length > 0 && (
                <p className="text-sm text-blue-500">
                  {((matchedVariant as any).discoverability_meta.hashtags as string[]).join(' ')}
                </p>
              )}
          </div>

          {intelligence && intelligence.strategist_suggestions.length > 0 && (
            <div className="space-y-2 bg-slate-50/60 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                AI Suggestions
                <span className="font-normal text-slate-400">· Confidence: {intelligence.confidence_score}%</span>
              </div>
              {intelligence.strategist_suggestions.map((suggestion) => {
                const suggestionKey = `${item.id}-${suggestion.id}`;
                const isImproving = improvingSuggestionKey === suggestionKey;
                const showImproved = improvedByScheduleId[item.id];
                return (
                  <div key={suggestion.id} className="flex items-start justify-between gap-3">
                    <div className="text-xs text-slate-600">
                      <span className="font-medium text-slate-800">→ {suggestion.label}:</span> {suggestion.description}
                    </div>
                    <button
                      type="button"
                      disabled={isImproving || showImproved}
                      onClick={() => matchedVariant && executeImproveAll(item, matchedVariant, suggestion.action)}
                      className={`shrink-0 whitespace-nowrap rounded border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                        showImproved ? 'cursor-default border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {isImproving ? 'Improving...' : showImproved ? 'Applied' : 'Apply'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2 px-4 py-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Edit Content</div>
            <RichTextEditor
              value={stripBakedHashtags(String((matchedVariant as any)?.generated_content || ''))}
              finalized={!!finalizedByScheduleId[item.id]}
              minHeight="120px"
              onChange={(html) => updateEditedVariant(item, matchedVariant, html)}
            />
            {(matchedVariant as any)?.refinement_status === 'edited' && !finalizedByScheduleId[item.id] && (
              <p className="text-[11px] text-amber-600">Content edited - finalize before scheduling.</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowRefineByScheduleId((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {showRefineByScheduleId[item.id] ? 'Hide AI Refine' : 'Refine with AI'}
              </button>
            </div>
            {showRefineByScheduleId[item.id] && (
              <div className="mt-1 space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
                {(refineMessagesByScheduleId[item.id] || []).length > 0 && (
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {(refineMessagesByScheduleId[item.id] || []).map((msg, msgIdx) => (
                      <div
                        key={`${item.id}-msg-${msgIdx}`}
                        className={`rounded border px-2 py-1 text-[11px] ${msg.role === 'user' ? 'border-violet-200 bg-white text-violet-900' : 'border-indigo-200 bg-indigo-100 text-indigo-900'}`}
                      >
                        <span className="mr-1 font-semibold">{msg.role === 'user' ? 'You:' : 'AI:'}</span>
                        {msg.content}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={refineInputByScheduleId[item.id] || ''}
                    onChange={(e) => setRefineInputByScheduleId((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleRefineWithAi(item)}
                    placeholder="e.g., Make it sharper for executives..."
                    className="flex-1 rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs focus:border-violet-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRefineWithAi(item)}
                    disabled={!!isRefiningByScheduleId[item.id]}
                    className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {isRefiningByScheduleId[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Refine
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 px-4 py-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Image</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setImageByScheduleId((prev) => ({ ...prev, [item.id]: null }));
                  setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: false }));
                }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${!imageByScheduleId[item.id] ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Text only
              </button>
              <button
                type="button"
                onClick={() => setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${imageByScheduleId[item.id] ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {imageByScheduleId[item.id] ? 'Image attached' : '+ Add image'}
              </button>
            </div>
            {showImagePickerByScheduleId[item.id] && (
              <ImagePicker
                topic={String(payload?.title ?? payload?.topic ?? item.platform)}
                description={String(payload?.description ?? '')}
                selectedUrl={imageByScheduleId[item.id]?.url}
                onSelect={(img) => {
                  setImageByScheduleId((prev) => ({ ...prev, [item.id]: img }));
                  if (img) setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: false }));
                }}
              />
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 bg-gray-50/60 px-4 py-3">
            <label className="min-w-[120px] flex-1 text-xs text-gray-600">
              Publish date
              <input
                type="date"
                value={item.date || ''}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => updateSchedule(item.id, { date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="min-w-[90px] text-xs text-gray-600">
              Time
              <input
                type="time"
                value={item.time || '09:00'}
                onChange={(e) => updateSchedule(item.id, { time: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <div className="mb-0.5 flex items-center gap-2">
              {item.status === 'scheduled' ? (
                <span className="inline-flex cursor-default items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-100 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Scheduled
                </span>
              ) : finalizedByScheduleId[item.id] ? (
                <>
                  <button
                    type="button"
                    onClick={() => scheduleFinalizedContent(item)}
                    disabled={!!schedulingByScheduleId[item.id]}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {schedulingByScheduleId[item.id] ? 'Scheduling...' : 'Schedule'}
                  </button>
                  {!connectedPlatforms.has(normalizeKey(item.platform)) && connectedPlatforms.size > 0 && (
                    <a
                      href="/social-platforms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
                    >
                      <AlertCircle className="h-3 w-3" /> Connect {item.platform}
                    </a>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => finalizeRepurposeForSchedule(item)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Finalize
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-gray-400">
            Click <strong className="text-indigo-600">{repurposeLabel}</strong> to generate {labelize(item.platform)} content.
          </p>
        </div>
      )}
    </div>
  );
}
