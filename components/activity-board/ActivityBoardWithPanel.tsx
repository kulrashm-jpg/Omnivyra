/**
 * Container: Board + Side Panel + Full-Screen. Manages selected activity, messages,
 * approval flow (activity = source of truth, messages = history), and stage suggestion.
 * Additive UI only; no RBAC or workflow redesign.
 */

import React, { useState, useCallback, useMemo } from 'react';
import ActivityBoard from './ActivityBoard';
import ActivitySidePanel from './ActivitySidePanel';
import ActivityPanelFullScreen from './ActivityPanelFullScreen';
import type { Activity, ActivityMessage, ActivityStage, SenderRole } from './types';
import { ACTIVITY_STAGES } from './types';

function getNextStage(stage: ActivityStage): ActivityStage | null {
  const i = ACTIVITY_STAGES.indexOf(stage);
  if (i < 0 || i >= ACTIVITY_STAGES.length - 1) return null;
  return ACTIVITY_STAGES[i + 1];
}

function createApprovalMessage(
  activityId: string,
  senderName: string,
  senderRole: SenderRole,
  messageType: 'APPROVAL' | 'REJECTION' | 'REQUEST_CHANGES'
): ActivityMessage {
  const text =
    messageType === 'APPROVAL'
      ? `✔ Approved by ${senderName} (${senderRole.replace(/_/g, ' ')})`
      : messageType === 'REJECTION'
      ? `✘ Rejected by ${senderName}`
      : `Requested changes by ${senderName}`;
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    activity_id: activityId,
    user_id: 'current-user',
    sender_name: senderName,
    sender_role: senderRole,
    message_type: messageType,
    message_text: text,
    created_at: new Date().toISOString(),
  };
}

export interface ActivityBoardWithPanelProps {
  activities: Activity[];
  messagesByActivity?: Record<string, ActivityMessage[]>;
  /** Current user display name for auto-generated approval messages */
  currentUserName?: string;
  /** Current user role for approval message badge */
  currentUserRole?: SenderRole;
  /** Optional: persist activity updates (e.g. API). Called after local state update. */
  onActivityUpdate?: (activity: Activity) => void;
  /** Optional: persist new message. Called after adding to thread. */
  onMessageAdd?: (message: ActivityMessage) => void;
}

export default function ActivityBoardWithPanel({
  activities: initialActivities,
  messagesByActivity: initialMessagesByActivity = {},
  currentUserName = 'You',
  currentUserRole = 'CAMPAIGN_CONTENT_MANAGER',
  onActivityUpdate,
  onMessageAdd,
}: ActivityBoardWithPanelProps) {
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [messagesByActivity, setMessagesByActivity] = useState<Record<string, ActivityMessage[]>>(
    initialMessagesByActivity
  );
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [fullScreenOpen, setFullScreenOpen] = useState(false);
  const [suggestedNextStageFor, setSuggestedNextStageFor] = useState<string | null>(null);

  const selectedActivity = selectedActivityId
    ? activities.find((a) => a.id === selectedActivityId) ?? null
    : null;
  const selectedMessages = selectedActivityId
    ? messagesByActivity[selectedActivityId] ?? []
    : [];
  const suggestedNextStage =
    selectedActivity && suggestedNextStageFor === selectedActivity.id
      ? getNextStage(selectedActivity.stage)
      : null;

  const updateActivity = useCallback(
    (activityId: string, patch: Partial<Activity>) => {
      setActivities((prev) =>
        prev.map((a) => (a.id === activityId ? { ...a, ...patch } : a))
      );
      const updated = activities.find((a) => a.id === activityId);
      if (updated) {
        const merged = { ...updated, ...patch };
        onActivityUpdate?.(merged);
      }
    },
    [activities, onActivityUpdate]
  );

  const addMessage = useCallback(
    (activityId: string, message: ActivityMessage) => {
      setMessagesByActivity((prev) => ({
        ...prev,
        [activityId]: [...(prev[activityId] ?? []), message],
      }));
      onMessageAdd?.(message);
    },
    [onMessageAdd]
  );

  const handleApprove = useCallback(
    (activityId: string) => {
      const activity = activities.find((a) => a.id === activityId);
      if (!activity) return;
      updateActivity(activityId, {
        approval_status: 'approved',
        approved_by: currentUserName,
        approved_at: new Date().toISOString(),
      });
      const msg = createApprovalMessage(
        activityId,
        currentUserName,
        currentUserRole,
        'APPROVAL'
      );
      addMessage(activityId, msg);
      setSuggestedNextStageFor(activityId);
    },
    [activities, currentUserName, currentUserRole, updateActivity, addMessage]
  );

  const handleReject = useCallback(
    (activityId: string) => {
      updateActivity(activityId, {
        approval_status: 'rejected',
        approved_by: undefined,
        approved_at: undefined,
      });
      const msg = createApprovalMessage(
        activityId,
        currentUserName,
        currentUserRole,
        'REJECTION'
      );
      addMessage(activityId, msg);
      setSuggestedNextStageFor(null);
    },
    [currentUserName, currentUserRole, updateActivity, addMessage]
  );

  const handleRequestChanges = useCallback(
    (activityId: string) => {
      updateActivity(activityId, { approval_status: 'request_changes' });
      const msg = createApprovalMessage(
        activityId,
        currentUserName,
        currentUserRole,
        'REQUEST_CHANGES'
      );
      addMessage(activityId, msg);
      setSuggestedNextStageFor(null);
    },
    [currentUserName, currentUserRole, updateActivity, addMessage]
  );

  const handleMoveStage = useCallback(
    (activityId: string, stage: ActivityStage) => {
      updateActivity(activityId, { stage });
      setSuggestedNextStageFor(null);
    },
    [updateActivity]
  );

  const handleConfirmStageSuggestion = useCallback(
    (activityId: string, stage: ActivityStage) => {
      updateActivity(activityId, { stage });
      addMessage(activityId, {
        id: `msg-${Date.now()}-sys`,
        activity_id: activityId,
        user_id: 'system',
        sender_name: 'System',
        sender_role: 'SYSTEM',
        message_type: 'SYSTEM',
        message_text: `Suggested transition: ${stage} stage.`,
        created_at: new Date().toISOString(),
      });
      setSuggestedNextStageFor(null);
    },
    [updateActivity, addMessage]
  );

  const handleSendMessage = useCallback(
    (activityId: string, text: string) => {
      const msg: ActivityMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        activity_id: activityId,
        user_id: 'current-user',
        sender_name: currentUserName,
        sender_role: currentUserRole,
        message_type: 'COMMENT',
        message_text: text,
        created_at: new Date().toISOString(),
      };
      addMessage(activityId, msg);
    },
    [currentUserName, currentUserRole, addMessage]
  );

  const panelProps = {
    activity: selectedActivity,
    messages: selectedMessages,
    onClose: () => setSelectedActivityId(null),
    onApprove: handleApprove,
    onReject: handleReject,
    onRequestChanges: handleRequestChanges,
    onMoveStage: handleMoveStage,
    onSendMessage: handleSendMessage,
    onExpand: () => setFullScreenOpen(true),
    isFullScreen: false,
    suggestedNextStage,
    onConfirmStageSuggestion: handleConfirmStageSuggestion,
    onDismissStageSuggestion: () => setSuggestedNextStageFor(null),
  };

  const messageCountByActivity = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(messagesByActivity).map(([id, msgs]) => [id, msgs.length])
      ),
    [messagesByActivity]
  );

  return (
    <>
      <div className="flex gap-0 min-h-[420px]">
        <div className="flex-1 min-w-0">
          <ActivityBoard
            activities={activities}
            selectedActivityId={selectedActivityId}
            onSelectActivity={setSelectedActivityId}
            messageCountByActivity={messageCountByActivity}
            onApprove={handleApprove}
            canApprove={(a) => a.approval_status !== 'approved'}
          />
        </div>
        {!fullScreenOpen && (
          <div className="flex-shrink-0 w-full max-w-md border-l">
            <ActivitySidePanel {...panelProps} />
          </div>
        )}
      </div>
      {fullScreenOpen && (
        <ActivityPanelFullScreen
          activity={selectedActivity}
          messages={selectedMessages}
          onClose={() => setFullScreenOpen(false)}
          onApprove={handleApprove}
          onReject={handleReject}
          onRequestChanges={handleRequestChanges}
          onMoveStage={handleMoveStage}
          onSendMessage={handleSendMessage}
          suggestedNextStage={suggestedNextStage}
          onConfirmStageSuggestion={handleConfirmStageSuggestion}
          onDismissStageSuggestion={() => setSuggestedNextStageFor(null)}
        />
      )}
    </>
  );
}
