import React, { useState } from 'react';

export type OpportunityItemForCard = {
  id: string;
  title: string;
  summary: string | null;
  problem_domain: string | null;
  region_tags: string[] | null;
  conversion_score: number | null;
  status: string;
  scheduled_for: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload?: Record<string, unknown> | null;
};

type OpportunityCardProps = {
  opportunity: OpportunityItemForCard;
  companyId: string;
  onPromote: (opportunityId: string) => Promise<void>;
  onSchedule: (opportunityId: string, scheduledFor: string) => Promise<void>;
  onArchive: (opportunityId: string) => Promise<void>;
  onDismiss: (opportunityId: string) => Promise<void>;
  onMarkReviewed: (opportunityId: string) => Promise<void>;
  onActionComplete?: () => void;
};

export default function OpportunityCard({
  opportunity,
  companyId,
  onPromote,
  onSchedule,
  onArchive,
  onDismiss,
  onMarkReviewed,
  onActionComplete,
}: OpportunityCardProps) {
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onActionComplete?.();
    } finally {
      setBusy(false);
      setScheduleOpen(false);
    }
  };

  const handlePromote = () =>
    run(() => onPromote(opportunity.id));

  const handleSchedule = () => {
    if (!scheduleDate.trim()) return;
    run(() => onSchedule(opportunity.id, scheduleDate.trim()));
  };

  const handleArchive = () => run(() => onArchive(opportunity.id));
  const handleDismiss = () => run(() => onDismiss(opportunity.id));
  const handleMarkReviewed = () => run(() => onMarkReviewed(opportunity.id));

  const score = opportunity.conversion_score ?? 0;
  const regions = opportunity.region_tags?.length
    ? opportunity.region_tags.join(', ')
    : '—';

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{opportunity.title}</h3>
          {opportunity.summary && (
            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{opportunity.summary}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
            <span>Score: {score}</span>
            <span>Regions: {regions}</span>
            <span>Status: {opportunity.status}</span>
          </div>
        </div>
      </div>

      {scheduleOpen && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={handleSchedule}
            disabled={busy || !scheduleDate.trim()}
            className="px-2 py-1 bg-indigo-600 text-white text-xs rounded disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(false)}
            className="px-2 py-1 border border-gray-300 text-xs rounded"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handlePromote}
          disabled={busy}
          className="px-2 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
        >
          Promote
        </button>
        <button
          type="button"
          onClick={() => setScheduleOpen((o) => !o)}
          disabled={busy}
          className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
        >
          Schedule
        </button>
        <button
          type="button"
          onClick={handleArchive}
          disabled={busy}
          className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
        >
          Archive
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={handleMarkReviewed}
          disabled={busy}
          className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
        >
          Mark Reviewed
        </button>
      </div>
    </div>
  );
}
