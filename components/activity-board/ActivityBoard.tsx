/**
 * Pipeline board: horizontal stage flow (PLAN → CREATE → REPURPOSE → SCHEDULE → SHARE).
 * Smart Preview cards only; no messages. Click card → onSelectActivity(id).
 */

import React from 'react';
import type { Activity, ActivityStage } from './types';
import { ACTIVITY_STAGES } from './types';
import ActivityCard from './ActivityCard';

const STAGE_HEADER_CLASSES: Record<ActivityStage, string> = {
  PLAN: 'bg-blue-50 border-blue-200 text-blue-900',
  CREATE: 'bg-purple-50 border-purple-200 text-purple-900',
  REPURPOSE: 'bg-orange-50 border-orange-200 text-orange-900',
  SCHEDULE: 'bg-teal-50 border-teal-200 text-teal-900',
  SHARE: 'bg-green-50 border-green-200 text-green-900',
};

export interface ActivityBoardProps {
  activities: Activity[];
  selectedActivityId: string | null;
  onSelectActivity: (activityId: string | null) => void;
  /** Optional: message count per activity for card indicator */
  messageCountByActivity?: Record<string, number>;
  /** Optional: called when user chooses Move from card hover actions */
  onMove?: (activityId: string) => void;
  /** Optional: called when user chooses Approve from card hover actions */
  onApprove?: (activityId: string) => void;
  /** Optional: whether current user can approve (role-based); enables Approve in hover actions */
  canApprove?: (activity: Activity) => boolean;
}

export default function ActivityBoard({
  activities,
  selectedActivityId,
  onSelectActivity,
  messageCountByActivity = {},
  onMove,
  onApprove,
  canApprove,
}: ActivityBoardProps) {
  const byStage = React.useMemo(() => {
    const map: Record<ActivityStage, Activity[]> = {
      PLAN: [],
      CREATE: [],
      REPURPOSE: [],
      SCHEDULE: [],
      SHARE: [],
    };
    activities.forEach((a) => {
      if (map[a.stage]) map[a.stage].push(a);
    });
    return map;
  }, [activities]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[280px]">
      {ACTIVITY_STAGES.map((stage) => (
        <div
          key={stage}
          className="flex-shrink-0 w-72 rounded-lg border border-gray-200 bg-gray-50/50 overflow-hidden"
        >
          <div
            className={`px-3 py-2 border-b font-semibold text-sm ${STAGE_HEADER_CLASSES[stage]}`}
          >
            {stage}
          </div>
          <div className="p-2 space-y-2 overflow-y-auto max-h-[420px]">
            {byStage[stage].map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                isSelected={selectedActivityId === activity.id}
                messageCount={messageCountByActivity[activity.id] ?? 0}
                onClick={() => onSelectActivity(activity.id)}
                onMove={onMove}
                onApprove={onApprove}
                canApprove={canApprove?.(activity)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
