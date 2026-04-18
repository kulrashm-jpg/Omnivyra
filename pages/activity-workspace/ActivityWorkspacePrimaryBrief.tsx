import React from 'react';
import CreatorContentPanel from '@/components/activity-workspace/CreatorContentPanel';
import type { WorkspacePayload } from './types';

type ActivityWorkspacePrimaryBriefProps = {
  isCreatorActivity: boolean;
  contentType: string;
  creatorCard: Record<string, unknown> | null;
  topicText: string;
  payload: WorkspacePayload;
  intent: Record<string, unknown>;
  writerBrief: Record<string, unknown>;
  suggestedPlatforms: string[];
  labelize: (value: string) => string;
  effectiveWhatReaderLearns: string;
  effectiveProblemAddressed: string;
  dailyRaw: Record<string, unknown>;
  creatorAsset:
    | {
        type: 'video' | 'image' | 'carousel';
        url?: string;
        files?: string[];
        platformUploads?: Record<string, { url?: string; externalLink?: string; caption?: string; slides?: string[] }>;
        description?: string;
        transcript?: string;
        theme?: string;
      }
    | undefined;
  onAssetSaved: (asset: { type: string; url?: string; files?: string[]; description?: string; transcript?: string; theme?: string }) => void;
  onGeneratePromotion: () => Promise<void>;
  isGeneratingPromotion: boolean;
  campaignId: string;
  executionId: string;
  weekNumber: number;
  day: string;
  objective: string;
  targetAudience: string;
  existingHashtags: string[];
  onNotice: (type: 'success' | 'error' | 'info', message: string) => void;
};

export default function ActivityWorkspacePrimaryBrief({
  isCreatorActivity,
  contentType,
  creatorCard,
  topicText,
  payload,
  intent,
  writerBrief,
  suggestedPlatforms,
  labelize,
  effectiveWhatReaderLearns,
  effectiveProblemAddressed,
  dailyRaw,
  creatorAsset,
  onAssetSaved,
  onGeneratePromotion,
  isGeneratingPromotion,
  campaignId,
  executionId,
  weekNumber,
  day,
  objective,
  targetAudience,
  existingHashtags,
  onNotice,
}: ActivityWorkspacePrimaryBriefProps) {
  return (
    <>
      {isCreatorActivity ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Creator Brief</h2>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
              {contentType.charAt(0).toUpperCase() + contentType.slice(1)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
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
              <div className="text-gray-900">{suggestedPlatforms.length > 0 ? suggestedPlatforms.map((p) => labelize(p)).join(', ') : '-'}</div>
            </div>
            {(creatorCard?.keywords as string[] | undefined)?.length ? (
              <div className="md:col-span-2">
                <div className="text-gray-500">Keywords</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(creatorCard?.keywords as string[]).map((keyword) => (
                    <span key={keyword} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{keyword}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {(creatorCard?.hashtags as string[] | undefined)?.length ? (
              <div className="md:col-span-2">
                <div className="text-gray-500">Suggested hashtags</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(creatorCard?.hashtags as string[]).map((hashtag) => (
                    <span key={hashtag} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                      {hashtag.startsWith('#') ? hashtag : `#${hashtag}`}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {(() => {
            const narrativeStyle = String((creatorCard?.intent as any)?.narrative_style || writerBrief?.narrativeStyle || '');
            const painPoint = String((creatorCard?.intent as any)?.pain_point || intent?.pain_point || '');
            const outcomePromise = String((creatorCard?.intent as any)?.outcome_promise || intent?.outcome_promise || '');
            const briefSummary = String((creatorCard?.intent as any)?.brief_summary || creatorCard?.summary || writerBrief?.writingIntent || '');
            const keywords = (creatorCard?.keywords as string[] | undefined) ?? [];

            if (['video'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Video Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Hook concept (first 5-10s)</div><div className="text-gray-900">{painPoint || briefSummary || '-'}</div></div>
                    <div><div className="text-gray-500">Estimated duration</div><div className="text-gray-900">3-8 minutes</div></div>
                    <div><div className="text-gray-500">Visual style</div><div className="text-gray-900">{narrativeStyle || 'Conversational, on-camera or screen-record'}</div></div>
                    <div><div className="text-gray-500">Voiceover / talking points</div><div className="text-gray-900">{outcomePromise || briefSummary || '-'}</div></div>
                    {keywords.length > 0 && <div className="md:col-span-2"><div className="text-gray-500">B-roll suggestions</div><div className="text-gray-900">Visuals related to: {keywords.slice(0, 6).join(', ')}</div></div>}
                  </div>
                </div>
              );
            }

            if (['reel', 'short'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Reel / Short Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Hook (first 3s)</div><div className="text-gray-900">{painPoint || briefSummary || '-'}</div></div>
                    <div><div className="text-gray-500">Target duration</div><div className="text-gray-900">15-60 seconds</div></div>
                    <div><div className="text-gray-500">Music / audio vibe</div><div className="text-gray-900">{narrativeStyle ? `Match the ${narrativeStyle.toLowerCase()} tone` : 'Upbeat, trending audio'}</div></div>
                    <div><div className="text-gray-500">Caption style</div><div className="text-gray-900">Punchy, on-screen text overlays - mirror spoken words</div></div>
                    <div className="md:col-span-2"><div className="text-gray-500">Core message</div><div className="text-gray-900">{outcomePromise || briefSummary || '-'}</div></div>
                  </div>
                </div>
              );
            }

            if (['carousel'].includes(contentType)) {
              const slideCount = Math.min(Math.max(keywords.length + 2, 5), 10);
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Carousel Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Suggested slide count</div><div className="text-gray-900">{slideCount} slides</div></div>
                    <div><div className="text-gray-500">Visual theme</div><div className="text-gray-900">{narrativeStyle || 'Clean, branded layout with consistent typography'}</div></div>
                    <div className="md:col-span-2"><div className="text-gray-500">Slide flow</div><div className="text-gray-900">Slide 1: Hook / bold statement - Slides 2-{slideCount - 1}: {keywords.length > 0 ? keywords.slice(0, slideCount - 2).join(' -> ') : 'Key points / value delivery'} - Slide {slideCount}: CTA</div></div>
                    <div className="md:col-span-2"><div className="text-gray-500">Key message per slide</div><div className="text-gray-900">{briefSummary || outcomePromise || '-'}</div></div>
                  </div>
                </div>
              );
            }

            if (['image', 'infographic'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Image / Graphic Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Key message</div><div className="text-gray-900">{briefSummary || painPoint || '-'}</div></div>
                    <div><div className="text-gray-500">Visual style</div><div className="text-gray-900">{narrativeStyle || 'On-brand, high-contrast, minimal text'}</div></div>
                    <div><div className="text-gray-500">Outcome to convey</div><div className="text-gray-900">{outcomePromise || '-'}</div></div>
                    <div><div className="text-gray-500">Design notes</div><div className="text-gray-900">Use brand colours - headline + supporting visual - CTA overlay optional</div></div>
                  </div>
                </div>
              );
            }

            if (['podcast'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Podcast Episode Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Episode angle</div><div className="text-gray-900">{painPoint || briefSummary || '-'}</div></div>
                    <div><div className="text-gray-500">Listener takeaway</div><div className="text-gray-900">{outcomePromise || '-'}</div></div>
                    <div><div className="text-gray-500">Tone / format</div><div className="text-gray-900">{narrativeStyle || 'Conversational interview or solo deep-dive'}</div></div>
                    {keywords.length > 0 && <div className="md:col-span-2"><div className="text-gray-500">Key talking points</div><div className="text-gray-900">{keywords.slice(0, 8).join(', ')}</div></div>}
                  </div>
                </div>
              );
            }

            if (['story'].includes(contentType)) {
              return (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Story Production Guide</div>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><div className="text-gray-500">Story arc</div><div className="text-gray-900">Hook frame {'->'} Value reveal {'->'} Swipe-up / link CTA</div></div>
                    <div><div className="text-gray-500">Visual style</div><div className="text-gray-900">{narrativeStyle || 'Vertical 9:16 - bold text overlays - on-brand palette'}</div></div>
                    <div><div className="text-gray-500">Core message</div><div className="text-gray-900">{briefSummary || painPoint || '-'}</div></div>
                    <div><div className="text-gray-500">Interactive elements</div><div className="text-gray-900">Poll, question sticker, or countdown timer where applicable</div></div>
                  </div>
                </div>
              );
            }

            return null;
          })()}

          {creatorCard?.instructions_for_creator && (
            <div className="border-t border-gray-100 pt-3">
              <div className="mb-1 text-sm text-gray-500">Instructions for creator</div>
              <div className="whitespace-pre-wrap text-sm text-gray-800">{String(creatorCard.instructions_for_creator)}</div>
            </div>
          )}
          {!creatorCard?.instructions_for_creator && creatorCard?.summary && (
            <div className="border-t border-gray-100 pt-3">
              <div className="mb-1 text-sm text-gray-500">Content brief</div>
              <div className="whitespace-pre-wrap text-sm text-gray-800">{String(creatorCard.summary)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Writer Context</h2>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div><div className="text-gray-500">Topic</div><div className="text-gray-900">{payload.topic || payload.title || '-'}</div></div>
            <div><div className="text-gray-500">Objective</div><div className="text-gray-900">{String(intent?.objective || writerBrief?.topicGoal || '-')}</div></div>
            <div><div className="text-gray-500">What reader should learn</div><div className="text-gray-900">{effectiveWhatReaderLearns}</div></div>
            <div><div className="text-gray-500">Problem addressed</div><div className="text-gray-900">{effectiveProblemAddressed}</div></div>
            <div><div className="text-gray-500">Desired action</div><div className="text-gray-900">{String(writerBrief?.desiredAction || intent?.cta_type || '-')}</div></div>
            <div><div className="text-gray-500">Narrative style</div><div className="text-gray-900">{String(writerBrief?.narrativeStyle || '-')}</div></div>
            <div className="md:col-span-2"><div className="text-gray-500">Suggested social media platforms</div><div className="text-gray-900">{suggestedPlatforms.length > 0 ? suggestedPlatforms.map((p) => labelize(p)).join(', ') : '-'}</div></div>
          </div>
          {payload.description && (
            <div>
              <div className="text-sm text-gray-500">Current activity brief</div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{payload.description}</div>
            </div>
          )}
        </div>
      )}

      {isCreatorActivity && (
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
          creatorAsset={creatorAsset}
          onAssetSaved={onAssetSaved}
          onGeneratePromotion={onGeneratePromotion}
          isGeneratingPromotion={isGeneratingPromotion}
          campaignId={campaignId}
          executionId={executionId}
          weekNumber={weekNumber}
          day={day}
          objective={objective}
          targetAudience={targetAudience}
          existingHashtags={existingHashtags}
          onNotice={onNotice}
        />
      )}
    </>
  );
}
