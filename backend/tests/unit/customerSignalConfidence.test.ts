/**
 * Phase 13E — Customer Signal Confidence tests (pure, deterministic).
 */

import {
  computeFreshness,
  computeSignalConfidence,
  computeCompanySignalHealth,
  generatePortfolioSignalHealth,
  propagateConfidence,
  dependencyConfidence,
  type SignalObservation,
} from '../../services/customerSignalConfidenceService';
import type { ReadinessArea, ReadinessState } from '../../services/customerReadinessService';

const NOW = Date.parse('2026-06-23T00:00:00Z');
const obs = (over: Partial<SignalObservation> = {}): SignalObservation => ({ source_present: true, source_read_ok: true, last_updated: null, ...over });

describe('computeFreshness', () => {
  it('bands by age', () => {
    expect(computeFreshness('2026-06-20T00:00:00Z', NOW)).toBe('HIGH');   // 3d
    expect(computeFreshness('2026-06-05T00:00:00Z', NOW)).toBe('MEDIUM'); // 18d
    expect(computeFreshness('2026-04-01T00:00:00Z', NOW)).toBe('LOW');    // >30d
    expect(computeFreshness(null, NOW)).toBe('UNKNOWN');
  });
});

describe('computeSignalConfidence', () => {
  it('verified domain, fresh → HIGH / PRESENT', () => {
    const s = computeSignalConfidence('WEBSITE', 'READY', obs({ last_updated: '2026-06-21T00:00:00Z' }), NOW);
    expect(s.signal_confidence).toBe('HIGH'); expect(s.signal_status).toBe('PRESENT'); expect(s.signal_freshness).toBe('HIGH');
  });
  it('GA record at medium age → MEDIUM', () => {
    expect(computeSignalConfidence('GOOGLE_ANALYTICS', 'READY', obs({ last_updated: '2026-06-05T00:00:00Z' }), NOW).signal_confidence).toBe('MEDIUM');
  });
  it('very old record → LOW / STALE', () => {
    const s = computeSignalConfidence('GOOGLE_ANALYTICS', 'READY', obs({ last_updated: '2026-04-01T00:00:00Z' }), NOW);
    expect(s.signal_confidence).toBe('LOW'); expect(s.signal_status).toBe('STALE');
  });
  it('COMMUNITY (no source) → UNKNOWN / MISSING', () => {
    const s = computeSignalConfidence('COMMUNITY', 'UNKNOWN', obs(), NOW);
    expect(s.signal_confidence).toBe('UNKNOWN'); expect(s.signal_status).toBe('MISSING');
  });
  it('failed source read → LOW / ERROR', () => {
    expect(computeSignalConfidence('WEBSITE', 'READY', obs({ source_read_ok: false }), NOW).signal_status).toBe('ERROR');
    expect(computeSignalConfidence('WEBSITE', 'READY', obs({ source_read_ok: false }), NOW).signal_confidence).toBe('LOW');
  });
  it('missing source → UNKNOWN / MISSING', () => {
    expect(computeSignalConfidence('GOOGLE_ANALYTICS', 'NOT_READY', obs({ source_present: false }), NOW).signal_confidence).toBe('UNKNOWN');
  });
  it('definite determination, no timestamp → authority baseline', () => {
    expect(computeSignalConfidence('WEBSITE', 'NOT_READY', obs(), NOW).signal_confidence).toBe('HIGH');   // authoritative
    expect(computeSignalConfidence('GOOGLE_ANALYTICS', 'NOT_READY', obs(), NOW).signal_confidence).toBe('MEDIUM'); // derived
  });
  it('ambiguous state with present source → UNKNOWN', () => {
    expect(computeSignalConfidence('WEBSITE', 'UNKNOWN', obs(), NOW).signal_confidence).toBe('UNKNOWN');
  });
});

const areas = (over: Partial<Record<ReadinessArea, ReadinessState>> = {}): Record<ReadinessArea, ReadinessState> => ({
  COMPANY_PROFILE: 'NOT_READY', WEBSITE: 'NOT_READY', GOOGLE_ANALYTICS: 'NOT_READY', GOOGLE_SEARCH_CONSOLE: 'NOT_READY',
  SOCIAL_INTEGRATIONS: 'NOT_READY', COMMUNITY: 'UNKNOWN', TEAM_MEMBERS: 'NOT_READY', BILLING: 'NOT_READY', ...over,
});

describe('computeCompanySignalHealth', () => {
  it('overall = weakest present signal; populates source lists', () => {
    const health = computeCompanySignalHealth(
      { company_id: 'a', company_name: 'Alpha', areas: areas({ WEBSITE: 'READY', GOOGLE_ANALYTICS: 'READY' }) },
      { WEBSITE: obs({ last_updated: '2026-06-21T00:00:00Z' }), GOOGLE_ANALYTICS: obs({ last_updated: '2026-04-01T00:00:00Z' }) }, // GA stale → LOW
      NOW,
    );
    expect(health.overall_signal_confidence).toBe('LOW'); // pulled down by stale GA
    expect(health.stale_sources).toContain('GOOGLE_ANALYTICS');
    expect(health.low_confidence_sources).toContain('GOOGLE_ANALYTICS');
    expect(health.unknown_sources).not.toContain('COMMUNITY'); // structural, excluded
  });
});

describe('generatePortfolioSignalHealth', () => {
  it('aggregates counts + per-area distributions', () => {
    const h = computeCompanySignalHealth({ company_id: 'a', areas: areas({ WEBSITE: 'READY' }) }, { WEBSITE: obs({ last_updated: '2026-06-21T00:00:00Z' }) }, NOW);
    const p = generatePortfolioSignalHealth([h]);
    expect(p.healthy_signals).toBeGreaterThanOrEqual(1); // WEBSITE HIGH
    expect(p.per_area.find((a) => a.area === 'WEBSITE')!.confidence_distribution.HIGH).toBe(1);
    expect(p.per_area).toHaveLength(8);
  });
});

describe('dependency propagation (Phase 5)', () => {
  it('derived confidence cannot exceed weakest source', () => {
    expect(propagateConfidence('HIGH', ['MEDIUM'])).toBe('MEDIUM');
    expect(propagateConfidence('HIGH', ['LOW', 'HIGH'])).toBe('LOW');
    expect(propagateConfidence('HIGH', ['HIGH'])).toBe('HIGH');
    expect(propagateConfidence('MEDIUM', ['HIGH'])).toBe('MEDIUM'); // own cap
  });
  it('all derived layers capped at overall source confidence', () => {
    const d = dependencyConfidence('MEDIUM');
    expect(Object.values(d).every((v) => v === 'MEDIUM')).toBe(true);
    expect(dependencyConfidence('UNKNOWN').OUTCOME).toBe('UNKNOWN');
  });
});

describe('determinism', () => {
  it('identical inputs yield identical output', () => {
    const c = { company_id: 'a', areas: areas({ WEBSITE: 'READY' }) };
    const o = { WEBSITE: obs({ last_updated: '2026-06-21T00:00:00Z' }) };
    expect(JSON.stringify(computeCompanySignalHealth(c, o, NOW))).toBe(JSON.stringify(computeCompanySignalHealth(c, o, NOW)));
  });
});
