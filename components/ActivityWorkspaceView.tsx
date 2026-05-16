import React from 'react';
import type { useActivityWorkspace } from '../hooks/useActivityWorkspace';
import ActivityWorkspaceHeader from './activity-workspace/ActivityWorkspaceHeader';
import ActivityWorkspaceTabs from './activity-workspace/ActivityWorkspaceTabs';
import ActivityWorkspaceCommunityPanels from './activity-workspace/ActivityWorkspaceCommunityPanels';
import ActivityWorkspaceBriefSection from './activity-workspace/ActivityWorkspaceBriefSection';
import CreatorWorkspaceOrchestrator from './activity-workspace/CreatorWorkspaceOrchestrator';

type S = ReturnType<typeof useActivityWorkspace>;

// Step-11 client flag. OFF (default) ⇒ existing behavior byte-identical.
// The Creator-native shell ALSO requires a reconstructed Creator task in
// the payload (Step-10), so Text rows never reach it even when ON.
const CREATOR_UI_ENABLED =
  String(process.env.NEXT_PUBLIC_ENABLE_CREATOR_WORKSPACE_UI ?? '')
    .trim()
    .toLowerCase() === '1' ||
  String(process.env.NEXT_PUBLIC_ENABLE_CREATOR_WORKSPACE_UI ?? '')
    .trim()
    .toLowerCase() === 'true';

export default function ActivityWorkspaceView({ d }: { d: S }) {
  const creatorTask =
    d.payload && (d.payload as any).creator_workspace
      ? (d.payload as any).creator_workspace
      : null;
  const showCreatorWorkspace = CREATOR_UI_ENABLED && Boolean(creatorTask);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <ActivityWorkspaceHeader d={d} />
        <ActivityWorkspaceTabs d={d} />
        {d.activityTab === 'content' ? (
          showCreatorWorkspace ? (
            <CreatorWorkspaceOrchestrator d={d} />
          ) : (
            <ActivityWorkspaceBriefSection d={d} />
          )
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
