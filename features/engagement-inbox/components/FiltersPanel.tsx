import type { Campaign } from '../types';
import { PLATFORMS, SIGNAL_TYPES, TIME_RANGES } from '../constants';

export interface FiltersPanelProps {
  campaigns: Campaign[];
  campaignId: string;
  platform: string;
  signalType: string;
  timeRange: string;
  setCampaignId: (v: string) => void;
  setPlatform: (v: string) => void;
  setSignalType: (v: string) => void;
  setTimeRange: (v: string) => void;
}

export default function FiltersPanel({
  campaigns,
  campaignId,
  platform,
  signalType,
  timeRange,
  setCampaignId,
  setPlatform,
  setSignalType,
  setTimeRange,
}: FiltersPanelProps) {
  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-4 shrink-0 overflow-y-auto">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Filters</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Campaign</label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Platform</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Signal type</label>
          <select
            value={signalType}
            onChange={(e) => setSignalType(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {SIGNAL_TYPES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Time range</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {TIME_RANGES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>
    </aside>
  );
}
