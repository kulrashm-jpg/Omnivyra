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
  CapturedDeviceContext,
  CapturedEvent,
  CapturedGeoContext,
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

/** WS-2 M1: strict booleans only — a missing/garbage value is "unknown", not false. */
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** WS-2 M1: non-negative finite integers only; anything else is "unknown". */
const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};

/**
 * WS-2 M2: map the stored device/geo blocks. Field-by-field rather than a
 * blind spread, so a malformed or hostile stored object cannot inject keys the
 * contract does not declare. An all-null block is returned as `null` so
 * "absent" and "present but empty" stay indistinguishable to consumers — both
 * mean unknown.
 */
const deviceOf = (v: unknown): CapturedDeviceContext | null => {
  const d = obj(v);
  const out: CapturedDeviceContext = {
    deviceType: str(d.deviceType) ?? str(d.device_type),
    deviceCategory: str(d.deviceCategory) ?? str(d.device_category),
    browser: str(d.browser),
    browserVersion: str(d.browserVersion) ?? str(d.browser_version),
    os: str(d.os),
    osVersion: str(d.osVersion) ?? str(d.os_version),
    platform: str(d.platform),
  };
  return Object.values(out).some((x) => x !== null) ? out : null;
};

const geoOf = (v: unknown): CapturedGeoContext | null => {
  const g = obj(v);
  const country = str(g.country);
  const out: CapturedGeoContext = {
    timezone: str(g.timezone),
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    region: str(g.region),
    city: str(g.city),
  };
  return Object.values(out).some((x) => x !== null) ? out : null;
};

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
    // WS-2 M2: conversion-moment context, written by the lead-capture path.
    device: deviceOf(metadata.device),
    geo: geoOf(metadata.geo),
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
    // WS-2 M1 (1): the visitor block written by attributionResolverService at
    // session create/continue. Read tolerantly — a row predating the writer,
    // or one whose history read failed open, simply has no `visitor` object.
    const visitor = obj(obj(r.metadata).visitor);
    // WS-2 M2: device/geo blocks, parsed once at capture (see visitorContext).
    const sessionMeta = obj(r.metadata);
    return {
      id: str(r.id),
      startedAt: isoOrNull(r.started_at) ?? isoOrNull(r.created_at),
      lastSeenAt: isoOrNull(r.last_seen_at),
      firstLandingPage: str(r.first_landing_page),
      utmSource: str(r.utm_source),
      utmMedium: str(r.utm_medium),
      utmCampaign: str(r.utm_campaign),
      lastCurrentPage: str(r.last_current_page),
      returning: bool(visitor.returning_visitor),
      visitCount: posInt(visitor.visit_count),
      firstVisitAt: isoOrNull(visitor.first_visit_at),
      sessionDurationMs: posInt(visitor.session_duration_ms),
      device: deviceOf(sessionMeta.device),
      geo: geoOf(sessionMeta.geo),
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
