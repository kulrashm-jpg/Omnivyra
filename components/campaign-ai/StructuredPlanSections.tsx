import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { StructuredWeek } from './types';
import { getFormatLineForContentType, getIntentLabelForContentType } from '../../utils/formatLineForContentType';

export type WeeklyExecutionTopic = {
  topicTitle?: string;
  topicContext?: { writingIntent?: string };
  topicExecution?: {
    contentType?: string;
    platformTargets?: string[];
    ctaType?: string;
    kpiFocus?: string;
    creator_instruction?: unknown;
  };
  whoAreWeWritingFor?: string;
  whatProblemAreWeAddressing?: string;
  whatShouldReaderLearn?: string;
  desiredAction?: string;
  narrativeStyle?: string;
  contentTypeGuidance?: unknown;
  content_type?: string;
};

export function WeekPlatformContent({ week }: { week: StructuredWeek }) {
  const breakdown = week.platform_content_breakdown;
  if (breakdown && Object.keys(breakdown).length > 0) {
    return (
      <div className="space-y-1">
        <div className="text-gray-500 font-medium">Platforms & content types:</div>
        {(() => {
          const platformAlloc = week.platform_allocation || {};
          const platformKeys = [...new Set([...Object.keys(breakdown), ...Object.keys(platformAlloc)])];
          return platformKeys.map((platform) => {
            const directItems = breakdown[platform] || [];
            const sharedFromOthers = Object.entries(breakdown).flatMap(([p, items]) =>
              p === platform ? [] : items.filter((it) => (it.platforms || [p]).includes(platform))
            );
            const seen = new Set<string>();
            const allItems = [...directItems, ...sharedFromOthers].filter((it) => {
              const key = `${it.type}-${it.topics?.[0] ?? it.topic ?? ''}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            if (allItems.length === 0) return null;
            return (
              <div key={platform} className="border-l-2 border-indigo-100 pl-2">
                <span className="font-medium capitalize text-gray-700">{platform}:</span>
                <div className="mt-0.5 space-y-1 text-gray-600">
                  {allItems.map((it, idx) => {
                    const topics = it.topics || (it.topic ? [it.topic] : []);
                    const label = it.count > 1 ? `${it.type} (${it.count})` : it.type;
                    const shared = (it.platforms?.length ?? 0) > 1;
                    return (
                      <div key={idx} className="text-xs">
                        <span className="font-medium">{label}</span>
                        {shared && <span className="ml-1 text-indigo-600">(shared)</span>}
                        {topics.length > 0 && (
                          <ul className="list-decimal list-inside mt-0.5 ml-1">{topics.map((t, i) => <li key={i}>{t}</li>)}</ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>
    );
  }

  const platforms = week.platform_allocation ? Object.entries(week.platform_allocation) : [];
  const contentTypes = week.content_type_mix || [];
  if (platforms.length === 0 && contentTypes.length === 0) return <span className="text-gray-400">-</span>;
  return (
    <div className="space-y-1">
      {platforms.length > 0 && (
        <div>
          <div className="text-gray-500 font-medium">Platforms (items per week):</div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {platforms.map(([p, n]) => (
              <span key={p} className="bg-gray-100 px-2 py-0.5 rounded capitalize">{p}: {n}</span>
            ))}
          </div>
        </div>
      )}
      {contentTypes.length > 0 && (
        <div>
          <div className="text-gray-500 font-medium">Content to create:</div>
          <ul className="list-disc list-inside mt-0.5 text-gray-600">{contentTypes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function ResolvedPostingMetadata({ week }: { week: StructuredWeek }) {
  const postings = Array.isArray((week as any)?.resolved_postings) ? (week as any).resolved_postings : [];
  if (postings.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-gray-500 font-medium text-xs">Resolved postings:</div>
      {postings.map((posting: any, idx: number) => {
        const executionId = String(posting?.execution_id ?? '').trim();
        const narrativeRole = String(posting?.narrative_role ?? '').trim();
        const progressionStep = Number(posting?.progression_step);
        const globalIdx = Number(posting?.global_progression_index);
        const formatFamily = String(posting?.writer_content_brief?.format_requirements?.format_family ?? '').trim();
        const alignmentReason = Array.isArray(posting?.alignment_reason)
          ? posting.alignment_reason.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
          : [];
        const topicLabel = String(posting?.topic ?? '').trim() || `Posting ${idx + 1}`;
        const platformLabel = String(posting?.platform ?? '').trim() || 'unknown platform';
        const contentTypeLabel = String(posting?.content_type ?? '').trim() || 'unknown content type';
        return (
          <div key={String(posting?.posting_id ?? `${week.week}-resolved-${idx}`)} className="rounded border border-gray-200 p-2">
            <div className="text-gray-700 text-xs">
              <span className="font-medium">{topicLabel}</span> • {platformLabel} • {contentTypeLabel}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              {executionId ? (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-700">
                  {executionId}
                </span>
              ) : null}
              {narrativeRole ? (
                <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700">
                  {narrativeRole}
                </span>
              ) : null}
              {(Number.isFinite(progressionStep) || Number.isFinite(globalIdx)) ? (
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">
                  Step {Number.isFinite(progressionStep) ? progressionStep : '-'} / #{Number.isFinite(globalIdx) ? globalIdx : '-'}
                </span>
              ) : null}
              {formatFamily ? (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                  {formatFamily}
                </span>
              ) : null}
              {posting?.format_validation_warning ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                  <AlertCircle className="h-3 w-3" />
                  Format warning
                </span>
              ) : null}
            </div>
            {alignmentReason.length > 0 ? (
              <details className="mt-1 text-[11px]">
                <summary className="cursor-pointer text-gray-500">Alignment reason</summary>
                <ul className="list-disc list-inside text-gray-600 mt-0.5">
                  {alignmentReason.map((reason: string, reasonIdx: number) => (
                    <li key={reasonIdx}>{reason}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function WeekExecutionTopicCard({
  topic,
  idx,
  creatorInstructionSummary,
}: {
  topic: WeeklyExecutionTopic;
  idx: number;
  creatorInstructionSummary?: string | null;
}) {
  return (
    <div className="rounded border border-gray-200 p-2">
      <div className="font-medium text-gray-900">{topic.topicTitle || `Topic ${idx + 1}`}</div>
      <div className="text-gray-600">{getIntentLabelForContentType(topic?.topicExecution?.contentType ?? (topic as any)?.content_type)}: {topic?.topicContext?.writingIntent || '-'} </div>
      <div className="text-gray-600">Platform(s): {(topic.topicExecution?.platformTargets || []).join(', ')}</div>
      <div className="text-gray-600">Content type: {topic.topicExecution?.contentType || '-'}</div>
      <div className="text-gray-600">CTA: {topic.topicExecution?.ctaType || '-'} • KPI: {topic.topicExecution?.kpiFocus || '-'}</div>
      <div className="text-gray-600">Who: {topic.whoAreWeWritingFor || '-'}</div>
      <div className="text-gray-600">Problem: {topic.whatProblemAreWeAddressing || '-'}</div>
      <div className="text-gray-600">Learns: {topic.whatShouldReaderLearn || '-'}</div>
      <div className="text-gray-600">Action: {topic.desiredAction || '-'}</div>
      <div className="text-gray-600">Style: {topic.narrativeStyle || '-'}</div>
      {creatorInstructionSummary && <div className="text-gray-600">Creator brief: {creatorInstructionSummary}</div>}
      <div className="text-gray-600">
        {getFormatLineForContentType(
          topic?.topicExecution?.contentType ?? (topic as any)?.contentType ?? (topic as any)?.content_type,
          topic?.contentTypeGuidance,
          topic?.topicExecution?.platformTargets
        )}
      </div>
    </div>
  );
}
