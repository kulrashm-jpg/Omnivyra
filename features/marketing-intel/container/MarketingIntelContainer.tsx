import { useMarketingIntel } from '@/hooks/useMarketingIntel';
import MarketingIntelView from '@/components/MarketingIntelView';

export default function MarketingIntelContainer() {
  const d = useMarketingIntel();

  if (d._ef1) return null;
  if (d._ef2) return null;

  return <MarketingIntelView d={d} />;
}
