import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import type { PendingAction } from '../../components/community-ai/types';

const tabs = ['Pending', 'Scheduled', 'Completed', 'Skipped'];

export default function CommunityAiActions() {
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
  });
  const [historyActionId, setHistoryActionId] = useState<string | null>(null);
  const [historyEvents, setHistoryEvents] = useState<
    Array<{
      action_id: string;
      event_type: string;
      event_payload: any;
      created_at: string;
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
      const response = await fetch(
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

  const handleExecute = async (action: PendingAction) => {
    if (!tenantId || executingActionId) return;
    setExecutingActionId(action.action_id);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/community-ai/actions/execute', {
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

  const handleSkip = (action: PendingAction) => {
    if (!tenantId || executingActionId) return;
    setExecutingActionId(action.action_id);
    setErrorMessage(null);
    fetch('/api/community-ai/actions', {
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
      const response = await fetch('/api/community-ai/actions', {
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
      const response = await fetch(
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

  const context = useMemo(
    () => ({
      tenant_id: tenantId,
      organization_id: tenantId,
      actions,
      active_tab: activeTab,
    }),
    [tenantId, actions, activeTab]
  );

  return (
    <CommunityAiLayout title="Action Center" context={context}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard title="Action Queue">
        {(statusFilter || riskFilter) && (
          <div className="flex flex-wrap items-center gap-2 text-xs mb-4">
            {statusFilter && (
              <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                Status: {statusFilter}
              </span>
            )}
            {riskFilter && (
              <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                Risk: {riskFilter}
              </span>
            )}
            <button
              className="ml-auto text-xs text-indigo-600"
              onClick={() => router.push('/community-ai/actions')}
            >
              Clear Filters ✕
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-sm mb-4">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 rounded-lg border ${
                activeTab === tab ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-gray-700">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-3 py-2">platform</th>
                <th className="px-3 py-2">post/thread</th>
                <th className="px-3 py-2">action type</th>
                <th className="px-3 py-2">risk level</th>
                <th className="px-3 py-2">approval</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">scheduled at</th>
                <th className="px-3 py-2">last event</th>
                <th className="px-3 py-2">execution result</th>
                <th className="px-3 py-2">actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredActions.map((action) => {
                const requiresApproval =
                  action.requires_human_approval ?? action.requires_approval ?? true;
                const status = action.status.toLowerCase();
                const isTerminal = ['executed', 'failed', 'skipped'].includes(status);
                const canExecute = !requiresApproval && !isTerminal && permissions.canExecute;
                const isExecuting = executingActionId === action.action_id;
                const showHighRisk = action.risk_level?.toLowerCase() === 'high';
                const showApprove = requiresApproval && !isTerminal && permissions.canApprove;
                const showExecute = !requiresApproval && !isTerminal && permissions.canExecute;
                const showSchedule = !isTerminal && permissions.canSchedule;
                const showSkip = !isTerminal && permissions.canSkip;
                const showNoPermission =
                  !showApprove && !showExecute && !showSchedule && !showSkip && !isTerminal;
                return (
                  <tr key={action.action_id} className="border-b">
                    <td className="px-3 py-2">{action.platform}</td>
                    <td className="px-3 py-2">{action.target_url || action.target_id}</td>
                    <td className="px-3 py-2">{action.action_type}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span>{action.risk_level}</span>
                        {showHighRisk && (
                          <span className="text-xs text-red-600 font-semibold">high risk</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{requiresApproval ? 'yes' : 'no'}</td>
                    <td className="px-3 py-2">{action.status}</td>
                    <td className="px-3 py-2">{action.scheduled_at || '-'}</td>
                    <td className="px-3 py-2">
                      {action.last_event
                        ? `${action.last_event.event_type} • ${action.last_event.created_at}`
                        : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-gray-600">
                        {formatExecutionResult(action.execution_result)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {showApprove && (
                          <button
                            className="px-2 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
                            onClick={() => handleExecute(action)}
                            disabled={isExecuting}
                          >
                            {isExecuting ? 'Approving...' : 'Approve'}
                          </button>
                        )}
                        {showExecute && (
                          <button
                            className="px-2 py-1 text-xs rounded border border-emerald-500 text-emerald-600"
                            onClick={() => handleExecute(action)}
                            disabled={!canExecute || isExecuting}
                          >
                            {isExecuting ? 'Executing...' : 'Execute'}
                          </button>
                        )}
                        {showSchedule && (
                          <div className="flex items-center gap-2">
                            <input
                              type="datetime-local"
                              className="px-2 py-1 text-xs border rounded"
                              value={scheduleDrafts[action.action_id] || ''}
                              onChange={(event) =>
                                setScheduleDrafts((prev) => ({
                                  ...prev,
                                  [action.action_id]: event.target.value,
                                }))
                              }
                            />
                            <button
                              className="px-2 py-1 text-xs rounded border border-blue-500 text-blue-600"
                              onClick={() => handleSchedule(action)}
                              disabled={isExecuting}
                            >
                              {isExecuting ? 'Scheduling...' : 'Schedule'}
                            </button>
                          </div>
                        )}
                        {showSkip && (
                          <button
                            className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                            onClick={() => handleSkip(action)}
                            disabled={isExecuting}
                          >
                            Skip
                          </button>
                        )}
                        {showNoPermission && (
                          <span
                            className="text-xs text-gray-400"
                            title="You do not have permission to perform this action"
                          >
                            No permission
                          </span>
                        )}
                        <button
                          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                          onClick={() => handleViewHistory(action)}
                          disabled={historyLoading && historyActionId === action.action_id}
                        >
                          {historyLoading && historyActionId === action.action_id
                            ? 'Loading...'
                            : 'View History'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && filteredActions.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-gray-400" colSpan={11}>
                    No actions in this tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      {historyActionId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold">Action History</h3>
                <div className="text-xs text-gray-500">{historyActionId}</div>
              </div>
              <button
                className="text-sm text-gray-500"
                onClick={() => {
                  setHistoryActionId(null);
                  setHistoryEvents([]);
                  setHistoryError(null);
                  setHistoryCache({});
                }}
              >
                Close
              </button>
            </div>
            {historyError && <div className="text-sm text-red-600">{historyError}</div>}
            {historyLoading && (
              <div className="text-sm text-gray-500">Loading history...</div>
            )}
            {!historyLoading && historyEvents.length === 0 && !historyError && (
              <div className="text-sm text-gray-500">No history events yet.</div>
            )}
            <div className="space-y-3">
              {historyEvents.map((event, index) => (
                <div key={`${event.action_id}-${index}`} className="text-sm text-gray-700">
                  <div className="font-semibold">{event.event_type}</div>
                  <div className="text-xs text-gray-400">{event.created_at}</div>
                  {event.event_payload ? (
                    <div className="text-xs text-gray-500">
                      {formatExecutionResult(event.event_payload)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </CommunityAiLayout>
  );
}

