import { useMemo } from 'react';
import type { MarketingIntelData } from '@/features/marketing-intel/types';
import {
  scoreColour,
  toSentenceCase,
  parseTargetNumber,
  formatContentTypeLabel,
  formatPlatformLabel,
  getContentRoute,
} from './viewModel.helpers';

export function useMarketingIntelViewModel(
  d: MarketingIntelData
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
