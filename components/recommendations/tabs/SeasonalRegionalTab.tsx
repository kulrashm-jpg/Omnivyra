import React, { useState } from 'react';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';

const TYPE = 'SEASONAL';

function EventCard({
  opportunity,
  onScheduleForEvent,
  onCreateNow,
  onDismiss,
  onActionComplete,
}: {
  opportunity: OpportunityWithPayload;
  onScheduleForEvent: (id: string, scheduledFor: string) => Promise<void>;
  onCreateNow: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onActionComplete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onActionComplete?.();
      setScheduleOpen(false);
    } finally {
      setBusy(false);
    }
  };
  const eventName = payloadHelpers.eventName(opportunity.payload) || opportunity.title || 'Event';
  const region = payloadHelpers.region(opportunity.payload) || (opportunity.region_tags?.[0]) || '—';
  const suggestedAngle = payloadHelpers.suggestedAngle(opportunity.payload) || opportunity.summary || '—';
  const offerIdea = payloadHelpers.offerIdea(opportunity.payload);
  const eventDate = payloadHelpers.eventDate(opportunity.payload);

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <h3 className="font-semibold text-gray-900">{eventName}</h3>
      <div className="text-xs text-gray-500 mt-1">
        {eventDate ? `Date: ${eventDate} • ` : ''}Region: {region}
      </div>
      <p className="text-sm text-gray-600 mt-2">Suggested angle: {suggestedAngle}</p>
      {offerIdea && (
        <p className="text-xs text-indigo-600 mt-1">Offer idea: {offerIdea}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {scheduleOpen ? (
          <>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                if (!scheduleDate) return;
                const iso = new Date(scheduleDate + 'T12:00:00').toISOString();
                run(() => onScheduleForEvent(opportunity.id, iso));
              }}
              disabled={busy || !scheduleDate}
              className="px-2 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
            >
              Schedule
            </button>
            <button
              type="button"
              onClick={() => setScheduleOpen(false)}
              className="px-2 py-1 text-xs rounded border border-gray-300"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 text-gray-700 disabled:opacity-50"
            >
              Schedule Campaign for Event
            </button>
            <button
              type="button"
              onClick={() => run(() => onCreateNow(opportunity.id))}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white disabled:opacity-50"
            >
              Create Campaign Now
            </button>
            <button
              type="button"
              onClick={() => run(() => onDismiss(opportunity.id))}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 text-gray-600 disabled:opacity-50"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SeasonalRegionalTab(props: OpportunityTabProps) {
  const { companyId, regions, onPromote, onAction, fetchWithAuth } = props;
  const { opportunities, activeCount, loading, error, refetch } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth,
    { getRegions: () => regions ?? null }
  );

  const handleScheduleForEvent = async (id: string, scheduledFor: string) => {
    await onAction(id, 'SCHEDULED', { scheduled_for: scheduledFor });
  };
  const handleDismiss = async (id: string) => {
    await onAction(id, 'DISMISSED');
  };

  if (!companyId) {
    return (
      <div className="text-sm text-gray-500 py-4">Select a company to view seasonal opportunities.</div>
    );
  }
  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-4">Loading seasonal & regional opportunities...</div>
    );
  }
  if (error) {
    return <div className="text-sm text-red-600 py-2">{error}</div>;
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Upcoming events (next 30/60/90 days). Schedule a campaign for an event or create one now.
      </p>
      <div className="text-sm font-medium text-gray-700 mb-3">
        {activeCount} / 10 Active Opportunities
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {opportunities.map((opp) => (
          <EventCard
            key={opp.id}
            opportunity={opp}
            onScheduleForEvent={handleScheduleForEvent}
            onCreateNow={onPromote}
            onDismiss={handleDismiss}
            onActionComplete={refetch}
          />
        ))}
      </div>
      {opportunities.length === 0 && (
        <div className="text-sm text-gray-500 py-4">No seasonal events.</div>
      )}
    </div>
  );
}
