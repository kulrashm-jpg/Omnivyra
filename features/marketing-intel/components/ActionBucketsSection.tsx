import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { ACTION_CFG } from '@/features/marketing-intel/constants';
import { scoreColour } from '@/features/marketing-intel/hooks/viewModel.helpers';
import { derivePrimaryBottleneck } from '@/features/marketing-intel/derives';
import { deriveSystemActionLines } from '@/features/marketing-intel/actionLines';
import {
  type ActionProgressEntry,
  type ActionOutcomeBaseline,
  MARKETING_INTEL_PROGRESS_STORAGE_KEY,
  MARKETING_INTEL_OUTCOME_STORAGE_KEY,
  STALE_ACTION_MS,
  splitActionBuckets,
  deriveCurrentDoNowItems,
  normalizeActionProgress,
  normalizeOutcomeBaselines,
  buildActionProgressEntry,
  deriveOutcomeSignals,
  getActionCompletionFeedback,
  getRecommendedActionReason,
  deriveOutcomeMessages,
} from '@/features/marketing-intel/outcomeTracking';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function ActionBucketsSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const actions = snapshot.next_actions;
  const buckets = splitActionBuckets(actions);
  const systemLines = deriveSystemActionLines(snapshot);
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const constraintLabel = bottleneck.title.toLowerCase().includes('operating rhythm')
    ? 'inconsistent operating rhythm'
    : bottleneck.title.toLowerCase();
  const doNowItems = React.useMemo(() => deriveCurrentDoNowItems(snapshot), [snapshot]);
  const [actionProgress, setActionProgress] = React.useState<Record<string, ActionProgressEntry>>({});
  const [outcomeBaselines, setOutcomeBaselines] = React.useState<Record<string, ActionOutcomeBaseline>>({});

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_PROGRESS_STORAGE_KEY);
      if (saved) {
        setActionProgress(normalizeActionProgress(JSON.parse(saved)));
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY);
      if (saved) {
        setOutcomeBaselines(normalizeOutcomeBaselines(JSON.parse(saved)));
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MARKETING_INTEL_PROGRESS_STORAGE_KEY, JSON.stringify(actionProgress));
    } catch {}
  }, [actionProgress]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY, JSON.stringify(outcomeBaselines));
    } catch {}
  }, [outcomeBaselines]);

  React.useEffect(() => {
    setActionProgress((prev) => {
      const next: Record<string, ActionProgressEntry> = {};
      doNowItems.forEach((item) => {
        next[item.id] = prev[item.id] ?? buildActionProgressEntry('not_started');
      });
      return next;
    });
  }, [doNowItems]);

  const completedCount = doNowItems.filter((item) => actionProgress[item.id]?.status === 'completed').length;
  const recommendedNextAction =
    doNowItems.find((item) => actionProgress[item.id]?.status !== 'completed') ??
    doNowItems[0] ??
    (systemLines.doNext[0]
      ? {
          id: systemLines.doNext[0].label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          label: systemLines.doNext[0].text,
          href: systemLines.doNext[0].href,
          ctaLabel: systemLines.doNext[0].label,
        }
      : null);
  const markActionCompleted = (itemId: string, previous?: ActionProgressEntry) => {
    setActionProgress((prev) => ({
      ...prev,
      [itemId]: buildActionProgressEntry('completed', previous ?? prev[itemId]),
    }));

    setOutcomeBaselines((prev) => {
      if (prev[itemId]) return prev;
      return {
        ...prev,
        [itemId]: {
          capturedAt: new Date().toISOString(),
          signals: deriveOutcomeSignals(snapshot),
        },
      };
    });
  };
  const groups = [
    {
      key: 'do-now',
      title: 'Do now',
      items: buckets.doNow,
      systemItems: systemLines.doNow,
      tone: 'border-[#FECACA] bg-[#FEF2F2]',
      text: 'text-red-800',
      empty: 'No urgent action is blocking progress right now.',
    },
    {
      key: 'do-next',
      title: 'Do next',
      items: buckets.doNext,
      systemItems: systemLines.doNext,
      tone: 'border-[#E2E8F0] bg-[#F8FAFC]/95',
      text: 'text-blue-600',
      empty: 'No medium-priority follow-up actions are waiting.',
    },
  ] as const;

  return (
    <SectionCard title="Action Plan" badge="Do now + do next">
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <p className="text-sm leading-relaxed text-gray-700">
          To fix <span className="font-semibold text-gray-900">{constraintLabel}</span>:
        </p>
      </div>
      {recommendedNextAction && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50/70 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-700">Recommended next action</p>
          <p className="mt-1 text-xs font-medium text-red-700/80">
            {completedCount} of {doNowItems.length} actions completed — next: {recommendedNextAction.ctaLabel}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-red-950">{recommendedNextAction.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-red-700/70">
                → {getRecommendedActionReason(recommendedNextAction).charAt(0).toLowerCase() + getRecommendedActionReason(recommendedNextAction).slice(1)}
              </p>
            </div>
            <SectionCta href={recommendedNextAction.href} label={recommendedNextAction.ctaLabel} variant="critical" />
          </div>
        </div>
      )}
      <div className="mb-4 text-xs font-medium text-gray-600">
        Progress: {completedCount} / {doNowItems.length} actions completed
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {groups.map((group) => (
          <div key={group.key} className={`rounded-xl border p-4 ${group.tone}`}>
            <p className={`${group.key === 'do-now' ? 'text-[10px]' : 'text-[9px]'} font-bold uppercase tracking-widest ${group.text}`}>{group.title}</p>
            <div className="mt-3 space-y-3">
              {group.key === 'do-now' ? (
                doNowItems.length > 0 ? (
                  doNowItems.map((item) => {
                    const progress = actionProgress[item.id] ?? buildActionProgressEntry('not_started');
                    const status = progress.status;
                    const isCompleted = status === 'completed';
                    const isInProgress = status === 'in_progress';
                    const isStale = !isCompleted && Date.now() - new Date(progress.updatedAt).getTime() > STALE_ACTION_MS;

                    return (
                      <div key={item.id} className={`space-y-2.5 py-1 transition-opacity ${isCompleted ? 'opacity-70' : 'opacity-100'}`}>
                        <p className="text-sm font-semibold text-red-950">{item.label}</p>
                        {isStale && (
                          <p className="text-xs font-medium text-red-700">
                            {isInProgress ? 'This action is still pending.' : 'No progress made on this critical action yet.'}
                          </p>
                        )}
                        {isInProgress && !isCompleted && (
                          <p className="text-xs font-medium text-blue-700">In progress...</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {isCompleted ? (
                            <>
                              <span className="inline-flex items-center rounded-[8px] bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                &#10003; Completed
                              </span>
                              <span className="text-xs font-medium text-emerald-700/90">
                                {getActionCompletionFeedback(item)}
                              </span>
                            </>
                          ) : (
                            <>
                              <Link
                                href={item.href}
                                onClick={() =>
                                  setActionProgress((prev) => ({
                                    ...prev,
                                    [item.id]: buildActionProgressEntry('in_progress', prev[item.id]),
                                  }))
                                }
                                className="inline-flex items-center gap-1.5 rounded-[8px] border border-transparent bg-[#DC2626] px-4 py-2 text-xs font-semibold tracking-[0.2px] text-white shadow-sm transition-all duration-150 ease-out hover:-translate-y-[1px] hover:bg-[#B91C1C]"
                              >
                                {item.ctaLabel}
                                <ArrowRight className="h-3 w-3" />
                              </Link>
                              <button
                                type="button"
                                onClick={() => markActionCompleted(item.id, progress)}
                                className="inline-flex items-center rounded-[8px] border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition-all duration-150 ease-out hover:-translate-y-[1px] hover:border-red-300 hover:bg-red-50"
                              >
                                Mark as done &#10003;
                              </button>
                            </>
                          )}
                        </div>
                        {isCompleted && (
                          <div className="space-y-1 rounded-lg bg-white/50 px-3 py-2">
                            <p className="text-[11px] font-semibold text-gray-600">After this action:</p>
                            {deriveOutcomeMessages(item, outcomeBaselines[item.id], snapshot).map((line) => (
                              <p key={`${item.id}-${line}`} className="text-xs text-gray-600">
                                {line}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-gray-500">{group.empty}</p>
                )
              ) : group.systemItems.length > 0 ? (
                group.systemItems.slice(0, 2).map((item) => (
                  <div key={`${group.key}-${item.text}`} className="rounded-lg bg-white/80 p-3">
                    <p className="text-xs font-semibold text-gray-800">{item.text}</p>
                    <div className="mt-2">
                      <SectionCta href={item.href} label={item.label} variant="secondary" />
                    </div>
                  </div>
                ))
              ) : null}
              {group.key !== 'do-now' && group.items.length > 0 ? (
                group.items.slice(0, 3).map((action) => (
                  <div key={`${group.key}-${action.campaign_id}`} className="rounded-lg bg-white/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-800">{action.campaign_name}</p>
                        <p className="mt-1 text-[11px] capitalize text-gray-500">
                          {ACTION_CFG[action.action].label}
                          {action.next_topic ? ` around ${action.next_topic}` : ''}
                        </p>
                      </div>
                      {action.evaluation_score != null && (
                        <span className={`text-xs font-bold ${scoreColour(action.evaluation_score)}`}>{action.evaluation_score}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : group.systemItems.length === 0 ? (
                <p className="text-xs text-gray-500">{group.empty}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
