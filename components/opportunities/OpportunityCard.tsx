import React, { useState } from 'react';
import { supabase } from '../../utils/supabaseClient';

export type OpportunityItemForCard = {
  id: string;
  title: string;
  summary: string | null;
  conversion_score: number | null;
  region_tags: string[] | null;
  status?: string;
  scheduled_for?: string | null;
};

type OpportunityCardProps = {
  opportunity: OpportunityItemForCard;
  companyId: string;
  onActionComplete?: () => void;
};

async function fetchWithAuth(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

export default function OpportunityCard({
  opportunity,
  companyId,
  onActionComplete,
}: OpportunityCardProps) {
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const postAction = async (action: string, body: Record<string, unknown> = {}) => {
    const res = await fetchWithAuth(`/api/opportunities/${opportunity.id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, companyId, ...body }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || res.statusText || 'Action failed');
    }
    return res.json();
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onActionComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
      setScheduleOpen(false);
    }
  };

  const handlePromote = () =>
    run(async () => {
      const data = await postAction('PROMOTED');
      const campaignId = data?.campaignId;
      if (campaignId) {
        const params = new URLSearchParams({ companyId });
        window.location.href = `/campaign-details/${campaignId}?${params.toString()}`;
      }
    });

  const handleSchedule = () => {
    if (!scheduleDate.trim()) return;
    run(() => postAction('SCHEDULED', { scheduled_for: scheduleDate.trim() }));
  };

  const handleArchive = () => run(() => postAction('ARCHIVED'));
  const handleDismiss = () => run(() => postAction('DISMISSED'));
  const handleMarkReviewed = () => run(() => postAction('REVIEWED'));

  const score = opportunity.conversion_score ?? 0;
  const scoreLabel = typeof opportunity.conversion_score === 'number'
    ? String(opportunity.conversion_score)
    : '—';

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="min-w-0">
        <h3 className="font-semibold text-gray-900 truncate">{opportunity.title}</h3>
        {opportunity.summary && (
          <p className="text-sm text-gray-600 mt-1 line-clamp-3">{opportunity.summary}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
            Score: {scoreLabel}
          </span>
          {opportunity.region_tags?.length
            ? opportunity.region_tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                >
                  {tag}
                </span>
              ))
            : null}
        </div>
      </div>

      {error && (
        <div className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </div>
      )}

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
            onClick={() => { setScheduleOpen(false); setError(null); }}
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
          Promote to Campaign
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
