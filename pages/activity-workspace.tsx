import { useActivityWorkspace } from '../hooks/useActivityWorkspace';
import ActivityWorkspaceView from '../components/ActivityWorkspaceView';
import PageLoader from '../components/PageLoader';

export default function ActivityWorkspacePage() {
  const d = useActivityWorkspace();
  if (d._ef1) return <PageLoader message="Loading activity workspace…" />;
  if (d._ef2) return <PageLoader message="Loading activity workspace…" />;
  return <ActivityWorkspaceView d={d} />;
}
