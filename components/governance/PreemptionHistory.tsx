/**
 * Preemption History — Stage 10 Phase 5.
 * Filters events for PREEMPTION_EXECUTED, PREEMPTION_APPROVAL_REQUIRED, PREEMPTION_REJECTED.
 */

import React from 'react';
import { GitMerge } from 'lucide-react';

export interface GovernanceEvent {
  id: string;
  campaignId: string;
  eventType: string;
  eventStatus: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const PREEMPTION_TYPES = new Set([
  'PREEMPTION_EXECUTED',
  'PREEMPTION_APPROVAL_REQUIRED',
  'PREEMPTION_REJECTED',
]);

interface PreemptionHistoryProps {
  events: GovernanceEvent[];
}

export function PreemptionHistory({ events }: PreemptionHistoryProps) {
  const preemptionEvents = events.filter((e) => PREEMPTION_TYPES.has(e.eventType));

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border">
      <div className="flex items-center gap-2 mb-4">
        <GitMerge className="h-5 w-5 text-indigo-600" />
        <h2 className="text-xl font-semibold">Preemption History</h2>
      </div>

      {preemptionEvents.length === 0 ? (
        <p className="text-sm text-gray-500">No preemption activity.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium text-gray-600">Date</th>
                <th className="py-2 pr-4 font-medium text-gray-600">Target Campaign</th>
                <th className="py-2 pr-4 font-medium text-gray-600">Status</th>
                <th className="py-2 font-medium text-gray-600">Justification</th>
              </tr>
            </thead>
            <tbody>
              {preemptionEvents.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-3 pr-4 text-gray-700">
                    {new Date(e.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 pr-4 font-medium text-gray-900">
                    {(e.metadata.targetCampaignId as string) ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-gray-700">{e.eventStatus}</td>
                  <td className="py-3 text-gray-600">
                    {(e.metadata.justification as string) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
