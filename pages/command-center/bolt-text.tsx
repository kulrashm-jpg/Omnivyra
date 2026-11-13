import { useBoltStrategy } from '../../hooks/useBoltStrategy';
import BoltStrategyView from '../../components/BoltStrategyView';
import PageLoader from '../../components/PageLoader';
import CampaignWriteGate from '../../components/access/CampaignWriteGate';

export const CANONICAL_RUNTIME_ROUTE = '/command-center/bolt-text';
export const STRATEGY_STATE_OWNER = 'hooks/useBoltStrategy.tsx';

// F3: read-only roles get AccessRestricted; the BOLT hooks never run for them.
export default function BoltTextPage() {
  return (
    <CampaignWriteGate>
      <BoltTextPageInner />
    </CampaignWriteGate>
  );
}

function BoltTextPageInner() {
  const strategy = useBoltStrategy();
  if (strategy._ef1) return <PageLoader message="Loading BOLT…" />;
  if (strategy._ef2) return <PageLoader message="Loading BOLT…" />;
  return <BoltStrategyView d={strategy} />;
}
