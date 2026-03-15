/**
 * IntelligenceTimeline
 * Displays a timeline of intelligence events for a company.
 * Fetches from GET /api/intelligence/events.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export type IntelligenceEventType =
  | 'trend_detected'
  | 'insight_generated'
  | 'opportunity_detected'
  | 'campaign_launched'
  | 'engagement_spike';

export interface IntelligenceEvent {
  id: string;
  company_id: string;
  event_type: IntelligenceEventType | string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}

const EVENT_LABELS: Record<string, string> = {
  trend_detected: 'Trend Detected',
  insight_generated: 'Insight Generated',
  opportunity_detected: 'Opportunity Detected',
  campaign_launched: 'Campaign Launched',
  engagement_spike: 'Engagement Spike',
};

const EVENT_COLORS: Record<string, string> = {
  trend_detected: 'bg-blue-500',
  insight_generated: 'bg-purple-500',
  opportunity_detected: 'bg-emerald-500',
  campaign_launched: 'bg-amber-500',
  engagement_spike: 'bg-rose-500',
};

export interface IntelligenceTimelineProps {
  companyId?: string | null;
  /** When provided, use pre-fetched events; skips fetch */
  events?: IntelligenceEvent[] | null;
  /** In dashboard mode, show loading when true */
  loading?: boolean;
  className?: string;
  onError?: (msg: string) => void;
  maxItems?: number;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function eventSummary(event: IntelligenceEvent): string {
  const data = event.event_data;
  if (!data || typeof data !== 'object') return EVENT_LABELS[event.event_type] ?? event.event_type;

  const title = data.title ?? data.topic ?? data.name ?? data.campaign_name;
  if (typeof title === 'string') return title;

  const summary = data.summary ?? data.description;
  if (typeof summary === 'string') return summary.slice(0, 80) + (summary.length > 80 ? '…' : '');

  return EVENT_LABELS[event.event_type] ?? event.event_type;
}

function eventRelation(event: IntelligenceEvent): string | null {
  if (event.event_type !== 'campaign_launched') return null;
  const data = event.event_data;
  if (!data || typeof data !== 'object') return null;
  const oppId = data.source_opportunity_id ?? data.opportunity_id;
  const campaignName = data.campaign_name;
  if (oppId && campaignName) return `Opportunity → ${String(campaignName)}`;
  if (oppId) return 'From opportunity';
  return null;
}

export function IntelligenceTimeline({
  companyId = null,
  events: eventsProp,
  loading: loadingProp,
  className = '',
  onError,
  maxItems = 30,
}: IntelligenceTimelineProps) {
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!companyId || eventsProp != null || loadingProp) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/intelligence/events?companyId=${encodeURIComponent(companyId)}&limit=${maxItems}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.details || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { events?: IntelligenceEvent[] };
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load intelligence events';
      onError?.(msg);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, eventsProp, loadingProp, onError, maxItems]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const displayEvents = eventsProp ?? events;
  const isLoading = loadingProp ?? loading;

  if (loadingProp && eventsProp === undefined) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Intelligence Timeline</CardTitle>
          <p className="text-sm text-slate-600">Loading timeline…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!companyId) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Intelligence Timeline</CardTitle>
          <p className="text-sm text-slate-600">Select a company to view intelligence events.</p>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Intelligence Timeline</CardTitle>
          <p className="text-sm text-slate-600">Loading timeline…</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded bg-slate-100" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!displayEvents || displayEvents.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Intelligence Timeline</CardTitle>
          <p className="text-sm text-slate-600">
            No intelligence events yet. Events are recorded when trends are detected, insights generated, opportunities found, campaigns launched, or engagement spikes occur.
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Intelligence Timeline</CardTitle>
        <p className="text-sm text-slate-600">
          {displayEvents.length} event{displayEvents.length !== 1 ? 's' : ''} — sorted by time
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-0 border-l-2 border-slate-200 pl-4 ml-1">
          {displayEvents.map((e) => (
            <li key={e.id} className="relative pb-4 last:pb-0">
              <span
                className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full ${
                  EVENT_COLORS[e.event_type] ?? 'bg-slate-400'
                }`}
                aria-hidden
              />
              <div className="flex items-center gap-2 mb-0.5">
                <Badge variant="secondary" className="text-xs">
                  {EVENT_LABELS[e.event_type] ?? e.event_type}
                </Badge>
                <span className="text-xs text-slate-500">{formatDate(e.created_at)}</span>
              </div>
              <p className="text-sm font-medium text-slate-800" title={eventSummary(e)}>
                {eventSummary(e)}
              </p>
              {eventRelation(e) && (
                <p className="text-xs text-slate-600 mt-0.5">
                  {eventRelation(e)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
