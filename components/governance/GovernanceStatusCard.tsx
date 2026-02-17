/**
 * Governance Status Card — Stage 10 Phase 5.
 * Displays: Duration Weeks, Priority Level, Blueprint Status, Cooldown Badge, Latest Event.
 */

import React from 'react';
import { Shield, Clock, FileCheck } from 'lucide-react';

export interface GovernanceStatusData {
  durationWeeks: number | null;
  priorityLevel: string;
  blueprintStatus: string;
  durationLocked: boolean;
  lastPreemptedAt: string | null;
  cooldownActive: boolean;
  /** Stage 15: Blueprint locked when campaign is in execution */
  blueprintImmutable?: boolean;
  /** Stage 16: Blueprint frozen within execution window */
  blueprintFrozen?: boolean;
}

export interface LatestGovernanceEvent {
  eventType: string;
  eventStatus: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface GovernanceStatusCardProps {
  governance: GovernanceStatusData;
  latestEvent: LatestGovernanceEvent | null;
}

export function GovernanceStatusCard({ governance, latestEvent }: GovernanceStatusCardProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-5 w-5 text-indigo-600" />
        <h2 className="text-xl font-semibold">Governance Status</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div>
          <div className="text-sm font-medium text-gray-500">Duration Weeks</div>
          <div className="text-lg font-semibold text-gray-900">
            {governance.durationWeeks ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Priority Level</div>
          <div className="text-lg font-semibold text-gray-900">
            {governance.priorityLevel}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Blueprint Status</div>
          <div className="text-lg font-semibold text-gray-900">
            {governance.blueprintStatus}
          </div>
          {governance.durationLocked && (
            <span className="text-xs text-amber-600">(Locked)</span>
          )}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Cooldown</div>
          {governance.cooldownActive ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Cooldown Active
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              No Cooldown
            </span>
          )}
        </div>
      </div>

      {latestEvent && (
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Last Decision</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-gray-900">{latestEvent.eventType}</span>
            <span className="text-gray-600">({latestEvent.eventStatus})</span>
            <span className="text-gray-500">
              {new Date(latestEvent.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
