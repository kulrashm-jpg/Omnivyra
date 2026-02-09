import React, { useMemo } from 'react';

type NetworkHealthProps = {
  totalDiscoveredUsers: number;
  totalEligibleUsers: number;
  lastActivityAt: string | null;
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const computeTrend = (lastActivityAt: string | null) => {
  if (!lastActivityAt) return { label: 'No recent activity', direction: 'flat' as const };
  const lastDate = new Date(lastActivityAt);
  if (Number.isNaN(lastDate.getTime())) {
    return { label: 'No recent activity', direction: 'flat' as const };
  }
  const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return { label: 'Network activity is increasing', direction: 'up' as const };
  if (daysSince <= 14) return { label: 'Network activity is stable', direction: 'flat' as const };
  return { label: 'Network activity is slowing', direction: 'down' as const };
};

export default function NetworkHealth({
  totalDiscoveredUsers,
  totalEligibleUsers,
  lastActivityAt,
}: NetworkHealthProps) {
  const ineligibleUsers = Math.max(0, totalDiscoveredUsers - totalEligibleUsers);
  const eligibleRate = totalDiscoveredUsers
    ? totalEligibleUsers / totalDiscoveredUsers
    : 0;
  const ineligibleRate = totalDiscoveredUsers
    ? ineligibleUsers / totalDiscoveredUsers
    : 0;
  const trend = useMemo(() => computeTrend(lastActivityAt), [lastActivityAt]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-600">Eligible vs Ineligible</div>
        <div
          className={`text-sm ${
            trend.direction === 'up'
              ? 'text-emerald-600'
              : trend.direction === 'down'
                ? 'text-amber-600'
                : 'text-gray-500'
          }`}
        >
          {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.label}
        </div>
      </div>
      <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${Math.round(eligibleRate * 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <div>Eligible: {totalEligibleUsers} ({formatPercent(eligibleRate)})</div>
        <div>Ineligible: {ineligibleUsers} ({formatPercent(ineligibleRate)})</div>
      </div>
    </div>
  );
}
