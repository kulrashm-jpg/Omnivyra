/**
 * Smart Preview activity card for workflow board.
 * Scannable in ~3s. No descriptions, message previews, or strategy.
 * Stage accent = left border. Hover = quick actions (Open, Move, Approve).
 */

import React, { useState, useMemo } from 'react';
import { Move, CheckCircle } from 'lucide-react';
import type { Activity, ActivityStage } from './types';
import { getBoardIndicators } from './board-indicators';
import BoardIntelligenceIndicators from './BoardIntelligenceIndicators';
import { getExecutionIntelligence } from '../../utils/getExecutionIntelligence';
import { getContentTypeBadgeClasses, isCreatorDependentContentType } from '../../utils/contentTaxonomy';

const STAGE_BORDER_CLASSES: Record<ActivityStage, string> = {
  PLAN: 'border-l-blue-500',
  CREATE: 'border-l-purple-500',
  REPURPOSE: 'border-l-orange-500',
  SCHEDULE: 'border-l-teal-500',
  SHARE: 'border-l-green-500',
};

const APPROVAL_PILL_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  request_changes: 'bg-amber-100 text-amber-800',
};

const APPROVAL_DOT_CLASSES: Record<string, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-emerald-500',
  rejected: 'bg-red-500',
  request_changes: 'bg-amber-500',
};

function labelize(value: string): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDue(due_date?: string, due_time?: string): string {
  if (!due_date) return '';
  const t = due_time ? ` ${due_time}` : '';
  return `${due_date}${t}`;
}

export interface ActivityCardProps {
  activity: Activity;
  isSelected?: boolean;
  /** Optional; from messagesByActivity[activity.id].length */
  messageCount?: number;
  onClick: () => void;
  /** Called when user chooses Move from hover actions */
  onMove?: (activityId: string) => void;
  /** Called when user chooses Approve from hover actions (role-based) */
  onApprove?: (activityId: string) => void;
  /** Whether to show Approve in hover actions */
  canApprove?: boolean;
}

export default function ActivityCard({
  activity,
  isSelected,
  messageCount = 0,
  onClick,
  onMove,
  onApprove,
  canApprove = false,
}: ActivityCardProps) {
  const [hover, setHover] = useState(false);
  const showActions = hover && (onMove != null || onApprove != null);

  const storedExecMode = (activity.execution_mode ?? 'AI_AUTOMATED') as 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';
  const execMode = isCreatorDependentContentType(activity.content_type) ? 'CREATOR_REQUIRED' : storedExecMode;
  const intel = getExecutionIntelligence(execMode);
  const modeColors = intel.colorClasses;
  const stageBorder = modeColors ? modeColors.borderLeft : (STAGE_BORDER_CLASSES[activity.stage] ?? 'border-l-gray-300');
  const approvalPill = APPROVAL_PILL_CLASSES[activity.approval_status] ?? 'bg-gray-100 text-gray-700';
  const approvalDot = APPROVAL_DOT_CLASSES[activity.approval_status] ?? 'bg-gray-400';
  const dueStr = formatDue(activity.due_date, activity.due_time);
  const indicatorItems = useMemo(
    () => getBoardIndicators(activity, messageCount),
    [activity, messageCount]
  );

  return (
    <div
      className={`group rounded-lg border border-l-4 border-gray-200 bg-white transition-all ${stageBorder} ${
        isSelected ? 'ring-2 ring-indigo-500 border-indigo-300' : ''
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left p-2.5 focus:outline-none focus:ring-0"
      >
        {/* 1. Title — primary */}
        <div className="font-medium text-gray-900 text-sm truncate leading-tight" title={activity.title}>
          {activity.title || 'Untitled'}
        </div>
        {activity.execution_mode === 'CONDITIONAL_AI' && (
          <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">Template unlocks AI generation</div>
        )}
        {activity.creator_instruction && typeof activity.creator_instruction === 'object' && (
          (() => {
            const ci = activity.creator_instruction as Record<string, unknown>;
            const line = ci.targetAudience ? `Audience: ${String(ci.targetAudience)}` : ci.objective ? `Goal: ${String(ci.objective)}` : null;
            return line ? <div className="text-[10px] text-gray-500 mt-0.5 truncate leading-tight">{line}</div> : null;
          })()
        )}

        {/* 2. Content type badge + execution dot */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] leading-none shrink-0" title={execMode === 'AI_AUTOMATED' ? 'Fully AI executable' : (intel.label ?? undefined)}>
            {execMode === 'AI_AUTOMATED' ? '🟢' : execMode === 'CONDITIONAL_AI' ? '🟡' : '🔴'}
          </span>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${getContentTypeBadgeClasses(activity.content_type)}`}>
            {labelize(activity.content_type)}
          </span>
        </div>

        {/* 3. Owner */}
        {activity.owner_name && (
          <div className="mt-1 text-xs text-gray-500 truncate">{activity.owner_name}</div>
        )}

        {/* 4. Approval status + 5. Due date (optional) */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${approvalPill}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${approvalDot}`} aria-hidden />
            {labelize(activity.approval_status)}
          </span>
          {dueStr && (
            <span className="text-xs text-gray-500">{dueStr}</span>
          )}
        </div>

        {/* 6. Board Intelligence: one-line icon row (priority: overdue > blocked > approval > collaboration > ownership) */}
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <BoardIntelligenceIndicators items={indicatorItems} />
        </div>
      </button>

      {/* Hover quick actions */}
      {showActions && (
        <div
          className="flex items-center gap-1 px-2.5 pb-2 pt-0 border-t border-gray-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClick();
            }}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
          >
            Open
          </button>
          {onMove && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMove(activity.id);
              }}
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
              title="Move to stage"
            >
              <Move className="w-3 h-3" />
              Move
            </button>
          )}
          {canApprove && onApprove && activity.approval_status !== 'approved' && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onApprove(activity.id);
              }}
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
              title="Approve"
            >
              <CheckCircle className="w-3 h-3" />
              Approve
            </button>
          )}
        </div>
      )}
    </div>
  );
}
