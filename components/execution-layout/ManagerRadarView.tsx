/**
 * Campaign Radar View — consumes health engine output only.
 * Shows: health summary cards, stage radar, attention feed.
 * Weekly summary refreshes on workflow events; throttled (max once per 5 min) with subtle "Summary updated" indicator.
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  LayoutGrid,
  Clock,
  AlertTriangle,
  CalendarCheck,
  CheckCircle,
  AlertCircle,
  UserX,
} from 'lucide-react';
import { FileText, Lightbulb } from 'lucide-react';
import type { Activity } from '../activity-board/types';
import type { CampaignHealth, AttentionReason } from '../../lib/campaign-health-engine';
import { getRecommendedActions, generateWeeklySummaryNarrative } from '../../lib/campaign-health-engine';

/** Throttle: max one narrative refresh per 5 minutes (workflow-driven). */
const NARRATIVE_REFRESH_THROTTLE_MS = 5 * 60 * 1000;
const SUMMARY_UPDATED_INDICATOR_DURATION_MS = 4000;

const STAGE_COLOR_CLASSES: Record<string, string> = {
  PLAN: 'bg-blue-100 text-blue-800 border-blue-200',
  CREATE: 'bg-purple-100 text-purple-800 border-purple-200',
  REPURPOSE: 'bg-orange-100 text-orange-800 border-orange-200',
  SCHEDULE: 'bg-teal-100 text-teal-800 border-teal-200',
  SHARE: 'bg-green-100 text-green-800 border-green-200',
};

export interface ManagerRadarViewProps {
  /** Engine output; no aggregation in this component */
  health: CampaignHealth;
  /** Activities for this campaign (used only to resolve first activity per stage on stage click) */
  activities: Activity[];
  selectedActivityId: string | null;
  onSelectActivity: (activityId: string) => void;
  /** Show weekly summary narrative (CMO / manager view). Default false. */
  showWeeklyNarrative?: boolean;
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  colorClass,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  colorClass: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 flex items-center gap-3">
      <span className={`p-2 rounded-lg ${colorClass}`}>
        <Icon className="w-4 h-4" />
      </span>
      <div>
        <div className="text-lg font-semibold text-gray-900 tabular-nums">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

export default function ManagerRadarView({
  health,
  activities,
  selectedActivityId,
  onSelectActivity,
  showWeeklyNarrative = false,
}: ManagerRadarViewProps) {
  const firstActivityByStage = useMemo(() => {
    const map: Record<string, Activity | undefined> = {};
    for (const a of activities) {
      if (map[a.stage] == null) map[a.stage] = a;
    }
    return map;
  }, [activities]);

  const recommendedActions = useMemo(
    () => getRecommendedActions(health, activities, 3),
    [health, activities]
  );

  const computedNarrative = useMemo(
    () => (showWeeklyNarrative ? generateWeeklySummaryNarrative(health, activities) : null),
    [showWeeklyNarrative, health, activities]
  );

  const [displayedNarrative, setDisplayedNarrative] = useState<typeof computedNarrative>(computedNarrative);
  const [showUpdatedIndicator, setShowUpdatedIndicator] = useState(false);
  const lastNarrativeUpdateRef = useRef(0);

  useEffect(() => {
    if (computedNarrative == null) {
      setDisplayedNarrative(null);
      return;
    }
    const now = Date.now();
    const throttlePassed =
      now - lastNarrativeUpdateRef.current >= NARRATIVE_REFRESH_THROTTLE_MS || lastNarrativeUpdateRef.current === 0;
    if (throttlePassed) {
      const isRefresh = lastNarrativeUpdateRef.current > 0;
      lastNarrativeUpdateRef.current = now;
      setDisplayedNarrative(computedNarrative);
      if (isRefresh) {
        setShowUpdatedIndicator(true);
        const t = setTimeout(() => setShowUpdatedIndicator(false), SUMMARY_UPDATED_INDICATOR_DURATION_MS);
        return () => clearTimeout(t);
      }
    }
  }, [computedNarrative]);

  const weeklyNarrative = displayedNarrative;

  const { totalActivities, overdueCount, blockedCount, pendingApprovalCount, scheduledCount, stageHealthSummary, attentionItems } = health;

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-6 overflow-y-auto">
      {/* Weekly Summary Narrative (top; CMO / manager only; throttled refresh) */}
      {weeklyNarrative && (
        <section aria-label="Weekly summary" className="flex-shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-indigo-500" />
              Weekly Summary
            </h3>
            {showUpdatedIndicator && (
              <span className="text-xs text-gray-500 italic" aria-live="polite">
                Summary updated
              </span>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-indigo-50/50 p-4 text-sm text-gray-800 space-y-2">
            {weeklyNarrative.positiveSignal != null && (
              <p className="text-indigo-800">{weeklyNarrative.positiveSignal}</p>
            )}
            <p>{weeklyNarrative.overallHealth}</p>
            <p>{weeklyNarrative.whatIsWorking}</p>
            <p>{weeklyNarrative.needsAttention}</p>
            <p>{weeklyNarrative.recommendedFocus}</p>
          </div>
        </section>
      )}

      {/* Recommended Actions (top of radar) */}
      {recommendedActions.length > 0 && (
        <section aria-label="Recommended actions" className="flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            Recommended Actions
          </h3>
          <ul className="space-y-2">
            {recommendedActions.map((action) => (
              <li key={action.activityId}>
                <div className="rounded-lg border border-gray-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{action.activityTitle}</div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      <span className="font-medium">{action.actionLabel}</span>
                      <span className="text-gray-500"> — {action.reason}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectActivity(action.activityId)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                  >
                    Open Activity
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 1. Health Summary Cards (from engine) */}
      <section aria-label="Health summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard
            label="Total Activities"
            value={totalActivities}
            icon={LayoutGrid}
            colorClass="bg-gray-100 text-gray-700"
          />
          <SummaryCard
            label="Pending Approval"
            value={pendingApprovalCount}
            icon={CheckCircle}
            colorClass="bg-amber-100 text-amber-700"
          />
          <SummaryCard
            label="Blocked"
            value={blockedCount}
            icon={AlertTriangle}
            colorClass="bg-red-100 text-red-700"
          />
          <SummaryCard
            label="Overdue"
            value={overdueCount}
            icon={Clock}
            colorClass="bg-red-100 text-red-700"
          />
          <SummaryCard
            label="Scheduled"
            value={scheduledCount}
            icon={CalendarCheck}
            colorClass="bg-teal-100 text-teal-700"
          />
        </div>
      </section>

      {/* 2. Stage Radar (from engine stageHealthSummary) */}
      <section aria-label="Stage radar">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">By stage</h3>
        <div className="flex flex-wrap gap-2">
          {stageHealthSummary.map((item) => {
            const first = firstActivityByStage[item.stage];
            return (
              <button
                key={item.stage}
                type="button"
                onClick={() => first && onSelectActivity(first.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  item.hasIssues ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                } ${selectedActivityId && first?.id === selectedActivityId ? 'ring-2 ring-indigo-500' : ''}`}
                title={item.hasIssues ? `${item.overdueCount} overdue, ${item.blockedCount} blocked` : undefined}
              >
                <span className={item.hasIssues ? 'text-amber-600' : ''}>{item.stage}</span>
                <span className="tabular-nums text-gray-600">({item.count})</span>
                {item.hasIssues && <AlertCircle className="w-3.5 h-3.5 text-amber-600" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. Attention Feed (from engine attentionItems) */}
      <section className="flex-1 min-h-0 flex flex-col" aria-label="Attention feed">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Needs action</h3>
        <ul className="flex-1 min-h-0 overflow-y-auto space-y-1 border border-gray-200 rounded-lg bg-gray-50/50 p-2">
          {attentionItems.length === 0 ? (
            <li className="text-sm text-gray-500 py-4 text-center">No items needing action</li>
          ) : (
            attentionItems.map((item) => (
              <li key={item.activityId}>
                <button
                  type="button"
                  onClick={() => onSelectActivity(item.activityId)}
                  className={`w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    selectedActivityId === item.activityId
                      ? 'bg-indigo-100 text-indigo-900'
                      : 'hover:bg-white border border-transparent hover:border-gray-200'
                  }`}
                >
                  <AttentionReasonIcon reason={item.reason} />
                  <span className="truncate flex-1">{item.activity.title || 'Untitled'}</span>
                  <span className="text-xs text-gray-500 shrink-0">{item.activity.stage}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

function AttentionReasonIcon({ reason }: { reason: AttentionReason }) {
  const cls = 'w-3.5 h-3.5 shrink-0';
  switch (reason) {
    case 'overdue':
      return <Clock className={`${cls} text-red-500`} aria-label="Overdue" />;
    case 'blocked':
    case 'waiting_approval':
      return <AlertCircle className={`${cls} text-amber-500`} aria-label={reason} />;
    case 'unassigned':
      return <UserX className={`${cls} text-amber-500`} aria-label="Unassigned" />;
    default:
      return <AlertCircle className={`${cls} text-gray-400`} />;
  }
}
