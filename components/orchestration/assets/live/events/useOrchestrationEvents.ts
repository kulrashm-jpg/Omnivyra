/**
 * useOrchestrationEvents — Phase-2 Step-23.
 *
 * Subscribes a component to the shared per-campaign server-push channel and
 * routes every event through the Step-22 store hydrator. Returns the live
 * channel status so callers can decide whether the focus/revalidate
 * fallback should remain active (status !== 'open').
 *
 * Fail-soft: subscription failure → status 'fallback', no throw.
 */

import { useEffect, useState } from 'react';
import {
  subscribeCampaignEvents,
  type ChannelStatus,
} from './orchestrationEventClient';
import { hydrateFromEvent } from './orchestrationEventHydrator';

export function useOrchestrationEvents(campaignId?: string | null): {
  status: ChannelStatus;
  pushActive: boolean;
} {
  const [status, setStatus] = useState<ChannelStatus>('connecting');

  useEffect(() => {
    if (!campaignId) {
      setStatus('fallback');
      return;
    }
    let cancelled = false;
    const unsub = subscribeCampaignEvents(campaignId, {
      onEvent: (e) => { if (!cancelled) hydrateFromEvent(e); },
      onStatus: (s) => { if (!cancelled) setStatus(s); },
    });
    return () => { cancelled = true; unsub(); };
  }, [campaignId]);

  return { status, pushActive: status === 'open' };
}
