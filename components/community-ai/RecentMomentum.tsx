import React, { useMemo } from 'react';

type RecentMomentumProps = {
  lastActivityAt: string | null;
};

const resolveMomentum = (lastActivityAt: string | null) => {
  if (!lastActivityAt) {
    return { label: 'No recent activity detected.', window: '—' };
  }
  const lastDate = new Date(lastActivityAt);
  if (Number.isNaN(lastDate.getTime())) {
    return { label: 'No recent activity detected.', window: '—' };
  }
  const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) {
    return { label: 'Network activity is increasing over the last 7 days.', window: '7 days' };
  }
  if (daysSince <= 14) {
    return { label: 'Network activity is stable over the last 14 days.', window: '14 days' };
  }
  if (daysSince <= 30) {
    return { label: 'Network activity is slowing over the last 30 days.', window: '30 days' };
  }
  return { label: 'Network activity is slowing; no recent momentum.', window: '30+ days' };
};

export default function RecentMomentum({ lastActivityAt }: RecentMomentumProps) {
  const momentum = useMemo(() => resolveMomentum(lastActivityAt), [lastActivityAt]);

  return (
    <div className="text-sm text-gray-700 space-y-2">
      <div className="text-gray-600">Window: {momentum.window}</div>
      <div>{momentum.label}</div>
    </div>
  );
}
