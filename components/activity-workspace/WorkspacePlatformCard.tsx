import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, Sparkles, X } from 'lucide-react';
import { executeVariantImprovementAll } from '@/lib/planning/executeMasterContentPipeline';
import { computeVariantIntelligence } from '@/lib/intelligence/executionIntelligence';
import { isActivityDetailMode } from '@/lib/shared/activityWorkspaceMode';
import ContentRenderer from '@/components/ContentRenderer';
import PlatformIcon from '@/components/ui/PlatformIcon';
import RichTextEditor from '@/components/RichTextEditorLazy'; // W5-2: lazy tiptap chunk
import { apiFetch } from '@/lib/apiFetch';
import ImagePicker from '../../pages/activity-workspace/ImagePicker';
import PlatformContentPreview from '../../pages/activity-workspace/PlatformContentPreview';
import type { useActivityWorkspace } from '../../hooks/useActivityWorkspace';
import type { ScheduleItem } from '../../types/activityWorkspace';

type S = ReturnType<typeof useActivityWorkspace>;

function stripBakedHashtags(content: string): string {
  if (!content) return content;
  const hashtagLine = /^(#\w+\s*)+$/;
  const lines = content.split('\n');
  while (lines.length > 0 && hashtagLine.test(lines[lines.length - 1].trim())) lines.pop();
  while (lines.length > 0 && hashtagLine.test(lines[0].trim())) lines.shift();
  return lines.join('\n').trim();
}

export default function WorkspacePlatformCard({ d, item, idx }: { d: S; item: ScheduleItem; idx: number }) {
  const {
    computeVariantIntelligence: _unused,
    connectedPlatforms,
    finalizedByScheduleId,
    findVariantForSchedule,
    handleRefineWithAi,
    handleRepurposeForPlatform,
    imageByScheduleId,
    improveSuggestionKey,
  } = d as any;
  const matchedVariant = d.findVariantForSchedule(item);
  const rawGeneratedContent = String((matchedVariant as any)?.generated_content || '').trim();
  const isMediaBlueprint = rawGeneratedContent.startsWith('[PLATFORM MEDIA BLUEPRINT]');
  const hasContent = !!rawGeneratedContent && !isMediaBlueprint;
  const repurposeLabel = idx === 0 ? 'Repurpose' : `Repurpose ${idx + 1}`;
  const isRepurposing = !!d.repurposingByScheduleId[item.id];
  const isBusy = isRepurposing || d.isGeneratingMaster;
  // PHASE ACTIVITY-AI-ISOLATION — in ACTIVITY_DETAIL_MODE the per-card AI
  // suggestions must NOT depend on campaign-level context. strategicMemoryProfile
  // is campaign-scoped (campaign_id + campaign acceptance rates / platform
  // confidence) and is only used to RANK suggestions; passing undefined makes
  // suggestions derive solely from the variant + platform (rankSuggestionsByMemory
  // returns them unranked when no profile). CAMPAIGN_WORKSPACE keeps the profile.
  const memoryForIntelligence = isActivityDetailMode((d as any).workspaceMode)
    ? undefined
    : d.strategicMemoryProfile;
  const intelligence = matchedVariant
    ? computeVariantIntelligence(matchedVariant as Record<string, unknown>, item.platform, memoryForIntelligence)
    : null;

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50/80 border-b border-gray-100">
        <div className="flex items-center gap-2.5 flex-wrap">
          <PlatformIcon platform={item.platform} size={18} showLabel />
          <span className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded">
            {d.labelize(item.contentType)}
          </span>
          {item.weekNumber != null && !item.isPrimary && (
            <span className="inline-flex items-center text-xs text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded font-medium">
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
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <CheckCircle2 className="h-3 w-3" /> Scheduled
            </span>
          )}
          {d.finalizedByScheduleId[item.id] && item.status !== 'scheduled' && (
            <span className="text-xs text-amber-600 font-medium">Finalized</span>
          )}
          {hasContent && item.status !== 'scheduled' && !d.finalizedByScheduleId[item.id] && (
            <span className="text-xs text-indigo-500 font-medium">Generated</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => d.handleRepurposeForPlatform(item)}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isBusy ? (d.isGeneratingMaster && !isRepurposing ? 'Creating master...' : 'Repurposing...') : repurposeLabel}
          </button>
          {!d.isDailyTopicView && (
            <button
              type="button"
              onClick={() => d.removeScheduleRow(item.id)}
              className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
              title="Remove platform"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {isMediaBlueprint ? (
        <div className="p-5 flex items-start gap-3 bg-blue-50/40">
          <div className="text-2xl">🎬</div>
          <div>
            <div className="text-sm font-semibold text-blue-800 mb-0.5">Media asset required</div>
            <div className="text-xs text-blue-700">
              This {item.contentType} variant is waiting for your creator to upload the media asset.
            </div>
          </div>
        </div>
      ) : hasContent ? (
        <div className="divide-y divide-gray-100">
          <div className="p-4 space-y-3">
            {d.platformRulesByPlatform[d.normalizeKey(item.platform)]?.guidelines?.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
                <span className="font-semibold">Platform rules applied: </span>
                {d.platformRulesByPlatform[d.normalizeKey(item.platform)].guidelines.join(' · ')}
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
            <div className="px-4 py-3 bg-slate-50/60 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                AI Suggestions
                <span className="font-normal text-slate-400">· Confidence: {intelligence.confidence_score}%</span>
              </div>
              {intelligence.strategist_suggestions.map((suggestion) => {
                const suggestionKey = `${item.id}-${suggestion.id}`;
                const isImproving = d.improvingSuggestionKey === suggestionKey;
                const showImproved = d.improvedByScheduleId[item.id];
                return (
                  <div key={suggestion.id} className="flex items-start justify-between gap-3">
                    <div className="text-xs text-slate-600">
                      <span className="font-medium text-slate-800">→ {suggestion.label}:</span> {suggestion.description}
                    </div>
                    <button
                      type="button"
                      disabled={isImproving || showImproved}
                      onClick={async () => {
                        d.setImprovingSuggestionKey(suggestionKey);
                        try {
                          const allActions = intelligence.strategist_suggestions.map((entry) => entry.action);
                          const { improved_variant } = await executeVariantImprovementAll({
                            campaignId: d.payload?.campaignId ?? undefined,
                            executionId: String(d.payload?.activityId ?? (d.payload?.dailyExecutionItem as any)?.execution_id ?? ''),
                            platform: item.platform,
                            improvementTypes: allActions,
                            variant: matchedVariant as Record<string, unknown>,
                            dailyExecutionItem: d.payload?.dailyExecutionItem ?? undefined,
                            companyId: d.selectedCompanyId || d.payload?.companyId || null,
                          });
                          const nextVariants = [...d.platformVariants];
                          const variantIndex = nextVariants.findIndex(
                            (variant) => d.normalizeKey((variant as any)?.platform) === d.normalizeKey(item.platform) && d.normalizeKey((variant as any)?.content_type) === d.normalizeKey(item.contentType)
                          );
                          if (variantIndex >= 0) nextVariants[variantIndex] = improved_variant as any;
                          else nextVariants.push({ ...improved_variant, platform: item.platform, content_type: item.contentType });
                          d.setPayload((prev) => prev ? { ...prev, dailyExecutionItem: { ...(prev.dailyExecutionItem || {}), platform_variants: nextVariants } } : prev);
                          d.setImprovedByScheduleId((prev) => ({ ...prev, [item.id]: true }));
                          const campaignId = d.payload?.campaignId ?? '';
                          if (campaignId) {
                            apiFetch('/api/intelligence/strategic-memory', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                campaign_id: campaignId,
                                execution_id: d.payload?.activityId ?? (d.payload?.dailyExecutionItem as any)?.execution_id,
                                platform: item.platform,
                                action: suggestion.action,
                                accepted: true,
                              }),
                            })
                              .then((response) => response.ok && apiFetch(`/api/intelligence/strategic-memory?campaignId=${encodeURIComponent(campaignId)}`))
                              .then((response) => (response && response.ok ? response.json() : null))
                              .then((profile) => profile && d.setStrategicMemoryProfile(profile))
                              .catch(() => {});
                          }
                          d.notify('success', 'Variant improved.');
                        } catch (error) {
                          d.notify('error', String((error as Error)?.message || 'Improvement failed'));
                        } finally {
                          d.setImprovingSuggestionKey(null);
                        }
                      }}
                      className={`shrink-0 rounded border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 whitespace-nowrap ${showImproved ? 'border-emerald-300 bg-emerald-50 text-emerald-700 cursor-default' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
                    >
                      {isImproving ? 'Improving...' : showImproved ? 'Applied' : 'Apply'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-4 py-3 space-y-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Edit Content</div>
            <RichTextEditor
              value={stripBakedHashtags(String((matchedVariant as any)?.generated_content || ''))}
              finalized={!!d.finalizedByScheduleId[item.id]}
              minHeight="120px"
              onChange={(html) => {
                if (d.finalizedByScheduleId[item.id]) {
                  d.setFinalizedByScheduleId((prev) => ({ ...prev, [item.id]: false }));
                  d.updateSchedule(item.id, { status: 'in-progress' });
                }
                const next = [...d.platformVariants];
                const existingIndex = next.findIndex(
                  (variant) =>
                    d.normalizeKey((variant as any)?.platform) === d.normalizeKey(item.platform) &&
                    d.normalizeKey((variant as any)?.content_type) === d.normalizeKey(item.contentType)
                );
                const nextVariant = {
                  ...(matchedVariant as any),
                  platform: item.platform,
                  content_type: item.contentType,
                  generated_content: html,
                  generated_content_html: html,
                  refinement_finalized: false,
                  refinement_status: 'edited',
                };
                if (existingIndex >= 0) next[existingIndex] = nextVariant;
                else next.push(nextVariant);
                d.setPayload((prev) => (prev ? { ...prev, dailyExecutionItem: { ...(prev.dailyExecutionItem || {}), platform_variants: next } } : prev));
              }}
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => d.setShowRefineByScheduleId((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {d.showRefineByScheduleId[item.id] ? 'Hide AI Refine' : 'Refine with AI'}
              </button>
            </div>
            {d.showRefineByScheduleId[item.id] && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2 mt-1">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={d.refineInputByScheduleId[item.id] || ''}
                    onChange={(event) => d.setRefineInputByScheduleId((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    onKeyDown={(event) => event.key === 'Enter' && d.handleRefineWithAi(item)}
                    placeholder="e.g., Make it sharper for executives..."
                    className="flex-1 rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs focus:outline-none focus:border-violet-400"
                  />
                  <button
                    type="button"
                    onClick={() => d.handleRefineWithAi(item)}
                    disabled={!!d.isRefiningByScheduleId[item.id]}
                    className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {d.isRefiningByScheduleId[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Refine
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-3 space-y-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Image</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { d.setImageByScheduleId((prev) => ({ ...prev, [item.id]: null })); d.setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: false })); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${!d.imageByScheduleId[item.id] ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
              >
                Text only
              </button>
              <button
                type="button"
                onClick={() => d.setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${d.imageByScheduleId[item.id] ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
              >
                {d.imageByScheduleId[item.id] ? 'Image attached' : '+ Add image'}
              </button>
            </div>
            {d.showImagePickerByScheduleId[item.id] && (
              <ImagePicker
                topic={String(d.payload?.title ?? d.payload?.topic ?? item.platform)}
                description={String(d.payload?.description ?? '')}
                selectedUrl={d.imageByScheduleId[item.id]?.url}
                onSelect={(img) => {
                  d.setImageByScheduleId((prev) => ({ ...prev, [item.id]: img }));
                  if (img) d.setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: false }));
                }}
              />
            )}
          </div>

          <div className="px-4 py-3 bg-gray-50/60 flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-600 flex-1 min-w-[120px]">
              Publish date
              <input
                type="date"
                value={item.date || ''}
                min={new Date().toISOString().split('T')[0]}
                onChange={(event) => d.updateSchedule(item.id, { date: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-indigo-400"
              />
            </label>
            <label className="text-xs text-gray-600 min-w-[90px]">
              Time
              <input
                type="time"
                value={item.time || '09:00'}
                onChange={(event) => d.updateSchedule(item.id, { time: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-indigo-400"
              />
            </label>
            <div className="flex items-center gap-2 mb-0.5">
              {item.status === 'scheduled' ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 border border-emerald-300 px-2.5 py-1.5 text-xs font-medium text-emerald-700 cursor-default">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Scheduled
                </span>
              ) : d.finalizedByScheduleId[item.id] ? (
                <>
                  <button
                    type="button"
                    onClick={() => d.scheduleFinalizedContent(item)}
                    disabled={!!d.schedulingByScheduleId[item.id]}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {d.schedulingByScheduleId[item.id] ? 'Scheduling...' : 'Schedule'}
                  </button>
                  {!d.connectedPlatforms.has(d.normalizeKey(item.platform)) && d.connectedPlatforms.size > 0 && (
                    <a
                      href="/social-platforms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-300 px-2 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
                    >
                      <AlertCircle className="h-3 w-3" /> Connect {item.platform}
                    </a>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => d.finalizeRepurposeForSchedule(item)}
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
            Click <strong className="text-indigo-600">{repurposeLabel}</strong> to generate {d.labelize(item.platform)} content.
          </p>
        </div>
      )}
    </div>
  );
}
