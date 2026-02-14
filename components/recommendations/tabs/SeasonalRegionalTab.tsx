import React, { useState } from 'react';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';
import EngineContextPanel from '../EngineContextPanel';
import EngineOverridePanel from '../EngineOverridePanel';

const TYPE = 'SEASONAL';
const ENGINE_LABEL = 'Seasonal & Regional';

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
  const eventName = opportunity.title || 'Event';
  const region = opportunity.region_tags?.[0] || '—';
  const suggestedAngle = opportunity.summary || '—';
  const suggestedOffer = payloadHelpers.suggestedOffer(opportunity.payload);
  const eventDate = payloadHelpers.eventDate(opportunity.payload);

  // scheduled_for must be ISO string for /api/opportunities/[id]/action
  const toScheduledFor = (dateStr: string) => {
    if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) return dateStr;
    return new Date(dateStr + 'T12:00:00').toISOString();
  };

  const onScheduleClick = () => {
    if (eventDate) {
      run(() => onScheduleForEvent(opportunity.id, toScheduledFor(eventDate)));
    } else {
      setScheduleOpen(true);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <h3 className="font-semibold text-gray-900">{eventName}</h3>
      <div className="text-xs text-gray-500 mt-1">
        {eventDate ? `Date: ${eventDate} • ` : ''}Region: {region}
      </div>
      <p className="text-sm text-gray-600 mt-2">Suggested angle: {suggestedAngle}</p>
      {suggestedOffer && (
        <p className="text-xs text-indigo-600 mt-1">Suggested offer: {suggestedOffer}</p>
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
                run(() => onScheduleForEvent(opportunity.id, toScheduledFor(scheduleDate)));
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
              onClick={onScheduleClick}
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
  const { companyId, regions, onPromote, onAction, fetchWithAuth, overrideText = '', onOverrideChange } = props;
  const { opportunities, loading, error, runEngine, hasRun, refetch } = useOpportunities(
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

  return (
    <div className="space-y-4">
      <EngineContextPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      <EngineOverridePanel value={overrideText} onChange={onOverrideChange ?? (() => {})} />
      <div>
        <button
          type="button"
          onClick={() => runEngine()}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Running…' : `Run ${ENGINE_LABEL}`}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!hasRun && !loading && (
        <div className="text-sm text-gray-500 py-6">Run the engine to see opportunities.</div>
      )}
      {hasRun && !loading && (
        <>
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
        </>
      )}
      {loading && <div className="text-sm text-gray-500 py-4">Loading seasonal & regional opportunities…</div>}
    </div>
  );
}
