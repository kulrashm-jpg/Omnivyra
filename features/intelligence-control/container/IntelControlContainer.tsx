import { useIntelControl } from '@/hooks/useIntelControl';
import IntelControlView from '@/features/intelligence-control/view/IntelControlView';

export default function IntelControlContainer() {
  const { state, actions } = useIntelControl();
  if (state._ef1) return null;
  return <IntelControlView state={state} actions={actions} />;
}
