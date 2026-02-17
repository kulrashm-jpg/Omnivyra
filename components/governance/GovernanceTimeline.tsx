/**
 * Governance Event Timeline — Stage 10 Phase 5.
 * Displays governance events in a table with metadata summaries.
 */

import React from 'react';
import { Clock } from 'lucide-react';

export interface GovernanceEvent {
  id: string;
  campaignId: string;
  eventType: string;
  eventStatus: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface GovernanceTimelineProps {
  events: GovernanceEvent[];
}

function formatMetadataSummary(eventType: string, metadata: Record<string, unknown>): string {
  switch (eventType) {
    case 'DURATION_NEGOTIATE': {
      const requested = metadata.requested_weeks as number | undefined;
      const max = metadata.max_weeks_allowed as number | undefined;
      if (requested != null && max != null) return `Requested ${requested} weeks, max allowed ${max}`;
      if (max != null) return `Max allowed: ${max} weeks`;
      return '—';
    }
    case 'PREEMPTION_EXECUTED': {
      const target = metadata.targetCampaignId as string | undefined;
      const justification = metadata.justification as string | undefined;
      const parts: string[] = [];
      if (target) parts.push(`Target: ${target}`);
      if (justification) parts.push(justification);
      return parts.length > 0 ? parts.join(' • ') : '—';
    }
    case 'SHIFT_START_DATE_SUGGESTED': {
      const date = metadata.newStartDate as string | undefined;
      return date ? `New start: ${new Date(date).toLocaleDateString()}` : '—';
    }
    case 'DURATION_REJECTED': {
      const count = metadata.blocking_constraints_count as number | undefined;
      return count != null ? `${count} blocking constraint(s)` : '—';
    }
    default:
      return Object.keys(metadata).length > 0 ? JSON.stringify(metadata).slice(0, 80) : '—';
  }
}

export function GovernanceTimeline({ events }: GovernanceTimelineProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-5 w-5 text-indigo-600" />
        <h2 className="text-xl font-semibold">Governance Timeline</h2>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-gray-500">No governance events recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium text-gray-600">Timestamp</th>
                <th className="py-2 pr-4 font-medium text-gray-600">Event Type</th>
                <th className="py-2 pr-4 font-medium text-gray-600">Status</th>
                <th className="py-2 font-medium text-gray-600">Metadata Summary</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-3 pr-4 text-gray-700">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 font-medium text-gray-900">{e.eventType}</td>
                  <td className="py-3 pr-4 text-gray-700">{e.eventStatus}</td>
                  <td className="py-3 text-gray-600">
                    {formatMetadataSummary(e.eventType, e.metadata)}
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
