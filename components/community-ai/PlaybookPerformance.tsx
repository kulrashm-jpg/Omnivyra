import React, { useMemo } from 'react';

type PlaybookPerformanceRow = {
  playbook_id: string | null;
  playbook_name: string;
  automation_level: 'observe' | 'assist' | 'automate';
  discovered_users_count: number;
  eligible_users_count: number;
  execution_rate: number;
  top_platforms: Array<{ platform: string; discovered_users_count: number }>;
};

type PlaybookPerformanceProps = {
  rows: PlaybookPerformanceRow[];
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export default function PlaybookPerformance({ rows }: PlaybookPerformanceProps) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.eligible_users_count - a.eligible_users_count),
    [rows]
  );

  if (sorted.length === 0) {
    return <div className="text-sm text-gray-400">No playbook data available yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-left text-gray-700">
        <thead className="text-xs uppercase text-gray-500 border-b">
          <tr>
            <th className="px-3 py-2">Playbook Name</th>
            <th className="px-3 py-2">Automation Level</th>
            <th className="px-3 py-2">Discovered Users</th>
            <th className="px-3 py-2">Eligible Users</th>
            <th className="px-3 py-2">Execution Rate</th>
            <th className="px-3 py-2">Top Platform</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.playbook_id || row.playbook_name} className="border-b">
              <td className="px-3 py-2">{row.playbook_name}</td>
              <td className="px-3 py-2">
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-200">
                  {row.automation_level}
                </span>
              </td>
              <td className="px-3 py-2">{row.discovered_users_count}</td>
              <td className="px-3 py-2">{row.eligible_users_count}</td>
              <td className="px-3 py-2">{formatPercent(row.execution_rate)}</td>
              <td className="px-3 py-2">
                {row.top_platforms?.[0]?.platform || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
