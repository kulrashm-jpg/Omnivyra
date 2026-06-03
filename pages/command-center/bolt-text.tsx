import { useBoltStrategy } from '../../hooks/useBoltStrategy';
import BoltStrategyView from '../../components/BoltStrategyView';
import PageLoader from '../../components/PageLoader';

export const CANONICAL_RUNTIME_ROUTE = '/command-center/bolt-text';
export const STRATEGY_STATE_OWNER = 'hooks/useBoltStrategy.tsx';

export default function BoltTextPage() {
  const strategy = useBoltStrategy();
  if (strategy._ef1) return <PageLoader message="Loading BOLT…" />;
  if (strategy._ef2) return <PageLoader message="Loading BOLT…" />;
  return <BoltStrategyView d={strategy} />;
}
