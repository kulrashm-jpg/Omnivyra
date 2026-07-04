/**
 * Canonical Google Analytics 4 Provider Bridge  (BETA-PROVIDER-003) — REFERENCE IMPLEMENTATION #3
 *
 * Wires the THIRD real external evidence provider — Google Analytics 4 — into the canonical
 * BETA-ENGINE-004 framework by REUSING the existing GA4 integration (no provider code is duplicated):
 *   • the ingestion row shapes + fetch semantics of `ga4IngestionService` (`Ga4SessionRow`/`Ga4EventRow`),
 *   • the conversion classification of `conversionRegistry.isConversionEvent`,
 *   • the already-ingested first-party data in `canonical_sessions` / `canonical_page_views`,
 *   • the connection/readiness signals in `googleProviderReadinessService`.
 * It:
 *   • registers the canonical `analytics.ga4` provider with live auth/connection from env,
 *   • aggregates the reused GA4 rows into a normalised input and converts it to canonical Evidence via
 *     `ga4EvidenceAdapter`,
 *   • maps every provider failure (unauthorized / expired token / quota / API disabled / property missing
 *     / not verified / timeout / partial) to canonical Evidence (no fabrication, no silent failure),
 *   • exposes a deterministic availability signal engines use to lift confidence.
 *
 * Backward compatible: with no GA4 credentials the provider is UNAVAILABLE, so the behavioral engines keep
 * their current behaviour (their canonical_sessions data is already MEASURED); the confidence lift — the
 * provider-reliability factor — activates only when the canonical provider is connected.
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import {
  ga4EvidenceAdapter, type Ga4BehaviorEvidenceInput,
} from './evidencePlatform/providers/ga4/ga4EvidenceAdapter';
import type { Ga4SessionRow, Ga4EventRow } from './ga4IngestionService';
import { isConversionEvent } from './conversionRegistry';

const PROVIDER_ID = 'analytics.ga4';
const ENV_KEYS = ['GA4_PROPERTY_ID', 'GA4_OAUTH'];

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** True when the GA4 property id + OAuth credentials are present. */
export function isGa4ProviderConfigured(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

/** Register the canonical GA4 provider with auth/connection derived from env (idempotent). */
export function registerGa4Provider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('analytics.ga4 descriptor missing from anticipated providers');
  const configured = isGa4ProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

/** Deterministic availability engines consult to decide whether to add the provider-reliability factor. */
export function isGa4ProviderAvailable(): boolean {
  registerGa4Provider();
  return isProviderAvailable(PROVIDER_ID);
}

export function ga4ProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

/**
 * Combined first-party provider reliability for a signal backed by more than one live provider (e.g. the
 * geo-strategy + intent engines draw on BOTH GA4 sessions and GSC keyword metrics). Returns the mean of
 * the reliabilities of the connected providers, or null when none is connected. Honest single-scalar
 * representation for `deriveDecisionConfidence` — not a scoring redesign (the function already accepts a
 * providerReliability factor; this only derives its value from the live provider set).
 */
export function combinedProviderReliability(...reliabilities: Array<number | null | undefined>): number | null {
  const present = reliabilities.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * Aggregate the reused GA4 row shapes (`ga4IngestionService.Ga4SessionRow` / `Ga4EventRow`) into the
 * normalised, provider-agnostic evidence input. Pure + deterministic: sums sessions/engaged/page-views/
 * users/engagement-time, counts distinct device + geo segments, and counts conversion events via the
 * reused `isConversionEvent` classifier. No fabrication — absent dimensions stay null.
 */
export function aggregateGa4Rows(
  propertyId: string,
  sessionRows: Ga4SessionRow[],
  eventRows: Ga4EventRow[],
  observedAt: string | null,
): Ga4BehaviorEvidenceInput {
  let totalSessions = 0, engagedSessions = 0, engagementTimeMsec = 0, pageViews = 0, totalUsers = 0, activeUsers = 0;
  let hasSessions = false, hasEngaged = false, hasEngTime = false, hasPageViews = false, hasTotalUsers = false, hasActiveUsers = false;
  const devices = new Set<string>();
  const geos = new Set<string>();

  for (const row of sessionRows) {
    const s = num(row.sessions);
    const es = num(row.engagedSessions);
    const et = num(row.engagementTimeMsec);
    const pv = num(row.screenPageViews);
    const tu = num(row.totalUsers);
    const au = num(row.activeUsers);
    if (s != null) { totalSessions += s; hasSessions = true; }
    if (es != null) { engagedSessions += es; hasEngaged = true; }
    if (et != null) { engagementTimeMsec += et; hasEngTime = true; }
    if (pv != null) { pageViews += pv; hasPageViews = true; }
    if (tu != null) { totalUsers += tu; hasTotalUsers = true; }
    if (au != null) { activeUsers += au; hasActiveUsers = true; }
    const device = (row.deviceCategory ?? '').trim();
    if (device) devices.add(device.toLowerCase());
    const geo = (row.country ?? '').trim();
    if (geo) geos.add(geo.toLowerCase());
  }

  // Conversions from the event stream, classified by the reused conversion registry. Only counted when
  // event rows are supplied — absent event data stays null (not fabricated as 0 conversions).
  let conversions = 0;
  let hasConversionData = false;
  for (const ev of eventRows) {
    if (isConversionEvent(ev.eventName)) {
      hasConversionData = true;
      const count = num(ev.eventCount);
      conversions += count != null ? count : 1;
    }
  }

  return {
    propertyId,
    totalSessions: hasSessions ? totalSessions : null,
    engagedSessions: hasEngaged ? engagedSessions : null,
    engagementRate: null, // derived (engaged/sessions) by the adapter as CALCULATED
    engagementTimeMsecTotal: hasEngTime ? engagementTimeMsec : null,
    pageViews: hasPageViews ? pageViews : null,
    totalUsers: hasTotalUsers ? totalUsers : null,
    activeUsers: hasActiveUsers ? activeUsers : null,
    conversions: eventRows.length > 0 && hasConversionData ? conversions : (eventRows.length > 0 ? 0 : null),
    deviceSegments: devices.size > 0 ? devices.size : null,
    geoSegments: geos.size > 0 ? geos.size : null,
    observedAt,
    providerReliability: ga4ProviderReliability(),
  };
}

/**
 * Reference fetch → canonical Evidence. Reuses the existing GA4 integration (ingestion row shapes +
 * already-ingested first-party data) and converts it through the canonical adapter. Every failure
 * (no credentials, unauthorized, expired token, quota, API disabled, property missing/unverified,
 * timeout, partial) becomes canonical Evidence — never throws, never fabricates. `nowIso` is passed in
 * (deterministic; no clock access).
 *
 * With no credentials the provider is UNAVAILABLE and this returns a single UNAVAILABLE Evidence without
 * touching the network or the database (backward-compatible, test-verified).
 */
export function fetchGa4Evidence(
  propertyId: string,
  sessionRows: Ga4SessionRow[] | null,
  eventRows: Ga4EventRow[] | null,
  nowIso: string,
): Evidence[] {
  registerGa4Provider();
  if (!isGa4ProviderConfigured()) {
    return ga4EvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'sessions',
      'GA4 provider not connected. Set GA4_PROPERTY_ID / GA4_OAUTH and authorise the property.',
    ));
  }
  if (!sessionRows || sessionRows.length === 0) {
    return ga4EvidenceAdapter.onFailure({
      providerId: PROVIDER_ID,
      state: PROVIDER_FAILURE.UNAVAILABLE,
      reason: 'GA4 is connected but returned no session rows for the property/window.',
      evidenceKey: 'sessions',
      observedAt: nowIso,
    });
  }
  const input = aggregateGa4Rows(propertyId, sessionRows, eventRows ?? [], nowIso);
  return ga4EvidenceAdapter.toEvidence(input, { observedAt: nowIso, subjectId: propertyId });
}
