/**
 * LEFT PANEL — Context: campaign navigation, filters.
 * Lightweight static panel. No workflow logic.
 */

import React from 'react';
import type { CampaignContextItem, ExecutionFilters } from './types';

export interface CampaignContextPanelProps {
  /** Current campaign (or primary context) */
  currentCampaign?: { id: string; name: string } | null;
  /** Optional list for campaign switcher / nav */
  campaigns?: CampaignContextItem[];
  /** Optional callback when user selects a campaign */
  onSelectCampaign?: (id: string) => void;
  /** Filter values (controlled). Labels only; parent can bind to state. */
  filters?: ExecutionFilters;
  onFiltersChange?: (filters: ExecutionFilters) => void;
  className?: string;
}

export default function CampaignContextPanel({
  currentCampaign,
  campaigns = [],
  onSelectCampaign,
  filters = {},
  onFiltersChange,
  className = '',
}: CampaignContextPanelProps) {
  return (
    <aside
      className={`flex flex-col w-56 flex-shrink-0 border-r border-gray-200 bg-gray-50/80 ${className}`}
      aria-label="Campaign context"
    >
      <div className="p-3 border-b border-gray-200">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Context
        </h2>
        {currentCampaign && (
          <p className="mt-1 text-sm font-medium text-gray-900 truncate" title={currentCampaign.name}>
            {currentCampaign.name}
          </p>
        )}
      </div>

      {campaigns.length > 0 && (
        <nav className="p-3 border-b border-gray-200">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Campaigns</h3>
          <ul className="mt-2 space-y-0.5">
            {campaigns.map((c) => (
              <li key={c.id}>
                {c.href ? (
                  <a
                    href={c.href}
                    className="block py-1 text-sm text-gray-700 hover:text-indigo-600 truncate"
                  >
                    {c.name}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectCampaign?.(c.id)}
                    className="block w-full text-left py-1 text-sm text-gray-700 hover:text-indigo-600 truncate"
                  >
                    {c.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="p-3 flex-1">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Filters</h3>
        <div className="mt-2 space-y-2 text-sm text-gray-600">
          <div>
            <label className="block text-gray-500 text-xs">Stage</label>
            <select
              value={filters.stage ?? ''}
              onChange={(e) =>
                onFiltersChange?.({ ...filters, stage: e.target.value || null })
              }
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="">All</option>
              <option value="PLAN">Plan</option>
              <option value="CREATE">Create</option>
              <option value="REPURPOSE">Repurpose</option>
              <option value="SCHEDULE">Schedule</option>
              <option value="SHARE">Share</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-500 text-xs">Approval</label>
            <select
              value={filters.approvalStatus ?? ''}
              onChange={(e) =>
                onFiltersChange?.({ ...filters, approvalStatus: e.target.value || null })
              }
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="request_changes">Request changes</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
}
