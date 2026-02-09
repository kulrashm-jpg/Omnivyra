import React from 'react';

type PlatformMixRow = {
  platform: string;
  discovered_users: number;
  share: number;
};

type PlatformMixProps = {
  rows: PlatformMixRow[];
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export default function PlatformMix({ rows }: PlatformMixProps) {
  if (!rows.length) {
    return <div className="text-sm text-gray-400">No platform distribution yet.</div>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.platform} className="flex items-center justify-between text-sm">
          <div className="capitalize text-gray-700">{row.platform}</div>
          <div className="text-gray-500">
            {row.discovered_users} · {formatPercent(row.share)}
          </div>
        </div>
      ))}
    </div>
  );
}
