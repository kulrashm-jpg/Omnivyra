import { useBoltStrategy } from '../../hooks/useBoltStrategy';
import BoltStrategyView from '../../components/BoltStrategyView';

export const CANONICAL_RUNTIME_ROUTE = '/command-center/bolt-text';
export const STRATEGY_STATE_OWNER = 'hooks/useBoltStrategy.tsx';

export default function BoltTextPage() {
  const strategy = useBoltStrategy();
  if (strategy._ef1) return null;
  if (strategy._ef2) return null;
  return <BoltStrategyView d={strategy} />;
}
