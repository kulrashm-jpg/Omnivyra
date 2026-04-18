import { useCommandCenter } from '../hooks/useCommandCenter';
import CommandCenterView from '../components/CommandCenterView';

export default function CommandCenterPage() {
  const d = useCommandCenter();
  if (d._ef1) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }
  return <CommandCenterView d={d} />;
}
