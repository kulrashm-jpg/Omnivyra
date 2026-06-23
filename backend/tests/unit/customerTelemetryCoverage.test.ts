/**
 * Phase 13H — Customer Telemetry Coverage audit tests (pure, deterministic).
 */

import {
  scoreCoverage,
  TELEMETRY_CATALOG,
  type TelemetryItem,
} from '../../services/customerTelemetryCoverageService';

const item = (over: Partial<TelemetryItem>): TelemetryItem => ({
  id: 'X', label: 'X', domain: 'READINESS', observability: 'COMPLETE', source: 's', missing: null, reason: 'r', impact: 'MEDIUM', consumers: ['READINESS'], ...over,
});

describe('scoreCoverage — counts + coverage math', () => {
  it('classifies and counts each observability class', () => {
    const items = [
      item({ id: 'a', observability: 'COMPLETE' }),
      item({ id: 'b', observability: 'PARTIAL' }),
      item({ id: 'c', observability: 'UNKNOWN' }),
      item({ id: 'd', observability: 'UNOBSERVABLE' }),
    ];
    const r = scoreCoverage(items);
    expect(r.fully_observable_signals).toBe(1);
    expect(r.partially_observable_signals).toBe(1);
    expect(r.unknown_signals).toBe(1);
    expect(r.unobservable_signals).toBe(1);
    expect(r.total_signals).toBe(4);
  });

  it('coverage % = (complete + 0.5·partial)/(complete+partial+unknown); UNOBSERVABLE excluded from denominator', () => {
    const items = [
      item({ id: 'a', observability: 'COMPLETE' }),
      item({ id: 'b', observability: 'PARTIAL' }),
      item({ id: 'c', observability: 'UNKNOWN' }),
      item({ id: 'd', observability: 'UNOBSERVABLE' }), // excluded
    ];
    // (1 + 0.5)/3 = 50%
    expect(scoreCoverage(items).coverage_percentage).toBe(50);
  });

  it('all-complete domain → 100%; all-unknown → 0%', () => {
    expect(scoreCoverage([item({ observability: 'COMPLETE' })]).coverage_percentage).toBe(100);
    expect(scoreCoverage([item({ observability: 'UNKNOWN' })]).coverage_percentage).toBe(0);
  });

  it('domain with only UNOBSERVABLE items → coverage null (nothing in scope)', () => {
    const r = scoreCoverage([item({ domain: 'ACQUISITION', observability: 'UNOBSERVABLE' })]);
    expect(r.by_domain.find((d) => d.domain === 'ACQUISITION')!.coverage_percentage).toBeNull();
  });
});

describe('portfolio aggregation', () => {
  const items = [
    item({ id: 'r1', domain: 'READINESS', observability: 'COMPLETE', impact: 'HIGH' }),
    item({ id: 'r2', domain: 'READINESS', observability: 'PARTIAL', impact: 'MEDIUM' }),
    item({ id: 'a1', domain: 'ACQUISITION', observability: 'UNKNOWN', impact: 'HIGH', consumers: ['ACQUISITION'] }),
    item({ id: 'a2', domain: 'ACQUISITION', observability: 'UNOBSERVABLE', impact: 'LOW', consumers: ['ACQUISITION'] }),
    item({ id: 'e1', domain: 'EVOLUTION', observability: 'PARTIAL', temporal: true, impact: 'HIGH' }),
  ];
  const r = scoreCoverage(items);

  it('largest gaps ordered by lowest coverage', () => {
    expect(r.largest_gaps[0].coverage_percentage! <= r.largest_gaps[r.largest_gaps.length - 1].coverage_percentage!).toBe(true);
    expect(r.largest_gaps[0].domain).toBe('ACQUISITION'); // 0% (1 unknown, unobservable excluded)
  });
  it('highest-impact blind spots ranked by impact', () => {
    expect(r.highest_impact_blind_spots[0].impact).toBe('HIGH');
    expect(r.highest_impact_blind_spots.map((b) => b.id)).toContain('a1');
  });
  it('no_history_states = temporal items', () => {
    expect(r.no_history_states.map((i) => i.id)).toEqual(['e1']);
  });
  it('dependency chains list consumers of blind spots', () => {
    const chain = r.dependency_chains_affected.find((c) => c.item === 'a1');
    expect(chain!.consumers).toContain('ACQUISITION');
  });
});

describe('real catalog + determinism', () => {
  it('catalog covers all 7 domains and is internally consistent', () => {
    const r = scoreCoverage();
    expect(r.total_signals).toBe(TELEMETRY_CATALOG.length);
    expect(r.by_domain.map((d) => d.domain).sort()).toEqual(['ACQUISITION', 'ATTRIBUTION', 'EVOLUTION', 'OPERATIONS', 'OUTCOMES', 'PLAYBOOKS', 'READINESS']);
    expect(r.fully_observable_signals + r.partially_observable_signals + r.unknown_signals + r.unobservable_signals).toBe(r.total_signals);
    expect(r.coverage_percentage).toBeGreaterThan(0);
    expect(r.coverage_percentage).toBeLessThanOrEqual(100);
  });
  it('identical inputs → identical output', () => {
    expect(JSON.stringify(scoreCoverage())).toBe(JSON.stringify(scoreCoverage()));
  });
});
