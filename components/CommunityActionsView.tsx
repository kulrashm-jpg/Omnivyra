import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from './CompanyContext';
import CommunityAiLayout from './community-ai/CommunityAiLayout';
import SectionCard from './community-ai/SectionCard';
import { fetchWithAuth } from './community-ai/fetchWithAuth';
import type { PendingAction } from './community-ai/types';
import {
  validateActionAgainstPlaybook,
  type PlaybookValidationInput,
} from '../backend/services/playbooks/playbookValidator';

const tabs = ['Pending', 'Scheduled', 'Completed', 'Skipped'];

import type { useCommunityActions } from '../hooks/useCommunityActions';
type S = ReturnType<typeof useCommunityActions>;
export default function CommunityActionsView({ d }: { d: S }) {
  const {
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
  } = d;

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
                <th className="px-3 py-2">playbook</th>
                <th className="px-3 py-2">intent</th>
                <th className="px-3 py-2">tone</th>
                <th className="px-3 py-2">execution</th>
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
                const isExecuting = executingActionId === action.action_id;
                const showHighRisk = action.risk_level?.toLowerCase() === 'high';
                const executionModeLabel = (action.execution_mode || 'manual').toLowerCase();
                const executionConfig = action.execution_modes_config || null;
                const isLegacyExecution = !executionConfig;
                const isManualOnly = executionConfig?.manual_only === true;
                const apiAllowed = executionConfig?.api_allowed ?? false;
                const rpaAllowed = executionConfig?.rpa_allowed ?? false;
                const isManualExecution = isManualOnly;
                const autoExecutionBlocked =
                  isLegacyExecution ||
                  isManualOnly ||
                  (executionModeLabel === 'api' && apiAllowed === false) ||
                  (executionModeLabel === 'rpa' && rpaAllowed === false);
                const autoExecutionAllowed = !autoExecutionBlocked;
                const manualExecutionCheck = validateActionAgainstPlaybook(
                  {
                    action_type: action.action_type,
                    text: action.suggested_text || '',
                    execution_mode: 'manual',
                    risk_level: action.risk_level,
                  },
                  buildPlaybookSnapshot(action),
                  null
                );
                const manualAllowedByPlaybook = manualExecutionCheck.allowed;
                const hasManualConfig = Boolean(executionConfig);
                const isApproved = status === 'approved';
                const isPending = status === 'pending';
                const showApprove =
                  requiresApproval &&
                  isPending &&
                  !isTerminal &&
                  permissions.canApprove &&
                  !isManualExecution;
                const showManualExecute =
                  !isTerminal &&
                  permissions.canExecute &&
                  isApproved &&
                  hasManualConfig &&
                  manualAllowedByPlaybook;
                const showAutoExecute =
                  !requiresApproval && !isTerminal && permissions.canExecute;
                const showPlatformView = !isTerminal && isManualExecution;
                const showSchedule = !isTerminal && permissions.canSchedule;
                const showSkip = !isTerminal && permissions.canSkip;
                const showNoPermission =
                  !showApprove &&
                  !showManualExecute &&
                  !showAutoExecute &&
                  !showPlatformView &&
                  !showSchedule &&
                  !showSkip &&
                  !isTerminal;
                const autoExecuted =
                  action.last_event_type === 'auto_executed' ||
                  action.last_event?.event_type === 'auto_executed';
                const ruleName = action.rule_name || action.last_event?.rule_name;
                const ruleMatch = action.rule_match && action.status === 'pending';
                const playbookName = action.playbook_name || '—';
                const intent =
                  action.intent_classification?.primary_intent ||
                  action.intent_classification?.intent ||
                  'mixed';
                const toneUsed = action.tone_used || action.tone || '—';
                const executionLabel = isLegacyExecution
                  ? 'Legacy action – no playbook metadata'
                  : executionModeLabel || 'manual';
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
                    <td className="px-3 py-2" title={`Governed by Playbook: ${playbookName}`}>
                      {playbookName}
                    </td>
                    <td className="px-3 py-2">{intent}</td>
                    <td className="px-3 py-2">{toneUsed}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span>{executionLabel}</span>
                        {isLegacyExecution && (
                          <span className="text-[11px] text-amber-600">🟡 Legacy Action</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{requiresApproval ? 'yes' : 'no'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span>{action.status}</span>
                        {autoExecuted && (
                          <span
                            className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200"
                            title={`Executed by Auto-Rule${ruleName ? `: ${ruleName}` : ''}`}
                          >
                            🟢 Auto-Executed
                          </span>
                        )}
                        {!autoExecuted && ruleMatch && (
                          <span
                            className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200"
                            title="Will auto-execute when approved by rule conditions"
                          >
                            🟡 Rule Match
                          </span>
                        )}
                      </div>
                    </td>
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
                            onClick={() => handleApprove(action)}
                            disabled={isExecuting}
                          >
                            {isExecuting ? 'Approving...' : 'Approve'}
                          </button>
                        )}
                        {showManualExecute && (
                          <button
                            className="px-2 py-1 text-xs rounded border border-emerald-500 text-emerald-600"
                            onClick={() => openManualExecute(action)}
                            disabled={!permissions.canExecute || isExecuting}
                          >
                            Execute Manually
                          </button>
                        )}
                        {showPlatformView && (
                          <button
                            className="px-2 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
                            onClick={() => openPlatformView(action)}
                            disabled={!action.target_url && !action.target_id}
                          >
                            Open in Platform View
                          </button>
                        )}
                        {showAutoExecute && (
                          <button
                            className="px-2 py-1 text-xs rounded border border-emerald-500 text-emerald-600"
                            onClick={() => handleExecute(action)}
                            disabled={!permissions.canExecute || isExecuting || !autoExecutionAllowed}
                            title={
                              autoExecutionAllowed
                                ? 'Execute via configured automation path'
                                : 'Blocked by Playbook execution mode'
                            }
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
      {manualAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-4 sm:p-6 max-w-2xl w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">Execute Manually</h3>
                <div className="text-xs text-gray-500">{manualAction.action_id}</div>
              </div>
              <button className="text-sm text-gray-500" onClick={closeManualExecute}>
                Close
              </button>
            </div>
            <div className="text-sm text-gray-600 mb-3">
              <div>
                {manualAction.platform} • {manualAction.action_type} •{' '}
                {manualAction.playbook_name || 'No playbook'}
              </div>
              <div className="text-xs text-gray-400">
                Tone: {manualToneStyle} · Max {manualMaxLength} chars · Emoji{' '}
                {manualEmojiAllowed ? 'allowed' : 'not allowed'}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-500">Suggested reply</label>
              <textarea
                className="w-full border rounded-lg p-3 text-sm"
                rows={5}
                maxLength={manualMaxLength}
                value={manualDraft}
                onChange={(event) => setManualDraft(event.target.value)}
              />
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>
                  {manualDraft.length}/{manualMaxLength} characters
                </span>
                {!manualEmojiAllowed && <span>Emojis are not allowed.</span>}
              </div>
              {manualViolation && !manualError && (
                <div className="text-sm text-red-600">{manualViolation}</div>
              )}
              {manualError && <div className="text-sm text-red-600">{manualError}</div>}
            </div>
            <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-gray-300 text-gray-600"
                onClick={closeManualExecute}
                disabled={manualSending}
              >
                Cancel
              </button>
              <button
                className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-emerald-500 text-emerald-600"
                onClick={handleManualExecute}
                disabled={!manualCanSend}
              >
                {manualSending ? 'Sending...' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
      {platformViewAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-4 sm:p-6 max-w-5xl w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">Platform View</h3>
                <div className="text-xs text-gray-500">{platformViewAction.action_id}</div>
              </div>
              <button className="text-sm text-gray-500" onClick={closePlatformView}>
                Close
              </button>
            </div>
            <div className="text-sm text-gray-600 mb-4">
              <div>
                {platformViewAction.platform} • {platformViewAction.action_type} •{' '}
                {platformViewAction.playbook_name || 'No playbook'}
              </div>
              <div className="text-xs text-gray-400">
                Tone: {platformToneStyle} · Max {platformMaxLength} chars · Emoji{' '}
                {platformEmojiAllowed ? 'allowed' : 'not allowed'}
              </div>
            </div>
            {!platformUrl ? (
              <div className="text-sm text-red-600">
                No platform URL available for this action.
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden mb-4">
                <iframe
                  className="w-full h-[420px]"
                  src={platformUrl}
                  title="Platform view"
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs text-gray-500">Reply text to log</label>
              <textarea
                className="w-full border rounded-lg p-3 text-sm"
                rows={4}
                maxLength={platformMaxLength}
                value={platformReplyDraft}
                onChange={(event) => setPlatformReplyDraft(event.target.value)}
              />
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>
                  {platformReplyDraft.length}/{platformMaxLength} characters
                </span>
                {!platformEmojiAllowed && <span>Emojis are not allowed.</span>}
              </div>
              {platformViolation && !platformReplyError && (
                <div className="text-sm text-red-600">{platformViolation}</div>
              )}
              {platformReplyError && (
                <div className="text-sm text-red-600">{platformReplyError}</div>
              )}
            </div>
            <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-gray-300 text-gray-600"
                onClick={closePlatformView}
                disabled={platformReplySending}
              >
                Cancel
              </button>
              <button
                className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-emerald-500 text-emerald-600"
                onClick={handlePlatformReplyLog}
                disabled={!platformCanLog || !platformUrl}
              >
                {platformReplySending ? 'Logging...' : 'Log as Executed'}
              </button>
            </div>
          </div>
        </div>
      )}
      {historyActionId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-4 sm:p-6 max-w-2xl w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">Action History</h3>
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
                  {event.audit && (
                    <div className="mt-2 text-xs text-gray-500 space-y-1">
                      {event.audit.playbook_id && (
                        <div>Playbook: {event.audit.playbook_id}</div>
                      )}
                      {event.audit.intent && (
                        <div>Intent: {formatIntent(event.audit.intent)}</div>
                      )}
                      {event.audit.execution_mode && (
                        <div>Mode: {event.audit.execution_mode}</div>
                      )}
                      {event.audit.user_id && <div>User: {event.audit.user_id}</div>}
                      {event.audit.timestamp && (
                        <div>Timestamp: {event.audit.timestamp}</div>
                      )}
                      {event.audit.final_text && (
                        <div>Final message: {event.audit.final_text}</div>
                      )}
                    </div>
                  )}
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


