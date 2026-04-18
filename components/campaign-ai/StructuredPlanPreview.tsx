import React from 'react';
import { buildReviewActivityCardsForWeek } from './reviewActivityHelpers';
import { ResolvedPostingMetadata, WeekExecutionTopicCard, WeekPlatformContent } from './StructuredPlanSections';
import type { StructuredPlan, StructuredWeek } from './types';

type Props = {
  plan: StructuredPlan;
  lastCollectedPlanningContextFromApi: Record<string, unknown> | null;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  hasProvidedPlatformContentRequests: boolean;
  planningPlatformContentRequests: Record<string, Record<string, string>>;
  planningCrossPlatformSharingEnabled: boolean;
  planningCrossPlatformScheduleMode: 'same_time' | 'staggered' | 'ai_recommended';
};

function summarizeCreatorInstruction(creatorInstruction: unknown): string | null {
  if (!creatorInstruction || typeof creatorInstruction !== 'object') return null;
  const data = creatorInstruction as Record<string, unknown>;
  const parts = [
    data.targetAudience ? `Audience: ${String(data.targetAudience).trim()}` : '',
    data.objective ? `Goal: ${String(data.objective).trim()}` : '',
    data.deliverable ? `Deliverable: ${String(data.deliverable).trim()}` : '',
    data.visualBrief ? `Visual: ${String(data.visualBrief).trim()}` : '',
    data.hook ? `Hook: ${String(data.hook).trim()}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const summary = parts.join(' | ');
  return summary.length > 220 ? `${summary.slice(0, 219)}...` : summary;
}

function renderWeekPlatformContent(week: StructuredWeek) {
  return <WeekPlatformContent week={week} />;
}

function renderResolvedPostingMetadata(week: StructuredWeek) {
  return <ResolvedPostingMetadata week={week} />;
}

export function StructuredPlanPreview({
  plan,
  lastCollectedPlanningContextFromApi,
  prefilledPlanning,
  collectedPlanningContext,
  hasProvidedPlatformContentRequests,
  planningPlatformContentRequests,
  planningCrossPlatformSharingEnabled,
  planningCrossPlatformScheduleMode,
}: Props) {
  return (
    <div className="space-y-4">
      {plan.weeks.map((week) => {
        const topicsWithExecution = buildReviewActivityCardsForWeek(week, {
          lastCollectedPlanningContextFromApi,
          prefilledPlanning,
          collectedPlanningContext,
          hasProvidedPlatformContentRequests,
          planningPlatformContentRequests,
          planningCrossPlatformSharingEnabled,
          planningCrossPlatformScheduleMode,
        });
        const hasEnrichedTopics = topicsWithExecution.length > 0;
        const hasExecutionStructure =
          (week.platform_allocation && Object.keys(week.platform_allocation).length > 0) ||
          (Array.isArray((week as any)?.execution_items) && (week as any).execution_items.length > 0) ||
          (Array.isArray((week as any)?.resolved_postings) && (week as any).resolved_postings.length > 0) ||
          (Array.isArray((week as any)?.daily_execution_items) && (week as any).daily_execution_items.length > 0) ||
          (((week as any)?.platform_content_breakdown && typeof (week as any).platform_content_breakdown === 'object')
            ? Object.keys((week as any).platform_content_breakdown).length > 0
            : false);
        const isBlueprint = Boolean(hasExecutionStructure || hasEnrichedTopics);
        const themeLabel = week.phase_label || week.theme || `Week ${week.week}`;
        const renderRecFields = () => (
          <>
            {week.summary && (
              <div className="italic text-gray-600 border-l-2 border-emerald-200 pl-2">{week.summary}</div>
            )}
            {week.objectives && week.objectives.length > 0 && (
              <div>
                <div className="text-gray-500 font-medium">Objectives:</div>
                <ul className="list-disc list-inside mt-0.5 text-gray-600">{week.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
              </div>
            )}
            {week.goals && week.goals.length > 0 && (
              <div>
                <div className="text-gray-500 font-medium">Goals:</div>
                <ul className="list-disc list-inside mt-0.5 text-gray-600">{week.goals.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </div>
            )}
            {week.suggested_days_to_post && week.suggested_days_to_post.length > 0 && (
              <div>
                <div className="text-gray-500 font-medium">Suggested posting days:</div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {week.suggested_days_to_post.map((day, i) => (
                    <span key={i} className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-xs">{day}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        );

        return (
          <div key={week.week} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">Week {week.week}</div>
              {themeLabel !== `Week ${week.week}` && (
                <div className="text-xs text-gray-500 text-right max-w-[60%]">{themeLabel}</div>
              )}
            </div>
            {isBlueprint ? (
              <div className="space-y-2 text-xs">
                {week.primary_objective && <div className="text-gray-600">{week.primary_objective}</div>}
                {renderRecFields()}
                {hasEnrichedTopics ? (
                  <div className="space-y-2">
                    {(week as any)?.weeklyContextCapsule && (
                      <div className="rounded border border-indigo-100 bg-indigo-50/50 p-2 text-gray-700">
                        <div><span className="font-medium">Audience:</span> {(week as any).weeklyContextCapsule.audienceProfile || '-'}</div>
                        <div><span className="font-medium">Weekly intent:</span> {(week as any).weeklyContextCapsule.weeklyIntent || '-'}</div>
                        <div><span className="font-medium">Tone:</span> {(week as any).weeklyContextCapsule.toneGuidance || '-'}</div>
                      </div>
                    )}
                    {topicsWithExecution.map((topic, idx) => (
                      <WeekExecutionTopicCard
                        key={`${week.week}-topic-${idx}`}
                        topic={topic as any}
                        idx={idx}
                        creatorInstructionSummary={summarizeCreatorInstruction(topic?.topicExecution?.creator_instruction)}
                      />
                    ))}
                  </div>
                ) : (
                  (week.topics_to_cover?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-gray-500 font-medium">Topics to cover:</div>
                      <ul className="list-disc list-inside mt-0.5">{week.topics_to_cover!.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  )
                )}
                {!hasEnrichedTopics && renderWeekPlatformContent(week)}
                {!hasEnrichedTopics && week.cta_type && <div>CTA: {week.cta_type}</div>}
                {!hasEnrichedTopics && week.weekly_kpi_focus && <div>KPI: {week.weekly_kpi_focus}</div>}
                {renderResolvedPostingMetadata(week)}
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                {(week.daily || []).map((day) => (
                  <div key={`${week.week}-${day.day}`} className="border-t pt-3">
                    <div className="text-sm font-medium text-gray-800">{day.day}</div>
                    <div className="text-xs text-gray-600 mt-1">Objective: {day.objective}</div>
                    <div className="text-xs text-gray-700 mt-1">{day.content}</div>
                    {(day.hook || day.cta || day.best_time) && (
                      <div className="mt-2 text-xs text-gray-600 space-y-1">
                        {day.hook && <div>Hook: {day.hook}</div>}
                        {day.cta && <div>CTA: {day.cta}</div>}
                        {day.best_time && <div>Best time: {day.best_time}</div>}
                      </div>
                    )}
                    {(day.meta_title || day.meta_description || day.seo_keywords?.length) && (
                      <div className="mt-2 text-xs text-gray-600 space-y-1">
                        {day.meta_title && <div>Meta title: {day.meta_title}</div>}
                        {day.meta_description && <div>Meta description: {day.meta_description}</div>}
                        {day.seo_keywords && day.seo_keywords.length > 0 && (
                          <div>SEO keywords: {day.seo_keywords.join(', ')}</div>
                        )}
                      </div>
                    )}
                    {day.hashtags && day.hashtags.length > 0 && (
                      <div className="mt-2 text-xs text-gray-600">
                        Hashtags: {day.hashtags.map((tag) => `#${tag}`).join(' ')}
                      </div>
                    )}
                    {(day.effort_score !== undefined || day.success_projection !== undefined) && (
                      <div className="mt-2 text-xs text-gray-600">
                        {day.effort_score !== undefined && <span>Effort: {day.effort_score}</span>}
                        {day.effort_score !== undefined && day.success_projection !== undefined && <span> - </span>}
                        {day.success_projection !== undefined && <span>Success: {day.success_projection}</span>}
                      </div>
                    )}
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {Object.entries(day.platforms || {}).map(([platform, text]) => (
                        <div key={`${week.week}-${day.day}-${platform}`} className="bg-gray-50 rounded p-2">
                          <div className="text-xs font-semibold text-gray-700 capitalize">{platform}</div>
                          <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {(!week.daily || week.daily.length === 0) && (
                  <div className="space-y-2">
                    {week.primary_objective && <div className="text-gray-600">{week.primary_objective}</div>}
                    {renderRecFields()}
                    {(week.topics_to_cover?.length ?? 0) > 0 && (
                      <div>
                        <div className="text-gray-500 font-medium">Topics to cover:</div>
                        <ul className="list-disc list-inside mt-0.5 text-gray-600">{week.topics_to_cover!.map((t, i) => <li key={i}>{t}</li>)}</ul>
                      </div>
                    )}
                    {renderWeekPlatformContent(week)}
                    {week.cta_type && <div className="text-gray-600">CTA: {week.cta_type}</div>}
                    {week.weekly_kpi_focus && <div className="text-gray-600">KPI: {week.weekly_kpi_focus}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
