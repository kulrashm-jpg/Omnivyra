import React from 'react';
import {
  ArrowLeft,
  Bookmark,
  ExternalLink,
  Loader2,
  MessageSquare,
  Save,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import ActivityDiscussionTab from '@/components/activity-workspace/ActivityDiscussionTab';
import PlatformIcon from '@/components/ui/PlatformIcon';
import type { ActivityTabKey, CommunitySignal, WorkspaceNotice, WorkspacePayload } from './types';

type ActivityWorkspaceShellProps = {
  notice: WorkspaceNotice;
  payload: WorkspacePayload;
  aiPreviewMessage: string | null;
  aiConfidenceMessage: string | null;
  activityTab: ActivityTabKey;
  onActivityTabChange: (tab: ActivityTabKey) => void;
  onBackToWeekPlan: () => void;
  onSaveChanges: () => void;
  currentUserId: string;
  discussionActivityId: string;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  communitySignalsLoading: boolean;
  communitySignals: CommunitySignal[];
};

export function WorkspaceMissingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900">Workspace not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          This activity workspace is missing or expired. Please open it again from Daily Planning.
        </p>
        <button
          onClick={() => window.close()}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default function ActivityWorkspaceShell({
  notice,
  payload,
  aiPreviewMessage,
  aiConfidenceMessage,
  activityTab,
  onActivityTabChange,
  onBackToWeekPlan,
  onSaveChanges,
  currentUserId,
  discussionActivityId,
  apiFetch,
  communitySignalsLoading,
  communitySignals,
}: ActivityWorkspaceShellProps) {
  return (
    <>
      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-indigo-200 bg-indigo-50 text-indigo-800'
          }`}
          role="status"
          aria-live="polite"
        >
          {notice.message}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity Content Workspace</h1>
          <p className="text-sm text-gray-600">
            Week {payload.weekNumber || '-'} • {payload.day || '-'} • {payload.title || 'Untitled activity'}
            {(payload as any).distribution_strategy && (
              <> • Distribution: {String((payload as any).distribution_strategy).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}</>
            )}
          </p>
          {(payload as any).distribution_reason && (
            <p className="mt-0.5 text-xs text-gray-500">Why: {(payload as any).distribution_reason}</p>
          )}
          {(payload as any).planning_adjustment_reason && (
            <p className="mt-0.5 text-xs text-gray-500">{(payload as any).planning_adjustment_reason}</p>
          )}
          {(payload as any).planning_adjustments_summary?.text && (
            <p className="mt-0.5 text-xs text-gray-500">What changed: {(payload as any).planning_adjustments_summary.text}</p>
          )}
          {(payload as any).momentum_adjustments?.absorbed_from_week?.length ? (
            <p className="mt-0.5 text-xs text-gray-500">
              Momentum adjusted from Week {(payload as any).momentum_adjustments.absorbed_from_week.join(', ')}
              {(payload as any).momentum_adjustments?.momentum_transfer_strength ? (
                <> • Momentum: {(payload as any).momentum_adjustments.momentum_transfer_strength.charAt(0).toUpperCase()}{(payload as any).momentum_adjustments.momentum_transfer_strength.slice(1)} adjustment</>
              ) : null}
            </p>
          ) : null}
          {(payload as any).week_extras?.recovered_topics?.length ? (
            <p
              className="mt-0.5 text-xs text-gray-500"
              title={((payload as any).week_extras.recovered_topics as Array<{ topic: string; recovered_from_week: number }>).map((r) => r.topic).join(', ')}
            >
              Narrative recovered from Week {((payload as any).week_extras.recovered_topics as Array<{ recovered_from_week: number }>).map((r) => r.recovered_from_week).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
            </p>
          ) : null}
          {aiPreviewMessage ? <p className="mt-0.5 text-xs italic text-slate-500">AI Preview: {aiPreviewMessage}</p> : null}
          {aiConfidenceMessage ? <p className="mt-0.5 text-xs italic text-slate-400">{aiConfidenceMessage}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onBackToWeekPlan}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to week plan
          </button>
          <button
            onClick={onSaveChanges}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            <Save className="h-4 w-4" />
            Save Changes
          </button>
          <button
            onClick={() => window.close()}
            className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-2 flex gap-1 border-b border-gray-200">
        <button
          type="button"
          onClick={() => onActivityTabChange('content')}
          className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${
            activityTab === 'content' ? 'border-indigo-600 bg-white text-indigo-600' : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Content
        </button>
        <button
          type="button"
          onClick={() => onActivityTabChange('community_responses')}
          className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${
            activityTab === 'community_responses' ? 'border-indigo-600 bg-white text-indigo-600' : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Community Responses
        </button>
        <button
          type="button"
          onClick={() => onActivityTabChange('discussion')}
          className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${
            activityTab === 'discussion' ? 'border-indigo-600 bg-white text-indigo-600' : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Discussion
        </button>
      </div>

      {activityTab === 'discussion' ? (
        <div className="min-h-[240px] overflow-hidden rounded-xl border border-gray-200 bg-white">
          {payload.campaignId && discussionActivityId ? (
            <ActivityDiscussionTab
              campaignId={payload.campaignId}
              activityId={discussionActivityId}
              currentUserId={currentUserId}
              apiFetch={apiFetch}
            />
          ) : (
            <div className="p-6 text-sm text-gray-500">Open an activity to view discussion.</div>
          )}
        </div>
      ) : activityTab === 'community_responses' ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Community Responses</h2>
          <p className="text-sm text-gray-600">
            Comments, mentions, and discussion threads linked to this campaign activity.
          </p>
          {communitySignalsLoading ? (
            <div className="flex items-center gap-2 py-8 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading signals...
            </div>
          ) : communitySignals.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
              No community responses yet. Engagement signals appear when comments, mentions, or discussions are detected for this activity.
            </div>
          ) : (
            <div className="space-y-3">
              {communitySignals.map((sig) => (
                <div
                  key={sig.id}
                  className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-4 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-medium text-gray-900">{sig.author || 'Anonymous'}</span>
                        <span>•</span>
                        <PlatformIcon platform={sig.platform} size={12} showLabel />
                        <span className="capitalize">{sig.signal_type.replace(/_/g, ' ')}</span>
                        <span>•</span>
                        <span>Score: {(Number(sig.engagement_score) * 100).toFixed(0)}%</span>
                        <span>•</span>
                        <span>{sig.detected_at ? new Date(sig.detected_at).toLocaleDateString() : '-'}</span>
                      </div>
                      <p className="line-clamp-3 text-sm text-gray-800">{sig.content || '-'}</p>
                      {sig.conversation_url && (
                        <a
                          href={sig.conversation_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View thread
                        </a>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" className="rounded border border-gray-300 p-2 text-gray-600 hover:bg-white hover:text-indigo-600" title="Reply">
                        <MessageSquare className="h-4 w-4" />
                      </button>
                      <button type="button" className="rounded border border-gray-300 p-2 text-gray-600 hover:bg-white hover:text-amber-600" title="Bookmark">
                        <Bookmark className="h-4 w-4" />
                      </button>
                      <button type="button" className="rounded border border-gray-300 p-2 text-gray-600 hover:bg-white hover:text-emerald-600" title="Mark as lead">
                        <UserPlus className="h-4 w-4" />
                      </button>
                      <button type="button" className="rounded border border-gray-300 p-2 text-gray-600 hover:bg-white hover:text-blue-600" title="Export to CRM">
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
