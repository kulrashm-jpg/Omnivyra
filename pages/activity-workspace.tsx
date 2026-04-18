import { useActivityWorkspace } from '../hooks/useActivityWorkspace';
import ActivityWorkspaceView from '../components/ActivityWorkspaceView';

export default function ActivityWorkspacePage() {
  const d = useActivityWorkspace();
  if (d._ef1) return null;
  if (d._ef2) return null;
  return <ActivityWorkspaceView d={d} />;
}
