import { useMarketingIntel } from '@/hooks/useMarketingIntel';
import MarketingIntelView from '@/components/MarketingIntelView';

export default function IntelligencePage() {
  const data = useMarketingIntel();

  if (data._ef1) return null;
  if (data._ef2) return null;

  return <MarketingIntelView d={data} />;
}
