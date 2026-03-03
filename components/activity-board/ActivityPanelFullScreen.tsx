/**
 * Full-screen overlay for deep editing. Renders same content as side panel.
 * Board remains in background; closing returns to side panel. No new route.
 */

import React from 'react';
import ActivitySidePanel from './ActivitySidePanel';
import type { Activity, ActivityMessage, ActivityStage } from './types';

export interface ActivityPanelFullScreenProps {
  activity: Activity | null;
  messages: ActivityMessage[];
  onClose: () => void;
  onApprove?: (activityId: string) => void;
  onReject?: (activityId: string) => void;
  onRequestChanges?: (activityId: string) => void;
  onMoveStage?: (activityId: string, stage: ActivityStage) => void;
  onSendMessage?: (activityId: string, text: string) => void;
  suggestedNextStage?: ActivityStage | null;
  onConfirmStageSuggestion?: (activityId: string, stage: ActivityStage) => void;
  onDismissStageSuggestion?: () => void;
}

export default function ActivityPanelFullScreen({
  activity,
  messages,
  onClose,
  onApprove,
  onReject,
  onRequestChanges,
  onMoveStage,
  onSendMessage,
  suggestedNextStage,
  onConfirmStageSuggestion,
  onDismissStageSuggestion,
}: ActivityPanelFullScreenProps) {
  return (
    <div className="fixed inset-0 z-50 bg-gray-100 flex flex-col">
      <div className="flex-1 min-h-0 flex justify-center">
        <div className="w-full max-w-2xl h-full bg-white shadow-xl flex flex-col">
          <ActivitySidePanel
            activity={activity}
            messages={messages}
            onClose={onClose}
            isFullScreen
            onExpand={onClose}
            onApprove={onApprove}
            onReject={onReject}
            onRequestChanges={onRequestChanges}
            onMoveStage={onMoveStage}
            onSendMessage={onSendMessage}
            suggestedNextStage={suggestedNextStage}
            onConfirmStageSuggestion={onConfirmStageSuggestion}
            onDismissStageSuggestion={onDismissStageSuggestion}
          />
        </div>
      </div>
    </div>
  );
}
