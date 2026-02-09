import React from 'react';

type AutomationMix = {
  observe: number;
  assist: number;
  automate: number;
};

type ExecutiveSnapshotProps = {
  totalDiscoveredUsers: number;
  eligibilityRate: number;
  executionRate: number;
  automationMix: AutomationMix;
  lastActivityAt: string | null;
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatTimestamp = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

export default function ExecutiveSnapshot({
  totalDiscoveredUsers,
  eligibilityRate,
  executionRate,
  automationMix,
  lastActivityAt,
}: ExecutiveSnapshotProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-sm">
      <div className="border rounded-lg p-4">
        <div className="text-xs text-gray-500">Total discovered users</div>
        <div className="text-2xl font-semibold text-gray-900">{totalDiscoveredUsers}</div>
      </div>
      <div className="border rounded-lg p-4">
        <div className="text-xs text-gray-500">Eligibility rate</div>
        <div className="text-2xl font-semibold text-gray-900">{formatPercent(eligibilityRate)}</div>
      </div>
      <div className="border rounded-lg p-4">
        <div className="text-xs text-gray-500">Execution rate</div>
        <div className="text-2xl font-semibold text-gray-900">{formatPercent(executionRate)}</div>
      </div>
      <div className="border rounded-lg p-4">
        <div className="text-xs text-gray-500">Automation mix</div>
        <div className="text-sm text-gray-900 mt-2 space-y-1">
          <div>Observe: {formatPercent(automationMix.observe)}</div>
          <div>Assist: {formatPercent(automationMix.assist)}</div>
          <div>Automate: {formatPercent(automationMix.automate)}</div>
        </div>
      </div>
      <div className="border rounded-lg p-4">
        <div className="text-xs text-gray-500">Last activity</div>
        <div className="text-sm text-gray-900 mt-2">{formatTimestamp(lastActivityAt)}</div>
      </div>
    </div>
  );
}
