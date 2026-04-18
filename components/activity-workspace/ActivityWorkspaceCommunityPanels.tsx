import React from 'react';
import { Bookmark, ExternalLink, Loader2, MessageSquare, Send, UserPlus } from 'lucide-react';
import ActivityDiscussionTab from '@/components/activity-workspace/ActivityDiscussionTab';
import PlatformIcon from '@/components/ui/PlatformIcon';
import type { useActivityWorkspace } from '../../hooks/useActivityWorkspace';

type S = ReturnType<typeof useActivityWorkspace>;

export default function ActivityWorkspaceCommunityPanels({ d }: { d: S }) {
  const {
    activityTab,
    communitySignals,
    communitySignalsLoading,
    payload,
    queryExecutionId,
    user,
  } = d;

  if (activityTab === 'discussion') {
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden min-h-[240px]">
        {payload?.campaignId && (queryExecutionId || payload?.activityId) ? (
          <ActivityDiscussionTab
            campaignId={payload.campaignId}
            activityId={queryExecutionId || payload.activityId || ''}
            currentUserId={user?.userId ?? ''}
            fetchWithAuth={async (input, init) => {
              const { getAuthToken } = await import('../../utils/getAuthToken');
              const token = await getAuthToken();
              return fetch(input, { ...init, headers: { ...(init?.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
            }}
          />
        ) : (
          <div className="p-6 text-sm text-gray-500">Open an activity to view discussion.</div>
        )}
      </div>
    );
  }

  if (activityTab !== 'community_responses') {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
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
          {communitySignals.map((signal) => (
            <div
              key={signal.id}
              className="rounded-lg border border-gray-200 p-4 bg-gray-50/50 hover:bg-gray-50 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <span className="font-medium text-gray-900">{signal.author || 'Anonymous'}</span>
                    <span>•</span>
                    <PlatformIcon platform={signal.platform} size={12} showLabel />
                    <span className="capitalize">{signal.signal_type.replace(/_/g, ' ')}</span>
                    <span>•</span>
                    <span>Score: {(Number(signal.engagement_score) * 100).toFixed(0)}%</span>
                    <span>•</span>
                    <span>{signal.detected_at ? new Date(signal.detected_at).toLocaleDateString() : '-'}</span>
                  </div>
                  <p className="text-sm text-gray-800 line-clamp-3">{signal.content || '-'}</p>
                  {signal.conversation_url && (
                    <a
                      href={signal.conversation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View thread
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-indigo-600"
                    title="Reply"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-amber-600"
                    title="Bookmark"
                  >
                    <Bookmark className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-emerald-600"
                    title="Mark as lead"
                  >
                    <UserPlus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-blue-600"
                    title="Export to CRM"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
