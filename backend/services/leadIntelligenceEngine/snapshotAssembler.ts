/**
 * INT-001 Phase 2 — snapshot assembler.
 *
 * Normalizes raw STORED rows (a `leads` row plus its `tracking_events`,
 * `visitor_sessions` and `campaign_touchpoints` rows, exactly as persisted by
 * the existing capture pipeline) into the typed LeadCaptureSnapshot the
 * engines consume. Pure: rows in, snapshot out — this module performs no
 * database reads and never mutates its inputs. Tolerant of missing/malformed
 * fields (missing data degrades to nulls, never throws).
 */

import type {
  CapturedEvent,
  CapturedLeadProfile,
  CapturedSession,
  CapturedTouchpoint,
  LeadCaptureSnapshot,
} from './types';

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

const isoOrNull = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  return Number.isFinite(Date.parse(s)) ? s : null;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface RawCapturedLeadData {
  leadRow: Row | null | undefined;
  trackingEventRows?: Array<Row> | null;
  visitorSessionRows?: Array<Row> | null;
  touchpointRows?: Array<Row> | null;
  /** Evaluation time (ISO-8601). Callers inject it; engines never read the clock. */
  now: string;
}

export function assembleLeadCaptureSnapshot(raw: RawCapturedLeadData): LeadCaptureSnapshot {
  const leadRow = obj(raw.leadRow);
  const metadata = obj(leadRow.metadata);

  const lead: CapturedLeadProfile = {
    id: str(leadRow.id),
    email: str(leadRow.email),
    name: str(leadRow.name) ?? str(metadata.name),
    jobTitle: str(metadata.job_title) ?? str(metadata.jobTitle),
    companyName: str(metadata.company_name) ?? str(metadata.companyName) ?? str(metadata.company),
    companySize: str(metadata.company_size) ?? str(metadata.companySize),
    industry: str(metadata.industry),
    country: str(metadata.country),
    primaryInterest: str(metadata.primary_interest) ?? str(metadata.primaryInterest),
    message: str(metadata.message),
    source: str(leadRow.source),
    createdAt: isoOrNull(leadRow.created_at),
  };

  const events: CapturedEvent[] = [];
  const seenEventKeys = new Set<string>();
  for (const row of raw.trackingEventRows ?? []) {
    const r = obj(row);
    const occurredAt = isoOrNull(r.occurred_at) ?? isoOrNull(r.created_at);
    if (!occurredAt) continue; // an event without a valid timestamp cannot be ordered
    const eventMeta = obj(r.metadata);
    const id = str(r.id) ?? str(r.dedupe_key);
    const eventName = str(r.event_name) ?? 'page_view';
    const pageUrl = str(r.page_url);
    const key = id ?? `${eventName}|${pageUrl ?? ''}|${occurredAt}`;
    if (seenEventKeys.has(key)) continue;
    seenEventKeys.add(key);
    events.push({
      id,
      eventName,
      pageUrl,
      sessionId: str(r.visitor_session_id) ?? str(eventMeta.session_id),
      occurredAt,
      metadata: eventMeta,
    });
  }

  const sessions: CapturedSession[] = (raw.visitorSessionRows ?? []).map((row) => {
    const r = obj(row);
    return {
      id: str(r.id),
      startedAt: isoOrNull(r.started_at) ?? isoOrNull(r.created_at),
      lastSeenAt: isoOrNull(r.last_seen_at),
      firstLandingPage: str(r.first_landing_page),
      utmSource: str(r.utm_source),
      utmMedium: str(r.utm_medium),
      utmCampaign: str(r.utm_campaign),
    };
  });

  const touchpoints: CapturedTouchpoint[] = (raw.touchpointRows ?? []).map((row) => {
    const r = obj(row);
    return {
      id: str(r.id),
      touchpointType: str(r.touchpoint_type),
      source: str(r.source),
      medium: str(r.medium),
      campaign: str(r.campaign),
      pageUrl: str(r.page_url),
      touchedAt: isoOrNull(r.touched_at) ?? isoOrNull(r.created_at),
    };
  });

  return { lead, events, sessions, touchpoints, now: raw.now };
}
