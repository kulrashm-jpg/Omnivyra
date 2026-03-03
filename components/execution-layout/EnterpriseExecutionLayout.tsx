/**
 * Enterprise 3-Panel Layout: LEFT (context) | CENTER (pipeline board) | RIGHT (activity workspace).
 * State: selectedActivity, panelMode (CLOSED | SIDE | FULLSCREEN).
 * Board remains visible when panel open. Messages only in right panel. One activity active at a time.
 * Role-based default: COMPANY_ADMIN / CAMPAIGN_CONTENT_MANAGER → Radar; CONTENT_CREATOR → Pipeline.
 * Optional: persist last selected view (sessionStorage).
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ActivityBoard,
  ActivitySidePanel,
  ActivityPanelFullScreen,
} from '../activity-board';
import type { Activity, ActivityMessage, ActivityStage, SenderRole } from '../activity-board/types';
import { ACTIVITY_STAGES } from '../activity-board/types';
import { computeCampaignHealth, getCompanyPortfolioHealth } from '../../lib/campaign-health-engine';
import type { CompanyPortfolioHealth } from '../../lib/campaign-health-engine';
import {
  createLocalStorageStore,
  getUserDecisionPattern,
  recordSelection,
} from '../../lib/preventive-action-preferences';
import CampaignContextPanel from './CampaignContextPanel';
import ManagerRadarView from './ManagerRadarView';
import CmoPortfolioRadarView from './CmoPortfolioRadarView';
import type { PanelMode, CenterViewMode } from './types';
import type { CampaignContextItem, ExecutionFilters } from './types';

const STORAGE_KEY_CENTER_VIEW = 'virality:execution:centerView';

function getRoleBasedDefaultCenterView(userRole: string | null | undefined): CenterViewMode {
  const role = (userRole || '').toUpperCase();
  if (role === 'COMPANY_ADMIN' || role === 'CAMPAIGN_CONTENT_MANAGER') return 'radar';
  return 'pipeline';
}

function getStoredCenterView(): CenterViewMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY_CENTER_VIEW);
    if (v === 'radar' || v === 'pipeline' || v === 'portfolio') return v;
  } catch (_) {}
  return null;
}

function setStoredCenterView(view: CenterViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY_CENTER_VIEW, view);
  } catch (_) {}
}

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

export interface EnterpriseExecutionLayoutProps {
  activities: Activity[];
  messagesByActivity?: Record<string, ActivityMessage[]>;
  /** Left panel: current campaign */
  currentCampaign?: { id: string; name: string } | null;
  campaigns?: CampaignContextItem[];
  onSelectCampaign?: (id: string) => void;
  filters?: ExecutionFilters;
  onFiltersChange?: (filters: ExecutionFilters) => void;
  currentUserName?: string;
  currentUserRole?: SenderRole;
  onActivityUpdate?: (activity: Activity) => void;
  onMessageAdd?: (message: ActivityMessage) => void;
  /** Initial center view (used when no userRole and no stored preference). Default 'pipeline'. */
  defaultCenterView?: CenterViewMode;
  /** Company/campaign role for role-based default: COMPANY_ADMIN/CAMPAIGN_CONTENT_MANAGER → Radar, CONTENT_CREATOR → Pipeline. */
  userRole?: string | null;
  /** Persist last selected view in sessionStorage. Default true. User choice overrides role default when set. */
  persistCenterView?: boolean;
  /** For Portfolio view: fetch activities per campaign. If omitted, portfolio shows empty health per campaign. */
  fetchActivitiesForCampaign?: (campaignId: string) => Promise<Activity[]>;
  /** Optional: for adaptive learning of Suggested Options (reorder by user preference). */
  currentUserId?: string | null;
}

export default function EnterpriseExecutionLayout({
  activities: initialActivities,
  messagesByActivity: initialMessagesByActivity = {},
  currentCampaign,
  campaigns = [],
  onSelectCampaign,
  filters = {},
  onFiltersChange,
  currentUserName = 'You',
  currentUserRole = 'CAMPAIGN_CONTENT_MANAGER',
  onActivityUpdate,
  onMessageAdd,
  defaultCenterView = 'pipeline',
  userRole,
  persistCenterView = true,
  fetchActivitiesForCampaign,
  currentUserId,
}: EnterpriseExecutionLayoutProps) {
  const isCompanyAdmin = (userRole ?? '').toUpperCase() === 'COMPANY_ADMIN';

  const preferenceStore = useMemo(() => createLocalStorageStore(), []);
  const portfolioPreferenceCallbacks = useMemo(
    () => ({
      getDecisionPattern: (userId: string) => getUserDecisionPattern(userId, preferenceStore),
      onRecordSelection: (userId: string, category: Parameters<typeof recordSelection>[1], campaignId?: string | null) =>
        recordSelection(userId, category, campaignId, preferenceStore),
    }),
    [preferenceStore]
  );

  const initialCenterView = useMemo(() => {
    if (persistCenterView) {
      const stored = getStoredCenterView();
      if (stored === 'portfolio' && !isCompanyAdmin) return getRoleBasedDefaultCenterView(userRole ?? '');
      if (stored) return stored;
    }
    if (userRole != null && userRole !== '') return getRoleBasedDefaultCenterView(userRole);
    return defaultCenterView;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: resolve once on mount

  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [messagesByActivity, setMessagesByActivity] = useState<
    Record<string, ActivityMessage[]>
  >(initialMessagesByActivity);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('CLOSED');
  const [suggestedNextStageFor, setSuggestedNextStageFor] = useState<string | null>(null);
  const [centerView, setCenterViewState] = useState<CenterViewMode>(initialCenterView);
  const [portfolioData, setPortfolioData] = useState<CompanyPortfolioHealth | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  useEffect(() => {
    if (centerView !== 'portfolio') return;
    setSelectedActivityId(null);
    setPanelMode('CLOSED');
  }, [centerView]);

  useEffect(() => {
    if (centerView !== 'portfolio' || campaigns.length === 0) {
      setPortfolioData(null);
      return;
    }
    const fetch = fetchActivitiesForCampaign ?? (() => Promise.resolve([]));
    setPortfolioLoading(true);
    getCompanyPortfolioHealth(
      campaigns.map((c) => ({ id: c.id, name: c.name })),
      fetch
    )
      .then(setPortfolioData)
      .catch(() => setPortfolioData(null))
      .finally(() => setPortfolioLoading(false));
  }, [centerView, campaigns, fetchActivitiesForCampaign]);

  const setCenterView = useCallback(
    (view: CenterViewMode) => {
      setCenterViewState(view);
      if (persistCenterView) setStoredCenterView(view);
    },
    [persistCenterView]
  );

  const filteredActivities = useMemo(() => {
    let list = activities;
    if (filters.stage) list = list.filter((a) => a.stage === filters.stage);
    if (filters.approvalStatus)
      list = list.filter((a) => a.approval_status === filters.approvalStatus);
    if (filters.owner) list = list.filter((a) => a.owner_id === filters.owner || a.owner_name === filters.owner);
    return list;
  }, [activities, filters]);

  const campaignHealth = useMemo(
    () => computeCampaignHealth(filteredActivities),
    [filteredActivities]
  );

  const selectedActivity =
    selectedActivityId != null
      ? activities.find((a) => a.id === selectedActivityId) ?? null
      : null;
  const selectedMessages =
    selectedActivityId != null ? messagesByActivity[selectedActivityId] ?? [] : [];
  const suggestedNextStage =
    selectedActivity && suggestedNextStageFor === selectedActivity.id
      ? getNextStage(selectedActivity.stage)
      : null;

  const updateActivity = useCallback(
    (activityId: string, patch: Partial<Activity>) => {
      const current = activities.find((a) => a.id === activityId);
      if (!current) return;
      const merged: Activity = { ...current, ...patch };
      setActivities((prev) =>
        prev.map((a) => (a.id === activityId ? merged : a))
      );
      onActivityUpdate?.(merged);
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

  const handleSelectActivity = useCallback((activityId: string | null) => {
    setSelectedActivityId(activityId);
    setPanelMode(activityId ? 'SIDE' : 'CLOSED');
  }, []);

  const handlePortfolioSelectCampaign = useCallback(
    (campaignId: string, activityId?: string, suggestedFilter?: { stage?: string | null; approvalStatus?: string | null }) => {
      onSelectCampaign?.(campaignId);
      setCenterView('radar');
      setSelectedActivityId(activityId ?? null);
      setPanelMode(activityId ? 'SIDE' : 'CLOSED');
      if (suggestedFilter && onFiltersChange) {
        onFiltersChange({ ...filters, ...suggestedFilter });
      }
    },
    [onSelectCampaign, setCenterView, onFiltersChange, filters]
  );

  const handleClosePanel = useCallback(() => {
    setPanelMode('CLOSED');
    setSelectedActivityId(null);
  }, []);

  const handleExpand = useCallback(() => setPanelMode('FULLSCREEN'), []);
  const handleExitFullScreen = useCallback(() => setPanelMode('SIDE'), []);

  const handleApprove = useCallback(
    (activityId: string) => {
      const activity = activities.find((a) => a.id === activityId);
      if (!activity) return;
      updateActivity(activityId, {
        approval_status: 'approved',
        approved_by: currentUserName,
        approved_at: new Date().toISOString(),
      });
      addMessage(
        activityId,
        createApprovalMessage(activityId, currentUserName, currentUserRole, 'APPROVAL')
      );
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
      addMessage(
        activityId,
        createApprovalMessage(activityId, currentUserName, currentUserRole, 'REJECTION')
      );
      setSuggestedNextStageFor(null);
    },
    [currentUserName, currentUserRole, updateActivity, addMessage]
  );

  const handleRequestChanges = useCallback(
    (activityId: string) => {
      updateActivity(activityId, { approval_status: 'request_changes' });
      addMessage(
        activityId,
        createApprovalMessage(activityId, currentUserName, currentUserRole, 'REQUEST_CHANGES')
      );
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
    onClose: handleClosePanel,
    onApprove: handleApprove,
    onReject: handleReject,
    onRequestChanges: handleRequestChanges,
    onMoveStage: handleMoveStage,
    onSendMessage: handleSendMessage,
    onExpand: handleExpand,
    isFullScreen: false,
    suggestedNextStage,
    onConfirmStageSuggestion: handleConfirmStageSuggestion,
    onDismissStageSuggestion: () => setSuggestedNextStageFor(null),
  };

  return (
    <div className="flex h-full min-h-[480px] w-full">
      {/* LEFT — Context */}
      <CampaignContextPanel
        currentCampaign={currentCampaign}
        campaigns={campaigns}
        onSelectCampaign={onSelectCampaign}
        filters={filters}
        onFiltersChange={onFiltersChange}
      />

      {/* CENTER — Pipeline or Radar */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-gray-200 bg-white">
        <div className="flex-shrink-0 flex border-b border-gray-200 bg-gray-50/80 px-3 py-2 gap-1">
          <button
            type="button"
            onClick={() => setCenterView('radar')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              centerView === 'radar' ? 'bg-white shadow border border-gray-200 text-gray-900' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Radar
          </button>
          <button
            type="button"
            onClick={() => setCenterView('pipeline')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              centerView === 'pipeline' ? 'bg-white shadow border border-gray-200 text-gray-900' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Pipeline
          </button>
          {isCompanyAdmin && (
            <button
              type="button"
              onClick={() => setCenterView('portfolio')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                centerView === 'portfolio' ? 'bg-white shadow border border-gray-200 text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Portfolio
            </button>
          )}
        </div>
        {centerView === 'portfolio' ? (
          <CmoPortfolioRadarView
            portfolio={portfolioData}
            loading={portfolioLoading}
            onSelectCampaign={handlePortfolioSelectCampaign}
            userId={currentUserId}
            getDecisionPattern={currentUserId ? portfolioPreferenceCallbacks.getDecisionPattern : undefined}
            onRecordSelection={currentUserId ? portfolioPreferenceCallbacks.onRecordSelection : undefined}
          />
        ) : centerView === 'pipeline' ? (
          <ActivityBoard
            activities={filteredActivities}
            selectedActivityId={selectedActivityId}
            onSelectActivity={handleSelectActivity}
            messageCountByActivity={Object.fromEntries(
              Object.entries(messagesByActivity).map(([id, msgs]) => [id, msgs.length])
            )}
            onApprove={handleApprove}
            canApprove={(a) => a.approval_status !== 'approved'}
          />
        ) : (
          <ManagerRadarView
            health={campaignHealth}
            activities={filteredActivities}
            selectedActivityId={selectedActivityId}
            onSelectActivity={(id) => {
              setSelectedActivityId(id);
              setPanelMode('SIDE');
            }}
            showWeeklyNarrative={['COMPANY_ADMIN', 'CAMPAIGN_CONTENT_MANAGER'].includes(
              (userRole ?? '').toUpperCase()
            )}
          />
        )}
      </div>

      {/* RIGHT — Activity workspace (only when panelMode === SIDE) */}
      {panelMode === 'SIDE' && (
        <div className="flex-shrink-0 w-full max-w-lg border-l border-gray-200 bg-white">
          <ActivitySidePanel {...panelProps} />
        </div>
      )}

      {/* FULLSCREEN — overlay when panelMode === FULLSCREEN */}
      {panelMode === 'FULLSCREEN' && (
        <ActivityPanelFullScreen
          activity={selectedActivity}
          messages={selectedMessages}
          onClose={handleExitFullScreen}
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
    </div>
  );
}
