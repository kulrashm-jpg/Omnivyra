import React from 'react';
import { MessageSquare, Lock } from 'lucide-react';
import type { useActivityWorkspace } from '../../hooks/useActivityWorkspace';

type S = ReturnType<typeof useActivityWorkspace>;

export default function ActivityWorkspaceTabs({ d }: { d: S }) {
  const { activityTab, setActivityTab, schedules } = d;

  // Content is considered "published" if any schedule row has status published/scheduling/scheduled
  const isPublished = schedules.some(
    (s: any) => s.status === 'published' || s.status === 'scheduled' || s.status === 'scheduling'
  );

  return (
    <div className="flex gap-1 border-b border-gray-200 mb-2">
      <button
        type="button"
        onClick={() => setActivityTab('content')}
        className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px ${
          activityTab === 'content' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-gray-600 hover:text-gray-900'
        }`}
      >
        Content
      </button>
      <button
        type="button"
        onClick={() => isPublished && setActivityTab('community_responses')}
        disabled={!isPublished}
        title={isPublished ? 'View community responses' : 'Available after content is published'}
        className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px flex items-center gap-1.5 ${
          !isPublished
            ? 'border-transparent text-gray-300 cursor-not-allowed'
            : activityTab === 'community_responses' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-gray-600 hover:text-gray-900'
        }`}
      >
        <MessageSquare className="h-4 w-4" />
        Community Responses
        {!isPublished && <Lock className="h-3 w-3 ml-0.5" />}
      </button>
      <button
        type="button"
        onClick={() => isPublished && setActivityTab('discussion')}
        disabled={!isPublished}
        title={isPublished ? 'Team discussion' : 'Available after content is published'}
        className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px flex items-center gap-1.5 ${
          !isPublished
            ? 'border-transparent text-gray-300 cursor-not-allowed'
            : activityTab === 'discussion' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-gray-600 hover:text-gray-900'
        }`}
      >
        Discussion
        {!isPublished && <Lock className="h-3 w-3 ml-0.5" />}
      </button>
    </div>
  );
}
