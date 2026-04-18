import React from 'react';
import type { useActivityWorkspace } from '../hooks/useActivityWorkspace';
import ActivityWorkspaceHeader from './activity-workspace/ActivityWorkspaceHeader';
import ActivityWorkspaceTabs from './activity-workspace/ActivityWorkspaceTabs';
import ActivityWorkspaceCommunityPanels from './activity-workspace/ActivityWorkspaceCommunityPanels';
import ActivityWorkspaceBriefSection from './activity-workspace/ActivityWorkspaceBriefSection';

type S = ReturnType<typeof useActivityWorkspace>;

export default function ActivityWorkspaceView({ d }: { d: S }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <ActivityWorkspaceHeader d={d} />
        <ActivityWorkspaceTabs d={d} />
        {d.activityTab === 'content' ? (
          <ActivityWorkspaceBriefSection d={d} />
        ) : (
          <ActivityWorkspaceCommunityPanels d={d} />
        )}
      </div>
    </div>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}
