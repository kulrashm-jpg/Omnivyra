import {
  ga4EvidenceAdapter, GA4_EVIDENCE_KEYS, type Ga4BehaviorEvidenceInput,
} from '../../services/evidencePlatform/providers/ga4/ga4EvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';
import {
  isGa4ProviderConfigured, registerGa4Provider, isGa4ProviderAvailable,
  ga4ProviderReliability, combinedProviderReliability, aggregateGa4Rows, fetchGa4Evidence,
} from '../../services/ga4ProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';
import type { Ga4SessionRow, Ga4EventRow } from '../../services/ga4IngestionService';

const OBSERVED = '2026-01-01T00:00:00.000Z';

const input: Ga4BehaviorEvidenceInput = {
  propertyId: 'properties/123',
  totalSessions: 10000, engagedSessions: 6500, engagementRate: null,
  engagementTimeMsecTotal: 900000000, pageViews: 24000, totalUsers: 8200, activeUsers: 7800,
  conversions: 320, deviceSegments: 3, geoSegments: 15,
  observedAt: OBSERVED, providerReliability: 0.92,
};

describe('GA4 Provider — canonical adapter (BETA-PROVIDER-003)', () => {
  it('converts a GA4 payload to canonical Evidence, per-field MEASURED / derived CALCULATED', () => {
    const ev = ga4EvidenceAdapter.toEvidence(input, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['sessions'].value).toBe(10000);
    expect(byKey['sessions'].maturity).toBe('MEASURED');
    expect(byKey['engaged_sessions'].value).toBe(6500);
    expect(byKey['page_views'].value).toBe(24000);
    expect(byKey['total_users'].value).toBe(8200);
    expect(byKey['conversions'].value).toBe(320);
    // engagement_rate derived from engaged/sessions (engagementRate was null) → CALCULATED
    expect(byKey['engagement_rate'].value).toBe(0.65); // 6500/10000
    expect(byKey['engagement_rate'].maturity).toBe('CALCULATED');
    // avg engagement time: 900000000ms / 10000 sessions / 1000 = 90s
    expect(byKey['avg_engagement_time_sec'].value).toBe(90);
    // conversion_rate: 320/10000 = 0.032 → CALCULATED
    expect(byKey['conversion_rate'].value).toBe(0.032);
    expect(byKey['conversion_rate'].maturity).toBe('CALCULATED');
    for (const e of ev) expect(e.sourceType).toBe('external_api');
  });

  it('emits Google-supplied engagement_rate as MEASURED when present (not re-derived)', () => {
    const ev = ga4EvidenceAdapter.toEvidence({ ...input, engagementRate: 0.71 }, { observedAt: OBSERVED });
    const er = ev.find((e) => e.id.endsWith(':engagement_rate'))!;
    expect(er.value).toBe(0.71);
    expect(er.maturity).toBe('MEASURED');
  });

  it('never fabricates: omits metrics GA4 did not return, and every value traces to input', () => {
    const sparse: Ga4BehaviorEvidenceInput = {
      propertyId: 'properties/123', totalSessions: 500, engagedSessions: null, engagementRate: null,
      engagementTimeMsecTotal: null, pageViews: null, totalUsers: null, activeUsers: null,
      conversions: null, deviceSegments: null, geoSegments: null, observedAt: OBSERVED, providerReliability: 0.92,
    };
    const ev = ga4EvidenceAdapter.toEvidence(sparse, { observedAt: OBSERVED });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).toContain('sessions');
    expect(keys).not.toContain('engaged_sessions');
    expect(keys).not.toContain('engagement_rate'); // no engaged → cannot derive → omitted
    expect(keys).not.toContain('conversions');
    expect(keys).not.toContain('conversion_rate'); // no conversions → cannot derive → omitted
    expect(keys).not.toContain('avg_engagement_time_sec');
    const allowed = new Set([500]);
    for (const e of ev) if (typeof e.value === 'number') expect(allowed.has(e.value)).toBe(true);
  });

  it('is deterministic', () => {
    expect(ga4EvidenceAdapter.toEvidence(input, {})).toEqual(ga4EvidenceAdapter.toEvidence(input, {}));
  });

  it('maps failure to canonical Evidence (no silent failure, null value)', () => {
    const ev = ga4EvidenceAdapter.onFailure({
      providerId: 'analytics.ga4', state: PROVIDER_FAILURE.QUOTA_EXCEEDED,
      reason: 'quota', evidenceKey: 'sessions', observedAt: OBSERVED,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeNull();
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_QUOTA_EXCEEDED');
  });

  it('exposes exactly the declared GA4 evidence keys', () => {
    expect(ga4EvidenceAdapter.supportedEvidence).toEqual([...GA4_EVIDENCE_KEYS]);
  });
});

describe('GA4 Provider — row aggregation (reuses ga4IngestionService shapes + conversionRegistry)', () => {
  it('aggregates session rows: sums metrics, counts distinct device/geo, counts conversion events', () => {
    const sessionRows: Ga4SessionRow[] = [
      { sessionDate: '2026-01-01', pagePath: '/', sessions: 100, engagedSessions: 60, engagementTimeMsec: 6000000, screenPageViews: 240, totalUsers: 90, activeUsers: 85, deviceCategory: 'desktop', country: 'usa' },
      { sessionDate: '2026-01-01', pagePath: '/pricing', sessions: 50, engagedSessions: 40, engagementTimeMsec: 3000000, screenPageViews: 120, totalUsers: 45, activeUsers: 42, deviceCategory: 'mobile', country: 'gbr' },
    ];
    const eventRows: Ga4EventRow[] = [
      { eventTimestamp: '2026-01-01T10:00:00Z', eventName: 'purchase', eventCount: 3 },
      { eventTimestamp: '2026-01-01T11:00:00Z', eventName: 'page_view', eventCount: 100 }, // not a conversion
      { eventTimestamp: '2026-01-01T12:00:00Z', eventName: 'generate_lead', eventCount: 2 },
    ];
    const agg = aggregateGa4Rows('properties/123', sessionRows, eventRows, OBSERVED);
    expect(agg.totalSessions).toBe(150);
    expect(agg.engagedSessions).toBe(100);
    expect(agg.pageViews).toBe(360);
    expect(agg.totalUsers).toBe(135);
    expect(agg.deviceSegments).toBe(2);
    expect(agg.geoSegments).toBe(2);
    // conversions counted only for registered conversion events (purchase=3 + generate_lead=2 = 5; page_view excluded)
    expect(agg.conversions).toBe(5);
    expect(agg.engagementRate).toBeNull(); // derived downstream
  });

  it('returns null conversions when no event rows supplied (not fabricated 0)', () => {
    const sessionRows: Ga4SessionRow[] = [{ sessionDate: '2026-01-01', pagePath: '/', sessions: 10 }];
    const agg = aggregateGa4Rows('properties/123', sessionRows, [], OBSERVED);
    expect(agg.totalSessions).toBe(10);
    expect(agg.conversions).toBeNull(); // no event stream → unknown, not zero
    expect(agg.engagedSessions).toBeNull();
    expect(agg.deviceSegments).toBeNull();
  });
});

describe('GA4 Provider — combined reliability (mixed-provider signals)', () => {
  it('averages the reliabilities of connected providers, ignoring nulls', () => {
    expect(combinedProviderReliability(0.95, 0.92)).toBeCloseTo(0.935, 5);
    expect(combinedProviderReliability(0.95, null)).toBe(0.95);
    expect(combinedProviderReliability(null, 0.92)).toBe(0.92);
    expect(combinedProviderReliability(null, null)).toBeNull();
  });
});

describe('GA4 Provider — availability + failure governance (bridge)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });

  it('is UNAVAILABLE without credentials (backward compatible)', () => {
    delete process.env.GA4_PROPERTY_ID; delete process.env.GA4_OAUTH;
    expect(isGa4ProviderConfigured()).toBe(false);
    const d = registerGa4Provider();
    expect(d.authStatus).toBe('unauthenticated');
    expect(d.connectionStatus).toBe('disconnected');
    expect(isGa4ProviderAvailable()).toBe(false);
  });

  it('requires BOTH property id and OAuth to be considered connected', () => {
    process.env.GA4_PROPERTY_ID = 'properties/123'; delete process.env.GA4_OAUTH;
    expect(isGa4ProviderConfigured()).toBe(false);
    expect(isGa4ProviderAvailable()).toBe(false);
  });

  it('flips to authenticated/connected when both credentials are present', () => {
    process.env.GA4_PROPERTY_ID = 'properties/123'; process.env.GA4_OAUTH = 'token';
    const d = registerGa4Provider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isGa4ProviderAvailable()).toBe(true);
    expect(ga4ProviderReliability()).toBe(0.92);
  });

  it('fetch without credentials returns canonical UNAVAILABLE evidence (no network, no DB, no fabrication)', () => {
    delete process.env.GA4_PROPERTY_ID; delete process.env.GA4_OAUTH;
    const ev = fetchGa4Evidence('properties/123', null, null, OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected-but-empty-property returns UNAVAILABLE evidence (honest, not fabricated zeros)', () => {
    process.env.GA4_PROPERTY_ID = 'properties/123'; process.env.GA4_OAUTH = 'token';
    const ev = fetchGa4Evidence('properties/123', [], [], OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected with rows converts through the canonical adapter to MEASURED evidence', () => {
    process.env.GA4_PROPERTY_ID = 'properties/123'; process.env.GA4_OAUTH = 'token';
    registerGa4Provider();
    const sessionRows: Ga4SessionRow[] = [
      { sessionDate: '2026-01-01', pagePath: '/', sessions: 200, engagedSessions: 120, deviceCategory: 'desktop', country: 'usa' },
    ];
    const ev = fetchGa4Evidence('properties/123', sessionRows, [], OBSERVED);
    const sessions = ev.find((e) => e.id.endsWith(':sessions'))!;
    expect(sessions.value).toBe(200);
    expect(sessions.maturity).toBe('MEASURED');
  });
});
