import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { VIEW_RULES } from '@/utils/viewVisibilityMatrix';
import CreatorContentPanel from '@/components/activity-workspace/CreatorContentPanel';
import AISuggestionPanel from '@/components/activity-workspace/AISuggestionPanel';
import type { useActivityWorkspace } from '../../hooks/useActivityWorkspace';
import WorkspaceContentPanels from '../WorkspaceContentPanels';
// Phase 3A — reuse the existing attachment upload handlers (single source of
// truth) to wire the video upload journey into the live workspace.
import {
  extractAttachmentRowState,
  postUploadMedia,
  postUploadFileResumable,
  postReschedule,
  postUnschedule,
  detectResumableUploadHandle,
  resumePersistedUpload,
  discardPersistedUploadSession,
} from '@/components/activity-workspace/creatorMediaUploadHandlers';

type S = ReturnType<typeof useActivityWorkspace>;

export default function ActivityWorkspaceBriefSection({ d }: { d: S }) {
  const {
    contentType,
    creatorAsset,
    creatorCard,
    dailyRaw,
    effectiveProblemAddressed,
    effectiveWhatReaderLearns,
    handleCreatorAssetSaved,
    handleGenerateCreatorPromotion,
    intent,
    isCreatorActivity,
    isGeneratingVariants,
    labelize,
    notify,
    payload,
    setSystemBlockExpanded,
    suggestedPlatforms,
    systemBlockExpanded,
    topicText,
    viewMode,
    writerBrief,
    variantStatusDot,
    variantStatusLabel,
    selectedScheduleId,
    confidenceByPlatform,
  } = d;

  return (
    <>
      {isCreatorActivity ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Creator Brief</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 uppercase tracking-wide">
              {contentType.charAt(0).toUpperCase() + contentType.slice(1)}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Content theme</div>
              <div className="text-gray-900">{String(creatorCard?.theme || topicText || payload.topic || payload.title || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">Objective</div>
              <div className="text-gray-900">{String(creatorCard?.objective || intent?.objective || writerBrief?.topicGoal || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">Target audience</div>
              <div className="text-gray-900">{String(creatorCard?.target_audience || writerBrief?.whoAreWeWritingFor || intent?.target_audience || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">Desired action (CTA)</div>
              <div className="text-gray-900">{String((creatorCard?.intent as any)?.cta_type || writerBrief?.desiredAction || intent?.cta_type || '-')}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-gray-500">Platforms</div>
              <div className="text-gray-900">
                {suggestedPlatforms.length > 0 ? suggestedPlatforms.map((platform) => labelize(platform)).join(', ') : '-'}
              </div>
            </div>
          </div>
          {creatorCard?.instructions_for_creator && (
            <div className="border-t border-gray-100 pt-3">
              <div className="text-gray-500 text-sm mb-1">Instructions for creator</div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{String(creatorCard.instructions_for_creator)}</div>
            </div>
          )}
          {!creatorCard?.instructions_for_creator && creatorCard?.summary && (
            <div className="border-t border-gray-100 pt-3">
              <div className="text-gray-500 text-sm mb-1">Content brief</div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{String(creatorCard.summary)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Writer Context</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Topic</div>
              <div className="text-gray-900">{payload.topic || payload.title || '-'}</div>
            </div>
            <div>
              <div className="text-gray-500">Objective</div>
              <div className="text-gray-900">{String(intent?.objective || writerBrief?.topicGoal || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">What reader should learn</div>
              <div className="text-gray-900">{effectiveWhatReaderLearns}</div>
            </div>
            <div>
              <div className="text-gray-500">Problem addressed</div>
              <div className="text-gray-900">{effectiveProblemAddressed}</div>
            </div>
            <div>
              <div className="text-gray-500">Desired action</div>
              <div className="text-gray-900">{String(writerBrief?.desiredAction || intent?.cta_type || '-')}</div>
            </div>
            <div>
              <div className="text-gray-500">Narrative style</div>
              <div className="text-gray-900">{String(writerBrief?.narrativeStyle || '-')}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-gray-500">Suggested social media platforms</div>
              <div className="text-gray-900">{suggestedPlatforms.length > 0 ? suggestedPlatforms.map((platform) => labelize(platform)).join(', ') : '-'}</div>
            </div>
          </div>
          {payload.description && (
            <div>
              <div className="text-gray-500 text-sm">Current activity brief</div>
              <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{payload.description}</div>
            </div>
          )}
        </div>
      )}

      {isCreatorActivity && (() => {
        // Phase 3A — wire the existing attachment upload journey for
        // attachment-required creator rows (video/reel/short/podcast).
        // `extractAttachmentRowState` returns null for text/image/carousel/
        // autonomous rows, so the upload UI (gated in CreatorContentPanel on
        // `attachmentRowState && onUploadMedia`) appears ONLY for video-type
        // rows — every other row renders exactly as before. No scheduling or
        // lifecycle logic here: handlers POST to existing endpoints and the
        // backend auto-schedules (autoScheduleReadyCreatorRowById).
        const attachmentRowState = extractAttachmentRowState({
          dailyRaw: (dailyRaw ?? {}) as Record<string, unknown>,
          contentType,
        });
        const resumableUploadHandle = attachmentRowState
          ? detectResumableUploadHandle(attachmentRowState.dailyPlanId)
          : null;
        return (
          <CreatorContentPanel
            theme={topicText || String(payload?.title ?? '')}
            productionBrief={String(writerBrief?.writingIntent ?? payload?.description ?? '')}
            talkingPoints={
              Array.isArray((writerBrief as any)?.key_points) ? (writerBrief as any).key_points
                : Array.isArray((writerBrief as any)?.keyPoints) ? (writerBrief as any).keyPoints
                : []
            }
            contentType={contentType}
            platforms={suggestedPlatforms}
            creatorInstructions={dailyRaw?.creator_instruction as Record<string, unknown> | undefined}
            creatorAsset={creatorAsset as { type: 'video' | 'image' | 'carousel'; url?: string; files?: string[]; platformUploads?: Record<string, { url?: string; externalLink?: string; caption?: string; slides?: string[] }>; description?: string; transcript?: string; theme?: string } | undefined}
            onAssetSaved={handleCreatorAssetSaved}
            onGeneratePromotion={handleGenerateCreatorPromotion}
            isGeneratingPromotion={isGeneratingVariants}
            campaignId={String(payload?.campaignId ?? '')}
            executionId={String(payload?.activityId ?? (dailyRaw?.execution_id ?? ''))}
            weekNumber={Number(payload?.weekNumber) || 1}
            day={String(payload?.day ?? 'Monday')}
            objective={String(intent?.objective || writerBrief?.topicGoal || '')}
            targetAudience={String(creatorCard?.target_audience || writerBrief?.whoAreWeWritingFor || intent?.target_audience || '')}
            existingHashtags={
              Array.isArray(creatorCard?.hashtags) ? (creatorCard.hashtags as string[])
              : Array.isArray((dailyRaw as any)?.hashtags) ? (dailyRaw as any).hashtags as string[]
              : []
            }
            onNotice={notify}
            attachmentRowState={attachmentRowState}
            onUploadMedia={attachmentRowState ? (input) => postUploadMedia({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            onUploadFile={attachmentRowState ? (input) => postUploadFileResumable({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            onReschedule={attachmentRowState ? (input) => postReschedule({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            onUnschedule={attachmentRowState ? (input) => postUnschedule({ ...input, dailyPlanId: attachmentRowState.dailyPlanId }) : undefined}
            resumableUploadHandle={resumableUploadHandle}
            onResumeUpload={attachmentRowState ? (handle) => resumePersistedUpload({ dailyPlanId: attachmentRowState.dailyPlanId, handle, expectedRevision: attachmentRowState.revision }) : undefined}
            onDiscardResumableUpload={attachmentRowState ? (handle) => discardPersistedUploadSession({ dailyPlanId: attachmentRowState.dailyPlanId, handle }) : undefined}
          />
        );
      })()}

      {VIEW_RULES[viewMode].showCreatorBrief && dailyRaw?.creator_instruction && typeof dailyRaw.creator_instruction === 'object' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Creator Brief</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {(dailyRaw.creator_instruction as Record<string, unknown>).objective != null && (
              <div>
                <div className="text-gray-500">Objective</div>
                <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).objective ?? '-')}</div>
              </div>
            )}
            {(dailyRaw.creator_instruction as Record<string, unknown>).targetAudience != null && (
              <div>
                <div className="text-gray-500">Audience</div>
                <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).targetAudience ?? '-')}</div>
              </div>
            )}
            {(dailyRaw.creator_instruction as Record<string, unknown>).keyMessage != null && (
              <div className="md:col-span-2">
                <div className="text-gray-500">Key message</div>
                <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).keyMessage ?? '-')}</div>
              </div>
            )}
            {(dailyRaw.creator_instruction as Record<string, unknown>).expectedOutcome != null && (
              <div className="md:col-span-2">
                <div className="text-gray-500">Expected outcome</div>
                <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).expectedOutcome ?? '-')}</div>
              </div>
            )}
            {(dailyRaw.creator_instruction as Record<string, unknown>).formatHint != null && (
              <div className="md:col-span-2">
                <div className="text-gray-500">Format hint</div>
                <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).formatHint ?? '-')}</div>
              </div>
            )}
            {Array.isArray((dailyRaw.creator_instruction as Record<string, unknown>).executionChecklist) &&
              ((dailyRaw.creator_instruction as Record<string, unknown>).executionChecklist as string[]).length > 0 && (
                <div className="md:col-span-2 space-y-1">
                  <div className="text-gray-500">Execution Checklist</div>
                  <ul className="text-gray-600 text-sm list-disc list-inside space-y-0.5">
                    {((dailyRaw.creator_instruction as Record<string, unknown>).executionChecklist as string[]).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        </div>
      )}

      {VIEW_RULES[viewMode].showSystemFields && dailyRaw && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setSystemBlockExpanded((value) => !value)}
            className="w-full px-5 py-3 flex items-center justify-between text-left text-sm font-medium text-gray-700 hover:bg-gray-50 border-b border-gray-100"
          >
            <span>System Execution Intelligence</span>
            {systemBlockExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {systemBlockExpanded && (
            <div className="p-5 space-y-2 text-xs text-gray-600 grid grid-cols-1 md:grid-cols-2 gap-2">
              {dailyRaw.execution_mode != null && <div><span className="font-medium text-gray-500">execution_mode:</span> {String(dailyRaw.execution_mode)}</div>}
              {dailyRaw.ai_generated != null && <div><span className="font-medium text-gray-500">ai_generated:</span> {String(dailyRaw.ai_generated)}</div>}
              {dailyRaw.master_content_id != null && <div className="md:col-span-2"><span className="font-medium text-gray-500">master_content_id:</span> {String(dailyRaw.master_content_id)}</div>}
              {dailyRaw.narrativeStyle != null && <div className="md:col-span-2"><span className="font-medium text-gray-500">narrativeStyle:</span> {String(dailyRaw.narrativeStyle)}</div>}
              {(dailyRaw.contentGuidance && typeof dailyRaw.contentGuidance === 'object') && <div className="md:col-span-2"><span className="font-medium text-gray-500">contentGuidance:</span> {JSON.stringify(dailyRaw.contentGuidance)}</div>}
              {dailyRaw.weeklyContextCapsule != null && typeof dailyRaw.weeklyContextCapsule === 'object' && <div className="md:col-span-2"><span className="font-medium text-gray-500">weeklyContextCapsule:</span> {JSON.stringify(dailyRaw.weeklyContextCapsule)}</div>}
            </div>
          )}
        </div>
      )}

      {/* AI Improvement Suggestions — shown before platform content cards */}
      <AISuggestionPanel
        companyId={payload?.companyId as string}
        topic={topicText || String(payload?.topic ?? payload?.title ?? '')}
        objective={String(intent?.objective || writerBrief?.topicGoal || '')}
        targetAudience={String(writerBrief?.whoAreWeWritingFor || intent?.target_audience || '')}
        contentType={contentType}
        platform={suggestedPlatforms[0] || 'linkedin'}
        hook={String(intent?.hook || '')}
        keyPoints={Array.isArray(intent?.key_points) ? intent.key_points as string[] : undefined}
        cta={String(writerBrief?.desiredAction || intent?.cta_type || '')}
        narrativeStyle={String(writerBrief?.narrativeStyle || '')}
        onApplySuggestion={(field, value) => {
          // For now, log the applied suggestion — future: update the actual content fields
          console.log('[AI Suggestion Applied]', field, value);
          notify('success', `Applied AI suggestion: ${field}`);
        }}
      />

      <WorkspaceContentPanels d={d} />
      {false && <span className="hidden">{variantStatusDot.pending}{variantStatusLabel.pending}{String(selectedScheduleId)}{JSON.stringify(confidenceByPlatform)}</span>}
    </>
  );
}
