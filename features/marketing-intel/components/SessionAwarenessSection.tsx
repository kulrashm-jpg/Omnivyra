import React from 'react';
import {
  MARKETING_INTEL_PROGRESS_STORAGE_KEY,
  deriveCurrentDoNowItems,
  normalizeActionProgress,
} from '@/features/marketing-intel/outcomeTracking';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function SessionAwarenessSection({ d }: Props) {
  const snapshot = d.snapshot;
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!snapshot) {
      setMessage(null);
      return;
    }

    const doNowItems = deriveCurrentDoNowItems(snapshot);

    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_PROGRESS_STORAGE_KEY);
      if (!saved) {
        setMessage(doNowItems.length > 0 ? 'System just initialized. Start with Do Now.' : null);
        return;
      }

      const progress = normalizeActionProgress(JSON.parse(saved));
      const pendingCount = doNowItems.filter((item) => progress[item.id]?.status !== 'completed').length;

      if (pendingCount > 0) {
        setMessage(`You have ${pendingCount} pending action${pendingCount === 1 ? '' : 's'} from last session.`);
      } else {
        setMessage('Last session’s urgent actions are complete. Move to the next system step.');
      }
    } catch {
      setMessage(doNowItems.length > 0 ? 'System just initialized. Start with Do Now.' : null);
    }
  }, [snapshot]);

  if (!snapshot || !message) return null;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-sm font-medium text-gray-700">{message}</p>
    </div>
  );
}
