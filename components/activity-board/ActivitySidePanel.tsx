/**
 * Activity Side Panel — primary workspace. Right-side sliding panel.
 * Sections: sticky header, activity details, vertical message thread, message composer.
 * Supports Expand to full-screen. Single source of activity editing.
 */

import React, { useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import type { Activity, ActivityMessage, ActivityStage } from './types';
import { ACTIVITY_STAGES } from './types';
import ActivityMessageThread from './ActivityMessageThread';
import ActivityMessageComposer from './ActivityMessageComposer';

const STAGE_BADGE_CLASSES_PANEL: Record<ActivityStage, string> = {
  PLAN: 'bg-blue-100 text-blue-800 border-blue-200',
  CREATE: 'bg-purple-100 text-purple-800 border-purple-200',
  REPURPOSE: 'bg-orange-100 text-orange-800 border-orange-200',
  SCHEDULE: 'bg-teal-100 text-teal-800 border-teal-200',
  SHARE: 'bg-green-100 text-green-800 border-green-200',
};

function labelize(v: string): string {
  return String(v || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export interface ActivitySidePanelProps {
  activity: Activity | null;
  messages: ActivityMessage[];
  onClose: () => void;
  /** When true, expand button becomes minimize (exit full-screen) */
  isFullScreen?: boolean;
  onApprove?: (activityId: string) => void;
  onReject?: (activityId: string) => void;
  onRequestChanges?: (activityId: string) => void;
  onMoveStage?: (activityId: string, stage: ActivityStage) => void;
  onSendMessage?: (activityId: string, text: string) => void;
  onExpand?: () => void;
  /** Next suggested stage after approval (e.g. SCHEDULE). User confirms. */
  suggestedNextStage?: ActivityStage | null;
  onConfirmStageSuggestion?: (activityId: string, stage: ActivityStage) => void;
  onDismissStageSuggestion?: () => void;
}

export default function ActivitySidePanel({
  activity,
  messages,
  onClose,
  onApprove,
  onReject,
  onRequestChanges,
  onMoveStage,
  onSendMessage,
  onExpand,
  isFullScreen,
  suggestedNextStage,
  onConfirmStageSuggestion,
  onDismissStageSuggestion,
}: ActivitySidePanelProps) {
  const [moveStageOpen, setMoveStageOpen] = useState(false);

  if (!activity) {
    return (
      <div className="w-full max-w-md border-l bg-white flex items-center justify-center text-gray-500">
        Select an activity
      </div>
    );
  }

  const stageClass = STAGE_BADGE_CLASSES_PANEL[activity.stage] || 'bg-gray-100 text-gray-800';
  const canApprove = activity.approval_status !== 'approved';
  const showStageSuggestion = suggestedNextStage && activity.approval_status === 'approved';

  return (
    <div className="flex flex-col h-full bg-white border-l shadow-lg w-full max-w-lg">
      {/* A. HEADER (sticky) */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-white border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-gray-900 truncate">{activity.title || 'Untitled'}</h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                {labelize(activity.content_type)}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${stageClass}`}>
                {activity.stage}
              </span>
              <span className="text-xs text-gray-500">{labelize(activity.approval_status)}</span>
              {activity.owner_name && (
                <span className="text-xs text-gray-500">• {activity.owner_name}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onExpand && (
              <button
                type="button"
                onClick={onExpand}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                title={isFullScreen ? 'Exit full screen' : 'Expand to full screen'}
              >
                {isFullScreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
              title="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {canApprove && onApprove && (
            <button
              type="button"
              onClick={() => onApprove(activity.id)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Approve
            </button>
          )}
          {canApprove && onReject && (
            <button
              type="button"
              onClick={() => onReject(activity.id)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
            >
              Reject
            </button>
          )}
          {canApprove && onRequestChanges && (
            <button
              type="button"
              onClick={() => onRequestChanges(activity.id)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700"
            >
              Request changes
            </button>
          )}
          {onMoveStage && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoveStageOpen((o) => !o)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Move stage
              </button>
              {moveStageOpen && (
                <div className="absolute left-0 top-full mt-1 py-1 bg-white border rounded-lg shadow-lg z-20 min-w-[140px]">
                  {ACTIVITY_STAGES.filter((s) => s !== activity.stage).map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      onClick={() => {
                        onMoveStage(activity.id, stage);
                        setMoveStageOpen(false);
                      }}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                    >
                      {stage}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* B. ACTIVITY DETAILS */}
      <div className="flex-shrink-0 px-4 py-3 border-b bg-gray-50/50 text-sm">
        <div className="font-medium text-gray-700 mb-1">Details</div>
        <div className="space-y-1 text-gray-600">
          {activity.platforms?.length ? (
            <div>Platforms: {activity.platforms.join(', ')}</div>
          ) : null}
          {activity.due_date && <div>Due: {activity.due_date}{activity.due_time ? ` ${activity.due_time}` : ''}</div>}
          {activity.execution_id && <div className="text-xs text-gray-500">Execution: {activity.execution_id}</div>}
        </div>
      </div>

      {/* Stage suggestion after approval */}
      {showStageSuggestion && suggestedNextStage && (
        <div className="flex-shrink-0 px-4 py-3 bg-teal-50 border-b border-teal-100">
          <div className="text-sm font-medium text-teal-900">✔ Approved</div>
          <div className="text-sm text-teal-700 mt-0.5">
            Suggested next step: Move to {suggestedNextStage}
          </div>
          <div className="flex gap-2 mt-2">
            {onConfirmStageSuggestion && (
              <button
                type="button"
                onClick={() => onConfirmStageSuggestion(activity.id, suggestedNextStage)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700"
              >
                Move now
              </button>
            )}
            {onDismissStageSuggestion && (
              <button
                type="button"
                onClick={onDismissStageSuggestion}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-teal-300 text-teal-700 hover:bg-teal-50"
              >
                Later
              </button>
            )}
          </div>
        </div>
      )}

      {/* C. MESSAGE THREAD */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b font-medium text-sm text-gray-700">Messages</div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <ActivityMessageThread messages={messages} className="min-h-full" />
        </div>
      </div>

      {/* D. MESSAGE COMPOSER */}
      {onSendMessage && (
        <ActivityMessageComposer
          onSubmit={(text) => onSendMessage(activity.id, text)}
          disabled={false}
        />
      )}
    </div>
  );
}
