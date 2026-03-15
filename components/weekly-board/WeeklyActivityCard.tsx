/**
 * Weekly Activity Card — Phase 3 visual card for a single content instance.
 * Displays: content_code, topic title, platform, content type, execution category,
 * scheduled day/time, repurpose indicator. Hover actions: Open Workspace, Edit Schedule, Move, Regenerate.
 */

import React, { useState } from 'react';
import {
  ExternalLink,
  Calendar,
  GripVertical,
  RefreshCw,
} from 'lucide-react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { ContentTypeIcon } from './contentTypeIcons';
import { getExecutionCategoryBorder } from './executionCategoryColors';
import type { WeeklyActivity } from '@/lib/planning/weeklyActivityAdapter';

export interface WeeklyActivityCardProps {
  activity: WeeklyActivity;
  onOpenWorkspace?: (activity: WeeklyActivity) => void;
  onEditSchedule?: (activity: WeeklyActivity) => void;
  onMoveCard?: (activity: WeeklyActivity) => void;
  onRegenerate?: (activity: WeeklyActivity) => void;
  compact?: boolean;
}

export default function WeeklyActivityCard({
  activity,
  onOpenWorkspace,
  onEditSchedule,
  onMoveCard,
  onRegenerate,
  compact = false,
}: WeeklyActivityCardProps) {
  const [hover, setHover] = useState(false);
  const borderClass = getExecutionCategoryBorder(activity.execution_mode);
  const repurposeIndex = activity.repurpose_index ?? 1;
  const repurposeTotal = activity.repurpose_total ?? 1;
  const showRepurpose = repurposeTotal >= 1;

  return (
    <div
      className={`
        relative rounded-lg border border-gray-200 bg-white shadow-sm
        transition-shadow hover:shadow-md
        ${borderClass}
        border-l-4
      `}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Repurpose dots - top-right */}
      {showRepurpose && (
        <div
          className="absolute top-2 right-2 inline-flex items-center gap-0.5"
          aria-label={repurposeTotal === 1 ? 'Unique' : `${repurposeIndex} of ${repurposeTotal}`}
        >
          {Array.from({ length: repurposeTotal }, (_, i) => (
            <span
              key={i}
              className={i < repurposeIndex ? 'text-indigo-500' : 'text-gray-300'}
              style={{ fontSize: 8 }}
            >
              {i < repurposeIndex ? '●' : '○'}
            </span>
          ))}
        </div>
      )}

      {/* Header: content_code | topic title */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div
          className={`font-medium text-gray-900 ${compact ? 'text-sm' : ''}`}
          style={{ paddingRight: showRepurpose ? '2.5rem' : undefined }}
        >
          <span className="text-blue-600">{activity.content_code}</span>
          <span className="text-gray-400 mx-1.5">|</span>
          <span className="truncate block sm:inline">
            {activity.topic || 'Untitled'}
          </span>
        </div>
      </div>

      {/* Platform / Content Type */}
      <div className="px-3 py-2 flex items-center gap-2 text-sm text-gray-600">
        <PlatformIcon platform={activity.platform} size={14} showLabel />
        <ContentTypeIcon
          contentType={activity.content_type}
          size={14}
          showLabel
        />
      </div>

      {/* Schedule: Day + Time */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 text-sm text-gray-500">
        <Calendar size={14} aria-hidden />
        <span>
          {activity.scheduled_day_name} {activity.scheduled_time}
        </span>
      </div>

      {/* Hover actions */}
      {hover && (
        <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-gray-50/95 border-t border-gray-200 px-2 py-1.5 flex flex-wrap gap-1">
          {onOpenWorkspace && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenWorkspace(activity);
              }}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <ExternalLink size={12} aria-hidden />
              Open Workspace
            </button>
          )}
          {onEditSchedule && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditSchedule(activity);
              }}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800"
            >
              <Calendar size={12} aria-hidden />
              Edit Schedule
            </button>
          )}
          {onMoveCard && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveCard(activity);
              }}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800"
            >
              <GripVertical size={12} aria-hidden />
              Move Card
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate(activity);
              }}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800"
            >
              <RefreshCw size={12} aria-hidden />
              Regenerate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
