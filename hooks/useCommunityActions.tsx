import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import CommunityAiLayout from '../components/community-ai/CommunityAiLayout';
import SectionCard from '../components/community-ai/SectionCard';
import { apiFetch } from '@/lib/apiFetch';
import type { PendingAction } from '../components/community-ai/types';
import {
  validateActionAgainstPlaybook,
  type PlaybookValidationInput,
} from '../backend/services/playbooks/playbookValidator';

const tabs = ['Pending', 'Scheduled', 'Completed', 'Skipped'];


export function useCommunityActions() {
  const { selectedCompanyId } = useCompanyContext();
  const router = useRouter();
  const tenantId = selectedCompanyId || '';
  const [activeTab, setActiveTab] = useState('Pending');
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [permissions, setPermissions] = useState({
    canApprove: false,
    canExecute: false,
    canSchedule: false,
    canSkip: false,
    canManageConnectors: false,
  });
  const [manualAction, setManualAction] = useState<PendingAction | null>(null);
  const [manualDraft, setManualDraft] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSending, setManualSending] = useState(false);
  const [platformViewAction, setPlatformViewAction] = useState<PendingAction | null>(null);
  const [platformReplyDraft, setPlatformReplyDraft] = useState('');
  const [platformReplyError, setPlatformReplyError] = useState<string | null>(null);
  const [platformReplySending, setPlatformReplySending] = useState(false);
  const [historyActionId, setHistoryActionId] = useState<string | null>(null);
  const [historyEvents, setHistoryEvents] = useState<
    Array<{
      action_id: string;
      event_type: string;
      event_payload: any;
      created_at: string;
      audit?: {
        playbook_id?: string | null;
        intent?: any;
        execution_mode?: string | null;
        user_id?: string | null;
        timestamp?: string | null;
        final_text?: string | null;
      } | null;
    }>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyCache, setHistoryCache] = useState<
    Record<
      string,
      Array<{
        action_id: string;
        event_type: string;
        event_payload: any;
        created_at: string;
      }>
    >
  >({});

  const normalizeStatus = (action: PendingAction, fallback: string) => {
    const status = (action.status || '').toString().trim();
    return status.length > 0 ? status : fallback.toLowerCase();
  };

  const loadActions = async () => {
    if (!tenantId) {
      setActions([]);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await apiFetch(
        `/api/community-ai/actions?tenant_id=${encodeURIComponent(
          tenantId
        )}&organization_id=${encodeURIComponent(tenantId)}`
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load actions');
      }
      const data = await response.json();
      const combined: PendingAction[] = [
        ...(data.pending_actions || []).map((action: PendingAction) => ({
          ...action,
          status: normalizeStatus(action, 'pending'),
        })),
        ...(data.scheduled_actions || []).map((action: PendingAction) => ({
          ...action,
          status: normalizeStatus(action, 'scheduled'),
        })),
        ...(data.completed_actions || []).map((action: PendingAction) => ({
          ...action,
          status: normalizeStatus(action, 'completed'),
        })),
        ...(data.skipped_actions || []).map((action: PendingAction) => ({
          ...action,
          status: normalizeStatus(action, 'skipped'),
        })),
      ];
      setActions(combined);
      setPermissions({
        canApprove: !!data?.permissions?.canApprove,
        canExecute: !!data?.permissions?.canExecute,
        canSchedule: !!data?.permissions?.canSchedule,
        canSkip: !!data?.permissions?.canSkip,
        canManageConnectors: !!data?.permissions?.canManageConnectors,
      });
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load actions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadActions();
  }, [tenantId]);

  const statusFilter = useMemo(() => {
    const queryStatus = typeof router.query?.status === 'string' ? router.query.status : '';
    return queryStatus.toLowerCase();
  }, [router.query]);

  const riskFilter = useMemo(() => {
    const queryRisk = typeof router.query?.risk === 'string' ? router.query.risk : '';
    return queryRisk.toLowerCase();
  }, [router.query]);

  useEffect(() => {
    if (statusFilter === 'failed') {
      setActiveTab('Completed');
      return;
    }
    if (statusFilter === 'pending') {
      setActiveTab('Pending');
      return;
    }
    if (statusFilter === 'scheduled') {
      setActiveTab('Scheduled');
      return;
    }
    if (statusFilter === 'skipped') {
      setActiveTab('Skipped');
      return;
    }
    if (statusFilter === 'executed') {
      setActiveTab('Completed');
    }
  }, [statusFilter]);

  const filteredActions = useMemo(() => {
    const tabMatches = actions.filter(
      (action) => action.status.toLowerCase() === activeTab.toLowerCase()
    );
    const statusFiltered =
      statusFilter === 'failed'
        ? tabMatches.filter((action) => action.status.toLowerCase() === 'failed')
        : statusFilter === 'executed'
          ? tabMatches.filter((action) => action.status.toLowerCase() === 'executed')
          : tabMatches;
    if (!riskFilter) return statusFiltered;
    return statusFiltered.filter(
      (action) => (action.risk_level || '').toLowerCase() === riskFilter
    );
  }, [actions, activeTab, statusFilter, riskFilter]);

  const buildPlaybookSnapshot = (action: PendingAction): PlaybookValidationInput | null => {
    if (!action.tone_limits && !action.safety_rules && !action.execution_modes_config) return null;
    const toneStyle = action.tone_used || action.tone || action.tone_limits?.style || 'professional';
    const tone = action.tone_limits
      ? {
          style: (action.tone_limits.style || toneStyle) as 'professional' | 'friendly' | 'empathetic',
          emoji_allowed: action.tone_limits.emoji_allowed ?? true,
          max_length: action.tone_limits.max_length ?? 280,
        }
      : undefined;
    const safety = action.safety_rules
      ? {
          block_urls: Boolean(action.safety_rules.block_urls),
          block_sensitive_topics: Boolean(action.safety_rules.block_sensitive_topics),
          prohibited_words: action.safety_rules.prohibited_words || [],
        }
      : undefined;
    return {
      tone,
      safety,
      execution_modes: action.execution_modes_config || undefined,
    } as PlaybookValidationInput;
  };

  const validatePlaybookReply = (action: PendingAction, text: string) => {
    const isReply = (action.action_type || '').toString().toLowerCase() === 'reply';
    if (isReply && !text.trim()) return 'Reply text is required.';
    const playbookSnapshot = buildPlaybookSnapshot(action);
    const validation = validateActionAgainstPlaybook(
      {
        action_type: action.action_type,
        text,
        execution_mode: action.execution_mode || 'manual',
        risk_level: action.risk_level,
      },
      playbookSnapshot,
      null
    );
    if (!validation.allowed) {
      return validation.reason || 'Playbook validation failed.';
    }
    return null;
  };

  const handleExecute = async (action: PendingAction) => {
    if (!tenantId || executingActionId) return;
    setExecutingActionId(action.action_id);
    setErrorMessage(null);
    try {
      const response = await apiFetch('/api/community-ai/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          action_id: action.action_id,
          approved: true,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Execution failed');
      }
      setActions((prev) =>
        prev.map((entry) =>
          entry.action_id === action.action_id
            ? {
                ...entry,
                status: data?.status || 'executed',
                execution_result: data?.execution || null,
              }
            : entry
        )
      );
      await loadActions();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Execution failed');
    } finally {
      setExecutingActionId(null);
    }
  };

  const handleApprove = async (action: PendingAction) => {
    if (!tenantId || executingActionId) return;
    setExecutingActionId(action.action_id);
    setErrorMessage(null);
    try {
      const response = await apiFetch('/api/community-ai/actions/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          action_id: action.action_id,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Approval failed');
      }
      setActions((prev) =>
        prev.map((entry) =>
          entry.action_id === action.action_id
            ? {
                ...entry,
                status: data?.status || 'approved',
              }
            : entry
        )
      );
      await loadActions();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Approval failed');
    } finally {
      setExecutingActionId(null);
    }
  };

  const openManualExecute = (action: PendingAction) => {
    setManualAction(action);
    setManualDraft(action.suggested_text || '');
    setManualError(null);
  };

  const closeManualExecute = () => {
    setManualAction(null);
    setManualDraft('');
    setManualError(null);
    setManualSending(false);
  };

  const handleManualExecute = async () => {
    if (!tenantId || !manualAction || manualSending) return;
    const isReply = (manualAction.action_type || '').toString().toLowerCase() === 'reply';
    const draftText = manualDraft.trim();
    const finalText = isReply ? draftText : draftText || 'n/a';
    const violation = validatePlaybookReply(manualAction, finalText);
    if (violation) {
      setManualError(violation);
      return;
    }

    setManualSending(true);
    setExecutingActionId(manualAction.action_id);
    setErrorMessage(null);
    try {
      const response = await apiFetch('/api/community-ai/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          action_id: manualAction.action_id,
          approved: true,
          execution_mode: 'manual',
          final_text: finalText,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Execution failed');
      }
      setActions((prev) =>
        prev.map((entry) =>
          entry.action_id === manualAction.action_id
            ? {
                ...entry,
                status: data?.status || 'executed',
                execution_result: data?.execution || null,
                final_text: finalText,
              }
            : entry
        )
      );
      closeManualExecute();
      await loadActions();
    } catch (error: any) {
      setManualError(error?.message || 'Execution failed');
    } finally {
      setManualSending(false);
      setExecutingActionId(null);
    }
  };

  const openPlatformView = (action: PendingAction) => {
    setPlatformViewAction(action);
    setPlatformReplyDraft(action.suggested_text || '');
    setPlatformReplyError(null);
  };

  const closePlatformView = () => {
    setPlatformViewAction(null);
    setPlatformReplyDraft('');
    setPlatformReplyError(null);
    setPlatformReplySending(false);
  };

  const handlePlatformReplyLog = async () => {
    if (!tenantId || !platformViewAction || platformReplySending) return;
    const isReply = (platformViewAction.action_type || '').toString().toLowerCase() === 'reply';
    const draftText = platformReplyDraft.trim();
    const finalText = isReply ? draftText : draftText || 'n/a';
    const violation = validatePlaybookReply(platformViewAction, finalText);
    if (violation) {
      setPlatformReplyError(violation);
      return;
    }

    setPlatformReplySending(true);
    setExecutingActionId(platformViewAction.action_id);
    setErrorMessage(null);
    try {
      const response = await apiFetch('/api/community-ai/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          action_id: platformViewAction.action_id,
          approved: true,
          execution_mode: 'manual',
          final_text: finalText,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Execution failed');
      }
      setActions((prev) =>
        prev.map((entry) =>
          entry.action_id === platformViewAction.action_id
            ? {
                ...entry,
                status: data?.status || 'executed',
                execution_result: data?.execution || null,
                final_text: finalText,
              }
            : entry
        )
      );
      closePlatformView();
      await loadActions();
    } catch (error: any) {
      setPlatformReplyError(error?.message || 'Execution failed');
    } finally {
      setPlatformReplySending(false);
      setExecutingActionId(null);
    }
  };

  const handleSkip = (action: PendingAction) => {
    if (!tenantId || executingActionId) return;
    setExecutingActionId(action.action_id);
    setErrorMessage(null);
    apiFetch('/api/community-ai/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        organization_id: tenantId,
        action_id: action.action_id,
        status: 'skipped',
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || 'Skip failed');
        }
        setActions((prev) =>
          prev.map((entry) =>
            entry.action_id === action.action_id ? { ...entry, status: 'skipped' } : entry
          )
        );
        await loadActions();
      })
      .catch((error: any) => {
        setErrorMessage(error?.message || 'Skip failed');
      })
      .finally(() => {
        setExecutingActionId(null);
      });
  };

  const handleSchedule = async (action: PendingAction) => {
    if (!tenantId || executingActionId) return;
    const scheduledAt = scheduleDrafts[action.action_id];
    if (!scheduledAt) {
      setErrorMessage('Select a schedule date/time first.');
      return;
    }
    setExecutingActionId(action.action_id);
    setErrorMessage(null);
    try {
      const response = await apiFetch('/api/community-ai/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          action_id: action.action_id,
          status: 'scheduled',
          scheduled_at: new Date(scheduledAt).toISOString(),
          approved: true,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Schedule failed');
      }
      setActions((prev) =>
        prev.map((entry) =>
          entry.action_id === action.action_id
            ? { ...entry, status: 'scheduled', scheduled_at: data?.scheduled_at || scheduledAt }
            : entry
        )
      );
      await loadActions();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Schedule failed');
    } finally {
      setExecutingActionId(null);
    }
  };

  const handleViewHistory = async (action: PendingAction) => {
    if (!tenantId) return;
    setHistoryActionId(action.action_id);
    setHistoryError(null);
    if (historyCache[action.action_id]) {
      setHistoryEvents(historyCache[action.action_id]);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await apiFetch(
        `/api/community-ai/actions/history?tenant_id=${encodeURIComponent(
          tenantId
        )}&organization_id=${encodeURIComponent(tenantId)}&action_id=${encodeURIComponent(
          action.action_id
        )}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load history');
      }
      const events = data?.events || [];
      setHistoryEvents(events);
      setHistoryCache((prev) => ({ ...prev, [action.action_id]: events }));
    } catch (error: any) {
      setHistoryError(error?.message || 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const formatExecutionResult = (value: any) => {
    if (!value) return '-';
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 80 ? `${serialized.slice(0, 77)}...` : serialized;
    } catch {
      return 'unavailable';
    }
  };

  const formatIntent = (value: any) => {
    if (!value) return '-';
    if (typeof value === 'string') return value;
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 80 ? `${serialized.slice(0, 77)}...` : serialized;
    } catch {
      return 'unavailable';
    }
  };

  const context = useMemo(
    () => ({
      tenant_id: tenantId,
      organization_id: tenantId,
      actions,
      active_tab: activeTab,
    }),
    [tenantId, actions, activeTab]
  );
  const manualToneLimits = manualAction?.tone_limits || null;
  const manualMaxLength = manualToneLimits?.max_length ?? 280;
  const manualEmojiAllowed = manualToneLimits?.emoji_allowed ?? true;
  const manualRequiresText =
    (manualAction?.action_type || '').toString().toLowerCase() === 'reply';
  const manualDraftTrimmed = manualDraft.trim();
  const manualFinalText = manualRequiresText ? manualDraftTrimmed : manualDraftTrimmed || 'n/a';
  const manualToneStyle =
    manualAction?.tone_used || manualAction?.tone || manualToneLimits?.style || '—';
  const manualViolation = manualAction
    ? validatePlaybookReply(manualAction, manualFinalText)
    : null;
  const manualCanSend =
    Boolean(manualAction) &&
    (!manualRequiresText || manualDraftTrimmed.length > 0) &&
    !manualViolation &&
    !manualSending;
  const platformToneLimits = platformViewAction?.tone_limits || null;
  const platformMaxLength = platformToneLimits?.max_length ?? 280;
  const platformEmojiAllowed = platformToneLimits?.emoji_allowed ?? true;
  const platformRequiresText =
    (platformViewAction?.action_type || '').toString().toLowerCase() === 'reply';
  const platformDraftTrimmed = platformReplyDraft.trim();
  const platformFinalText = platformRequiresText
    ? platformDraftTrimmed
    : platformDraftTrimmed || 'n/a';
  const platformToneStyle =
    platformViewAction?.tone_used ||
    platformViewAction?.tone ||
    platformToneLimits?.style ||
    '—';
  const platformViolation = platformViewAction
    ? validatePlaybookReply(platformViewAction, platformFinalText)
    : null;
  const platformCanLog =
    Boolean(platformViewAction) &&
    (!platformRequiresText || platformDraftTrimmed.length > 0) &&
    !platformViolation &&
    !platformReplySending;
  const platformUrl =
    platformViewAction?.target_url || platformViewAction?.target_id || '';


  return {
    actions,
    activeTab,
    buildPlaybookSnapshot,
    closeManualExecute,
    closePlatformView,
    context,
    errorMessage,
    executingActionId,
    filteredActions,
    formatExecutionResult,
    formatIntent,
    handleApprove,
    handleExecute,
    handleManualExecute,
    handlePlatformReplyLog,
    handleSchedule,
    handleSkip,
    handleViewHistory,
    historyActionId,
    historyCache,
    historyError,
    historyEvents,
    historyLoading,
    isLoading,
    loadActions,
    manualAction,
    manualCanSend,
    manualDraft,
    manualDraftTrimmed,
    manualEmojiAllowed,
    manualError,
    manualFinalText,
    manualMaxLength,
    manualRequiresText,
    manualSending,
    manualToneLimits,
    manualToneStyle,
    manualViolation,
    normalizeStatus,
    openManualExecute,
    openPlatformView,
    permissions,
    platformCanLog,
    platformDraftTrimmed,
    platformEmojiAllowed,
    platformFinalText,
    platformMaxLength,
    platformReplyDraft,
    platformReplyError,
    platformReplySending,
    platformRequiresText,
    platformToneLimits,
    platformToneStyle,
    platformUrl,
    platformViewAction,
    platformViolation,
    riskFilter,
    router,
    scheduleDrafts,
    selectedCompanyId,
    setActions,
    setActiveTab,
    setErrorMessage,
    setExecutingActionId,
    setHistoryActionId,
    setHistoryCache,
    setHistoryError,
    setHistoryEvents,
    setHistoryLoading,
    setIsLoading,
    setManualAction,
    setManualDraft,
    setManualError,
    setManualSending,
    setPermissions,
    setPlatformReplyDraft,
    setPlatformReplyError,
    setPlatformReplySending,
    setPlatformViewAction,
    setScheduleDrafts,
    statusFilter,
    tenantId,
    validatePlaybookReply,
  };
}
