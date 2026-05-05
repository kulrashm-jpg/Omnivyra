import { useMemo } from 'react';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';
import {
  scoreColour,
  toSentenceCase,
  parseTargetNumber,
  formatContentTypeLabel,
  formatPlatformLabel,
  getContentRoute,
} from './viewModel.helpers';

export function useMarketingIntelViewModel(
  d: ReturnType<typeof useMarketingIntel>
) {
  return useMemo(() => {
    const helpers = {
      scoreColour,
      toSentenceCase,
      parseTargetNumber,
      formatContentTypeLabel,
      formatPlatformLabel,
      getContentRoute,
    };

    if (!d || d._ef1 || d._ef2) {
      return { helpers, kpis: null };
    }

    return { helpers, kpis: null };
  }, [d]);
}
