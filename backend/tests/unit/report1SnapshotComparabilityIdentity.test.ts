/**
 * Report 1 — HISTORY / COMPARABILITY FOUNDATION.
 *
 * Report 1 cannot report trend, momentum or trajectory until two COMPARABLE
 * snapshots exist. Before this guard, every history reader was keyed on
 * `company_id` alone:
 *
 *   deltaIntelligence.buildChangeIntelligence   loadSnapshots({ company_id })  → baseline = most recent prior row
 *   forecastService.buildForecast               regression over every row for the company
 *   trajectoryHistoryStore.loadSnapshots        velocity over first/last row for the company
 *
 * so three different non-events were published as company movement:
 *
 *   - the company CHANGED WEBSITE (`company_id` outlives a domain change)
 *   - the run used a different SCAN PROFILE (`executionPolicies.ts`: `lightweight`
 *     gets one query class with `runStructuredDataExtraction: false` and
 *     `runBenchmark: false`; `deep` gets four classes with both on)
 *   - the SCORING ENGINE changed (`source_metadata.engine_version`)
 *
 * THE DISCRIMINATOR. Every scenario below holds the two stored scores at
 * 40 → 58 and varies ONLY the comparability identity. The pre-fix code
 * published the identical +18 for all of them; one of them is movement and the
 * rest are measurement changes. That is why "the number is zero" is not the
 * test — the `[negative control]` block re-runs the pre-fix baseline selector
 * on the same fixtures and proves it still produces the number the guard now
 * refuses.
 *
 * No production database is touched: every case runs against the canonical
 * `InMemoryHistoryStore`, which is the same `HistoricalStore` interface and the
 * same code path `SupabaseHistoryStore` implements.
 */
import { randomUUID } from 'crypto';
import {
  InMemoryHistoryStore,
  registerHistoricalStore,
  getHistoricalStore,
  type ReportSnapshotRecord,
} from '../../services/intelligence/historicalPersistence';
import {
  buildComparabilityIdentity,
  readComparabilityIdentity,
  compareComparability,
  resolveComparabilitySubjectDomain,
  selectComparableBaseline,
  filterComparableSnapshots,
  type ComparabilityIdentity,
} from '../../services/intelligence/comparabilityIdentity';
import { buildChangeIntelligence } from '../../services/intelligence/deltaIntelligence';
import { buildForecast } from '../../services/intelligence/forecastService';
import { persistCanonicalSnapshot } from '../../services/intelligence/snapshotWriter';
import { CanonicalTrajectoryHistoryStore } from '../../services/intelligence/adapters/trajectoryHistoryStore';
import { buildComparisonView } from '../../services/intelligence/comparisonEngine';
import { emptyCanonicalScore } from '../../services/canonicalReport/canonicalReportTypes';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

const COMPANY = 'co-comparability';
const DOMAIN = 'example.com';
const ENGINE = 'engine-1';

function score(value: number | null) {
  return { ...emptyCanonicalScore(value == null ? 'insufficient_signal' : 'measured'), value };
}

type SnapshotOverrides = {
  observedAt?: string;
  authority?: number;
  scanProfile?: ReportSnapshotRecord['scan_profile'];
  engineVersion?: string;
  /** `undefined` reproduces a LEGACY row: written before `subject_domain` existed. */
  subjectDomain?: string | undefined;
  omitSubjectDomain?: boolean;
};

function storedSnapshot(over: SnapshotOverrides = {}): ReportSnapshotRecord {
  const sourceMetadata: ReportSnapshotRecord['source_metadata'] = {
    engine_version: over.engineVersion ?? ENGINE,
    providers_used: [],
    providers_unavailable: [],
  };
  if (!over.omitSubjectDomain) {
    sourceMetadata.subject_domain = over.subjectDomain ?? DOMAIN;
  }
  return {
    id: randomUUID(),
    company_id: COMPANY,
    observed_at: over.observedAt ?? '2026-08-01T00:00:00.000Z',
    authority_score: score(over.authority ?? 40),
    ai_visibility_score: score((over.authority ?? 40) - 5),
    maturity: 'building_baseline',
    maturity_stage: 'building_baseline',
    scan_profile: over.scanProfile ?? 'standard',
    source_metadata: sourceMetadata,
  };
}

/** The current run's identity, matching `storedSnapshot()`'s defaults. */
function currentIdentity(over?: Partial<Parameters<typeof buildComparabilityIdentity>[0]>): ComparabilityIdentity | null {
  return buildComparabilityIdentity({
    companyId: COMPANY,
    domain: DOMAIN,
    scanProfile: 'standard',
    engineVersion: ENGINE,
    ...(over ?? {}),
  });
}

/**
 * The minimum `CanonicalReport` surface `buildChangeIntelligence` reads:
 * `authority_overview.overall_score`, `ai_surface_presence.score`,
 * `benchmark.overlay`, `pillars[]` and `maturity_stage.stage`.
 */
function currentReport(authority: number): CanonicalReport {
  return {
    authority_overview: { overall_score: score(authority), maturity: 'building_baseline' },
    ai_surface_presence: { score: score(authority - 5) },
    benchmark: { state: 'unavailable', overlay: null },
    maturity_stage: { stage: 'building_baseline' },
    pillars: [{ pillar: 'authority', score: score(authority), primary_signal: null }],
    action_playbook: { actions: [] },
    strategic_playbook: { actions: [] },
    evidence_trace: { overall: { count: 0, sources: [], freshness: { last_observed_at: null, age_hours: null }, observations: [] }, by_pillar: {}, by_dimension: {} },
  } as unknown as CanonicalReport;
}

/**
 * `buildComparisonView` additionally reads `discoverability_authority_radar`
 * (for the benchmark strip) and `PILLAR_META[pillar].label`.
 */
function comparisonReport(authority: number): CanonicalReport {
  return {
    ...currentReport(authority),
    discoverability_authority_radar: {
      axes: [{ key: 'schema_coverage', label: 'Schema Coverage', score: score(authority) }],
    },
  } as unknown as CanonicalReport;
}

async function seed(records: ReportSnapshotRecord[]): Promise<void> {
  const store = getHistoricalStore();
  for (const snapshot of records) {
    await store.writeSnapshot({
      snapshot,
      pillars: [],
      providers: [],
      benchmark: null,
      recommendations: [],
      evidence: [],
    });
  }
}

/** Run change intelligence for THIS run (authority 58) against the seeded history. */
async function change(params: {
  stored: ReportSnapshotRecord[];
  identity?: ComparabilityIdentity | null;
}) {
  await seed(params.stored);
  return buildChangeIntelligence({
    companyId: COMPANY,
    current: currentReport(58),
    identity: params.identity === undefined ? currentIdentity() : params.identity,
  });
}

beforeEach(() => {
  registerHistoricalStore(new InMemoryHistoryStore());
});

// ── Non-vacuity ──────────────────────────────────────────────────────────────
//
// Everything below asserts that a delta is REFUSED. If the comparable case did
// not produce one, every refusal would pass for the wrong reason.

describe('comparability — non-vacuity: the comparable case really does publish a delta', () => {
  it('a matching prior snapshot yields state "measured" and the real +18', async () => {
    const result = await change({ stored: [storedSnapshot({ authority: 40 })] });
    expect(result.state).toBe('measured');
    expect(result.authority.delta).toBe(18);
    expect(result.authority.direction).toBe('improved');
    expect(result.authority.significant).toBe(true);
    expect(result.comparison_baseline_at).toBe('2026-08-01T00:00:00.000Z');
    expect(result.reason_unavailable).toBeNull();
  });
});

// ── A. Each identity component, varied alone ────────────────────────────────

describe('comparability — A: a change in the MEASUREMENT is never published as movement', () => {
  it('A1: a DOMAIN change yields not_comparable and no number', async () => {
    const result = await change({
      stored: [storedSnapshot({ authority: 40, subjectDomain: 'previous-site.com' })],
    });
    expect(result.state).toBe('not_comparable');
    expect(result.authority.delta).toBeNull();
    expect(result.comparison_baseline_at).toBeNull();
    expect(result.notable_changes).toEqual([]);
    // Never silence: the reason names the component that differs.
    expect(result.reason_unavailable).toMatch(/domain/i);
    expect(result.reason_unavailable).toMatch(/previous-site\.com/);
  });

  it('A2: a SCAN PROFILE change yields not_comparable and no number', async () => {
    const result = await change({
      stored: [storedSnapshot({ authority: 40, scanProfile: 'lightweight' })],
    });
    expect(result.state).toBe('not_comparable');
    expect(result.authority.delta).toBeNull();
    expect(result.reason_unavailable).toMatch(/scan profile/i);
    expect(result.reason_unavailable).toMatch(/lightweight/);
  });

  it('A3: an ENGINE VERSION change yields not_comparable and no number', async () => {
    const result = await change({
      stored: [storedSnapshot({ authority: 40, engineVersion: 'engine-0' })],
    });
    expect(result.state).toBe('not_comparable');
    expect(result.authority.delta).toBeNull();
    expect(result.reason_unavailable).toMatch(/engine version/i);
  });

  it('A4: a LEGACY row with no recorded subject_domain is not comparable (unknown is not "comparable")', async () => {
    const result = await change({
      stored: [storedSnapshot({ authority: 40, omitSubjectDomain: true })],
    });
    expect(result.state).toBe('not_comparable');
    expect(result.authority.delta).toBeNull();
    expect(result.reason_unavailable).toMatch(/predates comparability recording/i);
  });

  it('A5: a run whose OWN identity is incomplete compares against nothing', async () => {
    const result = await change({
      stored: [storedSnapshot({ authority: 40 })],
      identity: currentIdentity({ domain: null }),
    });
    expect(result.state).toBe('not_comparable');
    expect(result.authority.delta).toBeNull();
    expect(result.reason_unavailable).toMatch(/no complete comparability identity/i);
  });

  it('A6: every pillar delta is also withheld, not zeroed', async () => {
    const result = await change({
      stored: [storedSnapshot({ authority: 40, subjectDomain: 'previous-site.com' })],
    });
    expect(result.pillars.length).toBeGreaterThan(0);
    for (const entry of result.pillars) {
      expect(entry.delta.delta).toBeNull();
      expect(entry.delta.previous).toBeNull();
    }
  });
});

// ── B. insufficient_history is NOT not_comparable ───────────────────────────

describe('comparability — B: "we have not measured you twice" vs "not the same way"', () => {
  it('B1: no stored history at all is insufficient_history, which waiting fixes', async () => {
    const result = await change({ stored: [] });
    expect(result.state).toBe('insufficient_history');
    expect(result.authority.delta).toBeNull();
    expect(result.reason_unavailable).toMatch(/second comparable report run/i);
  });

  it('B2: one incomparable prior run is NOT reported as "no history"', async () => {
    const result = await change({
      stored: [storedSnapshot({ authority: 40, subjectDomain: 'previous-site.com' })],
    });
    expect(result.state).toBe('not_comparable');
    expect(result.state).not.toBe('insufficient_history');
  });

  it('B3: a single snapshot never implies a trend — direction is first_observation, significant false', async () => {
    const result = await change({ stored: [] });
    expect(result.authority.direction).toBe('first_observation');
    expect(result.authority.significant).toBe(false);
    expect(result.ai_visibility.delta).toBeNull();
    expect(result.benchmark_percentile.delta).toBeNull();
  });
});

// ── C. An incomparable run must not hide a comparable one behind it ─────────

describe('comparability — C: baseline selection reaches past an incomparable run', () => {
  it('C1: an ad-hoc deep scan between two standard scans does not destroy the comparison', async () => {
    const result = await change({
      stored: [
        storedSnapshot({ authority: 40, observedAt: '2026-07-01T00:00:00.000Z' }),
        storedSnapshot({ authority: 90, observedAt: '2026-08-01T00:00:00.000Z', scanProfile: 'deep' }),
      ],
    });
    expect(result.state).toBe('measured');
    // The baseline is the older COMPARABLE row, not the newer incomparable one.
    expect(result.comparison_baseline_at).toBe('2026-07-01T00:00:00.000Z');
    expect(result.authority.previous).toBe(40);
    expect(result.authority.delta).toBe(18);
  });

  it('C2: when EVERY prior run is incomparable the reason says how many were checked', async () => {
    const result = await change({
      stored: [
        storedSnapshot({ authority: 40, observedAt: '2026-07-01T00:00:00.000Z', subjectDomain: 'old-a.com' }),
        storedSnapshot({ authority: 50, observedAt: '2026-08-01T00:00:00.000Z', subjectDomain: 'old-b.com' }),
      ],
    });
    expect(result.state).toBe('not_comparable');
    expect(result.reason_unavailable).toMatch(/2 prior snapshots were checked/i);
  });
});

// ── D. The identity primitives ──────────────────────────────────────────────

describe('comparability — D: identity construction and domain normalization', () => {
  it('D1: scheme, www., path and case do not make a different subject', () => {
    expect(resolveComparabilitySubjectDomain('https://www.Example.com/pricing?a=1')).toBe('example.com');
    expect(resolveComparabilitySubjectDomain('example.com')).toBe('example.com');
  });

  it('D2: a value with no host is null, not an empty string that could compare equal', () => {
    expect(resolveComparabilitySubjectDomain('')).toBeNull();
    expect(resolveComparabilitySubjectDomain(null)).toBeNull();
    expect(resolveComparabilitySubjectDomain(undefined)).toBeNull();
    // A bare label is a brand word or slug, not a site.
    expect(resolveComparabilitySubjectDomain('acme')).toBeNull();
  });

  it('D3: a different TLD is a different subject', () => {
    const a = buildComparabilityIdentity({ companyId: COMPANY, domain: 'acme.com', scanProfile: 'standard', engineVersion: ENGINE });
    const b = buildComparabilityIdentity({ companyId: COMPANY, domain: 'acme.co.uk', scanProfile: 'standard', engineVersion: ENGINE });
    expect(compareComparability(a, b).comparable).toBe(false);
  });

  it('D4: every component missing in turn yields a null identity (fail closed)', () => {
    expect(buildComparabilityIdentity({ companyId: '', domain: DOMAIN, scanProfile: 'standard', engineVersion: ENGINE })).toBeNull();
    expect(buildComparabilityIdentity({ companyId: COMPANY, domain: null, scanProfile: 'standard', engineVersion: ENGINE })).toBeNull();
    expect(buildComparabilityIdentity({ companyId: COMPANY, domain: DOMAIN, scanProfile: 'standard', engineVersion: '  ' })).toBeNull();
    expect(buildComparabilityIdentity({ companyId: COMPANY, domain: DOMAIN, scanProfile: undefined as never, engineVersion: ENGINE })).toBeNull();
  });

  it('D5: PROVIDER availability is deliberately NOT part of the identity', () => {
    // Provider flapping is routine (ProviderHistoryRecord.outcome has
    // rate_limited / timeout / quota_exceeded). Folding it in would make no two
    // snapshots ever comparable and history would never accumulate.
    const a = storedSnapshot();
    const b = storedSnapshot();
    b.source_metadata.providers_used = ['openai', 'wikidata'];
    b.source_metadata.providers_unavailable = ['anthropic'];
    expect(compareComparability(readComparabilityIdentity(a), readComparabilityIdentity(b)).comparable).toBe(true);
  });

  it('D6: a comparable verdict carries no reason; an incomparable one always does', () => {
    const ok = compareComparability(currentIdentity(), readComparabilityIdentity(storedSnapshot()));
    expect(ok.comparable).toBe(true);
    expect(ok.reason).toBeNull();
    const bad = compareComparability(currentIdentity(), readComparabilityIdentity(storedSnapshot({ subjectDomain: 'other.com' })));
    expect(bad.comparable).toBe(false);
    expect(typeof bad.reason).toBe('string');
    expect((bad.reason ?? '').length).toBeGreaterThan(0);
  });

  it('D7: selectComparableBaseline separates no_history from not_comparable', () => {
    expect(selectComparableBaseline({ current: currentIdentity(), priorSnapshots: [] }).state).toBe('no_history');
    expect(
      selectComparableBaseline({
        current: currentIdentity(),
        priorSnapshots: [storedSnapshot({ subjectDomain: 'other.com' })],
      }).state,
    ).toBe('not_comparable');
  });
});

// ── E. Baseline #1: what must be true for the first comparable snapshot ─────

describe('comparability — E: baseline #1 is recorded by the writer', () => {
  it('E1: a run with a resolvable domain stamps subject_domain and reports comparable', async () => {
    const result = await persistCanonicalSnapshot({
      companyId: COMPANY,
      report: currentReport(40),
      scanProfile: 'standard',
      engineVersion: ENGINE,
      providerOutcomes: [],
      domain: 'https://www.Example.com/',
    });
    expect(result.written).toBe(true);
    expect(result.comparable).toBe(true);
    expect(result.comparabilityReason).toBeNull();

    const [stored] = await getHistoricalStore().loadSnapshots({ company_id: COMPANY, limit: 5 });
    expect(stored.source_metadata.subject_domain).toBe('example.com');
    expect(readComparabilityIdentity(stored)).toEqual({
      company_id: COMPANY,
      subject_domain: 'example.com',
      scan_profile: 'standard',
      engine_version: ENGINE,
    });
  });

  it('E2: that first row IS usable as the baseline for the next comparable run', async () => {
    await persistCanonicalSnapshot({
      companyId: COMPANY,
      report: currentReport(40),
      scanProfile: 'standard',
      engineVersion: ENGINE,
      providerOutcomes: [],
      domain: DOMAIN,
    });
    const [written] = await getHistoricalStore().loadSnapshots({ company_id: COMPANY, limit: 5 });

    // Baseline eligibility, asserted on the row the WRITER produced.
    expect(
      selectComparableBaseline({ current: currentIdentity(), priorSnapshots: [written] }).state,
    ).toBe('comparable');

    // And end-to-end through `buildChangeIntelligence`. The row is replayed
    // with an earlier `observed_at` and its own persisted `source_metadata`
    // (nothing is invented): `buildChangeIntelligence` requires a STRICTLY
    // earlier baseline, and a snapshot the writer created milliseconds ago is
    // not strictly earlier than `new Date()`. Real runs are days apart; this
    // keeps the assertion deterministic instead of racing the clock.
    registerHistoricalStore(new InMemoryHistoryStore());
    await seed([{ ...written, observed_at: '2026-07-01T00:00:00.000Z' }]);
    const result = await buildChangeIntelligence({
      companyId: COMPANY,
      current: currentReport(58),
      identity: currentIdentity(),
    });
    expect(result.state).toBe('measured');
    expect(result.authority.delta).toBe(18);
    expect(result.comparison_baseline_at).toBe('2026-07-01T00:00:00.000Z');
  });

  it('E3: an unresolvable domain is still RECORDED (time is irrecoverable) but never comparable', async () => {
    const result = await persistCanonicalSnapshot({
      companyId: COMPANY,
      report: currentReport(40),
      scanProfile: 'standard',
      engineVersion: ENGINE,
      providerOutcomes: [],
      domain: null,
    });
    expect(result.written).toBe(true);
    expect(result.comparable).toBe(false);
    expect(result.comparabilityReason).toMatch(/cannot serve as a comparison baseline/i);

    const [stored] = await getHistoricalStore().loadSnapshots({ company_id: COMPANY, limit: 5 });
    // The row exists — history accumulated — but it carries no guessed subject.
    expect(stored).toBeDefined();
    expect(stored.source_metadata.subject_domain).toBeUndefined();
    expect(readComparabilityIdentity(stored)).toBeNull();
  });
});

// ── F. Forecast ─────────────────────────────────────────────────────────────

describe('comparability — F: the forecast regression runs over one identity only', () => {
  const at = (day: string) => `2026-0${day}T00:00:00.000Z`;

  it('F1: non-vacuity — three comparable snapshots DO produce a measured forecast', () => {
    const forecast = buildForecast({
      snapshots: [
        storedSnapshot({ authority: 40, observedAt: at('5-01') }),
        storedSnapshot({ authority: 50, observedAt: at('6-01') }),
        storedSnapshot({ authority: 60, observedAt: at('7-01') }),
      ],
      horizonDays: 30,
      basis: currentIdentity(),
    });
    expect(forecast.state).toBe('measured');
    expect(forecast.history_count).toBe(3);
  });

  it('F2: one of the three measuring a different domain drops below the minimum', () => {
    const forecast = buildForecast({
      snapshots: [
        storedSnapshot({ authority: 40, observedAt: at('5-01'), subjectDomain: 'previous-site.com' }),
        storedSnapshot({ authority: 50, observedAt: at('6-01') }),
        storedSnapshot({ authority: 60, observedAt: at('7-01') }),
      ],
      horizonDays: 30,
      basis: currentIdentity(),
    });
    expect(forecast.state).toBe('unavailable');
    expect(forecast.trajectory).toBe('insufficient_history');
    expect(forecast.history_count).toBe(2);
    // The reason explains the shortfall rather than looking like a bug.
    expect(forecast.reason_unavailable).toMatch(/1 stored snapshot was excluded as not comparable/i);
  });

  it('F3: a null basis projects nothing', () => {
    const forecast = buildForecast({
      snapshots: [
        storedSnapshot({ authority: 40, observedAt: at('5-01') }),
        storedSnapshot({ authority: 50, observedAt: at('6-01') }),
        storedSnapshot({ authority: 60, observedAt: at('7-01') }),
      ],
      horizonDays: 30,
      basis: null,
    });
    expect(forecast.state).toBe('unavailable');
    expect(forecast.history_count).toBe(0);
    expect(forecast.projected_score).toBeNull();
    expect(forecast.confidence_band).toBeNull();
  });

  it('F4: legacy rows with no recorded subject cannot be regressed', () => {
    const forecast = buildForecast({
      snapshots: [
        storedSnapshot({ authority: 40, observedAt: at('5-01'), omitSubjectDomain: true }),
        storedSnapshot({ authority: 50, observedAt: at('6-01'), omitSubjectDomain: true }),
        storedSnapshot({ authority: 60, observedAt: at('7-01'), omitSubjectDomain: true }),
      ],
      horizonDays: 30,
      basis: currentIdentity(),
    });
    expect(forecast.state).toBe('unavailable');
    expect(forecast.history_count).toBe(0);
  });
});

// ── G. Authority trajectory ─────────────────────────────────────────────────

describe('comparability — G: trajectory velocity is anchored on the newest run', () => {
  it('G1: non-vacuity — a comparable pair is returned in full', async () => {
    await seed([
      storedSnapshot({ authority: 40, observedAt: '2026-06-01T00:00:00.000Z' }),
      storedSnapshot({ authority: 58, observedAt: '2026-07-01T00:00:00.000Z' }),
    ]);
    const series = await new CanonicalTrajectoryHistoryStore().loadSnapshots(COMPANY, 24);
    expect(series).toHaveLength(2);
  });

  it('G2: a pre-domain-change run is dropped from the series', async () => {
    await seed([
      storedSnapshot({ authority: 40, observedAt: '2026-06-01T00:00:00.000Z', subjectDomain: 'previous-site.com' }),
      storedSnapshot({ authority: 58, observedAt: '2026-07-01T00:00:00.000Z' }),
    ]);
    const series = await new CanonicalTrajectoryHistoryStore().loadSnapshots(COMPANY, 24);
    expect(series).toHaveLength(1);
    expect(series[0].observed_at).toBe('2026-07-01T00:00:00.000Z');
  });

  it('G3: when the newest run has no recorded identity the series is empty, never unfiltered', async () => {
    await seed([
      storedSnapshot({ authority: 40, observedAt: '2026-06-01T00:00:00.000Z' }),
      storedSnapshot({ authority: 58, observedAt: '2026-07-01T00:00:00.000Z', omitSubjectDomain: true }),
    ]);
    const series = await new CanonicalTrajectoryHistoryStore().loadSnapshots(COMPANY, 24);
    expect(series).toHaveLength(0);
  });
});

// ── H. The comparison view (prior-snapshot strip + progression) ─────────────

describe('comparability — H: the comparison strips obey the same rule', () => {
  it('H1: non-vacuity — a comparable prior snapshot DOES produce axis deltas', async () => {
    await seed([storedSnapshot({ authority: 40, observedAt: '2026-07-01T00:00:00.000Z' })]);
    const view = await buildComparisonView({
      companyId: COMPANY,
      current: comparisonReport(58),
      identity: currentIdentity(),
    });
    const authority = view.prior_snapshot_strip.axes.find((a) => a.key === 'authority');
    expect(authority?.state).toBe('measured');
    expect(authority?.delta).toBe(18);
    expect(view.prior_snapshot_strip.baseline_observed_at).toBe('2026-07-01T00:00:00.000Z');
    expect(view.prior_snapshot_strip.baseline_reason_unavailable).toBeNull();
    expect(view.maturity_progression).toHaveLength(1);
  });

  it('H2: a domain change withholds every axis delta and names the reason', async () => {
    await seed([
      storedSnapshot({ authority: 40, observedAt: '2026-07-01T00:00:00.000Z', subjectDomain: 'previous-site.com' }),
    ]);
    const view = await buildComparisonView({
      companyId: COMPANY,
      current: comparisonReport(58),
      identity: currentIdentity(),
    });
    expect(view.prior_snapshot_strip.baseline_observed_at).toBeNull();
    expect(view.prior_snapshot_strip.baseline_label).toBe('No comparable prior snapshot');
    expect(view.prior_snapshot_strip.baseline_reason_unavailable).toMatch(/domain/i);
    for (const axis of view.prior_snapshot_strip.axes) {
      expect(axis.delta).toBeNull();
      expect(axis.state).toBe('unavailable');
    }
    // The progression strip is a trend statement, so the old site is not plotted.
    expect(view.maturity_progression).toHaveLength(0);
  });

  it('H3: a null identity yields no baseline and an empty progression strip', async () => {
    await seed([storedSnapshot({ authority: 40, observedAt: '2026-07-01T00:00:00.000Z' })]);
    const view = await buildComparisonView({
      companyId: COMPANY,
      current: comparisonReport(58),
      identity: null,
    });
    expect(view.prior_snapshot_strip.baseline_observed_at).toBeNull();
    expect(view.prior_snapshot_strip.baseline_reason_unavailable).toMatch(/no complete comparability identity/i);
    expect(view.maturity_progression).toHaveLength(0);
  });

  it('H4: with no history at all the reason distinguishes "none yet" from "not comparable"', async () => {
    const view = await buildComparisonView({
      companyId: COMPANY,
      current: comparisonReport(58),
      identity: currentIdentity(),
    });
    expect(view.prior_snapshot_strip.baseline_label).toBe('No prior snapshot');
    expect(view.prior_snapshot_strip.baseline_reason_unavailable).toMatch(/second comparable report run/i);
  });
});

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────
//
// Each guard above must FAIL when the defect is reintroduced. The pre-fix
// behaviour is reproduced literally — `deltaIntelligence.ts` selected its
// baseline as `recentSnapshots.find((s) => s.observed_at < observedAt)`, with
// no comparability test at all — and run on the SAME fixtures.

/** The pre-fix baseline selector, verbatim in behaviour: most recent prior row. */
function preFixBaseline(priorSnapshots: ReportSnapshotRecord[]): ReportSnapshotRecord | null {
  return (
    [...priorSnapshots].sort((a, b) =>
      a.observed_at < b.observed_at ? 1 : a.observed_at > b.observed_at ? -1 : 0,
    )[0] ?? null
  );
}

function preFixAuthorityDelta(current: number, priorSnapshots: ReportSnapshotRecord[]): number | null {
  const baseline = preFixBaseline(priorSnapshots);
  if (!baseline || baseline.authority_score.value == null) return null;
  return Math.round((current - baseline.authority_score.value) * 10) / 10;
}

describe('comparability — [negative control] the pre-fix selector still produces the refused number', () => {
  it('N1: a domain change published +18 before the guard, and the guard now refuses it', async () => {
    const stored = [storedSnapshot({ authority: 40, subjectDomain: 'previous-site.com' })];

    // The defect, reproduced: company_id-only baseline selection yields a number.
    expect(preFixAuthorityDelta(58, stored)).toBe(18);

    // The guard refuses the SAME pair. If the guard were removed, this
    // assertion would read 18 — which is exactly the line above.
    const guarded = await change({ stored });
    expect(guarded.authority.delta).toBeNull();
    expect(guarded.state).toBe('not_comparable');
  });

  it('N2: a scan-profile change published the same +18', async () => {
    const stored = [storedSnapshot({ authority: 40, scanProfile: 'lightweight' })];
    expect(preFixAuthorityDelta(58, stored)).toBe(18);
    expect((await change({ stored })).authority.delta).toBeNull();
  });

  it('N3: an engine-version change published the same +18', async () => {
    const stored = [storedSnapshot({ authority: 40, engineVersion: 'engine-0' })];
    expect(preFixAuthorityDelta(58, stored)).toBe(18);
    expect((await change({ stored })).authority.delta).toBeNull();
  });

  it('N4: a legacy row with no recorded subject published the same +18', async () => {
    const stored = [storedSnapshot({ authority: 40, omitSubjectDomain: true })];
    expect(preFixAuthorityDelta(58, stored)).toBe(18);
    expect((await change({ stored })).authority.delta).toBeNull();
  });

  it('N5: the genuine case is NOT suppressed — the discriminator holds', async () => {
    // Identical stored score, identical pre-fix output as N1-N4; the ONLY
    // difference is that the measurement matched. A fix that merely returned
    // null everywhere would fail here.
    const stored = [storedSnapshot({ authority: 40 })];
    expect(preFixAuthorityDelta(58, stored)).toBe(18);
    const guarded = await change({ stored });
    expect(guarded.authority.delta).toBe(18);
    expect(guarded.state).toBe('measured');
  });

  it('N6: the pre-fix forecast regressed a mixed-identity series; the guard refuses it', () => {
    const mixed = [
      storedSnapshot({ authority: 40, observedAt: '2026-05-01T00:00:00.000Z', subjectDomain: 'previous-site.com' }),
      storedSnapshot({ authority: 50, observedAt: '2026-06-01T00:00:00.000Z' }),
      storedSnapshot({ authority: 60, observedAt: '2026-07-01T00:00:00.000Z' }),
    ];
    // Pre-fix behaviour = no filtering at all, i.e. a null-identity-free pass.
    expect(filterComparableSnapshots(currentIdentity(), mixed)).toHaveLength(2);
    expect(mixed).toHaveLength(3);
    const guarded = buildForecast({ snapshots: mixed, horizonDays: 30, basis: currentIdentity() });
    expect(guarded.state).toBe('unavailable');
    // ...while three genuinely comparable points DO project.
    const comparableOnly = [
      storedSnapshot({ authority: 40, observedAt: '2026-05-01T00:00:00.000Z' }),
      storedSnapshot({ authority: 50, observedAt: '2026-06-01T00:00:00.000Z' }),
      storedSnapshot({ authority: 60, observedAt: '2026-07-01T00:00:00.000Z' }),
    ];
    expect(buildForecast({ snapshots: comparableOnly, horizonDays: 30, basis: currentIdentity() }).state).toBe('measured');
  });
});

// ── The surface must not collapse NOT_COMPARABLE into INSUFFICIENT_HISTORY ───
//
// Report 1's trust contract requires these to be distinguishable: one says "we have not
// observed you enough times yet", the other says "we HAVE observed you before, but that
// observation measured something else". Collapsing them tells a company it has no history
// when in fact it has history that cannot be differenced.

import { buildTrajectoryMovement } from '../../services/intelligence/dossier/intelligenceSurfacesFoundations';
import { renderTrajectoryMovement } from '../../services/intelligence/exportRendererSectionsA';
// `CanonicalReport` is already imported at the top of this file; a second `import type` of the
// same name is a duplicate declaration (TS2300), not an additional import.

const reportWithChangeState = (
  state: 'measured' | 'insufficient_history' | 'not_comparable',
  snapshotValues: number[] = [],
): CanonicalReport => ({
  change_intelligence: {
    state,
    observed_at: '2026-10-05T00:00:00.000Z',
    comparison_baseline_at: state === 'insufficient_history' ? null : '2026-09-01T00:00:00.000Z',
    authority_delta: state === 'measured'
      ? { current: 58, previous: 40, delta: 18, direction: 'improved' }
      : { current: null, previous: null, delta: null, direction: 'first_observation' },
    ai_visibility_delta: { current: null, previous: null, delta: null, direction: 'first_observation' },
    notable_changes: state === 'measured' ? ['Authority improved by 18'] : [],
  },
  authority_trajectory: {
    snapshots: snapshotValues.map((v, i) => ({
      observed_at: `2026-0${i + 1}-01T00:00:00.000Z`,
      score: { value: v, state: 'measured' },
    })),
  },
} as unknown as CanonicalReport);

describe('surface — not_comparable stays distinct from insufficient_history', () => {
  it('reports not_comparable as its own state, not as missing history', () => {
    const surface = buildTrajectoryMovement(reportWithChangeState('not_comparable'));
    expect(surface.state).toBe('not_comparable');
    expect(surface.state).not.toBe('insufficient_history');
  });

  it('still reports a genuine shortage of history as insufficient_history', () => {
    expect(buildTrajectoryMovement(reportWithChangeState('insufficient_history')).state)
      .toBe('insufficient_history');
  });

  it('does not let a long incomparable series be promoted to a trend', () => {
    // Four valued snapshots clears the >=3 count gate; comparability must still win.
    const surface = buildTrajectoryMovement(reportWithChangeState('not_comparable', [40, 45, 50, 58]));
    expect(surface.state).toBe('not_comparable');
    expect(surface.authority_delta.delta).toBeNull();
    expect(surface.notable_changes).toEqual([]);
  });

  it('says the observation is not comparable, not that history is absent', () => {
    const read = buildTrajectoryMovement(reportWithChangeState('not_comparable')).read;
    expect(read).toContain('not comparable');
    expect(read).not.toContain('needs repeated observation');
  });

  it('withholds the delta rather than reporting it as zero', () => {
    const d = buildTrajectoryMovement(reportWithChangeState('not_comparable')).authority_delta;
    expect(d.delta).toBeNull();
    expect(d.current).toBeNull();
    expect(d.previous).toBeNull();
    expect(d.delta).not.toBe(0);
  });

  it('still measures a genuinely comparable pair — the guard is not blanket suppression', () => {
    const surface = buildTrajectoryMovement(reportWithChangeState('measured'));
    expect(surface.state).toBe('measured');
    expect(surface.authority_delta.delta).toBe(18);
  });

  it('renders no spark line or delta for a non-comparable observation', () => {
    const html = renderTrajectoryMovement(
      buildTrajectoryMovement(reportWithChangeState('not_comparable', [40, 45, 50, 58])),
    );
    expect(html).toContain('not comparable');
    // The abstain block carries only the eyebrow and the read; the trend block adds the spark.
    expect(html).not.toContain('ds-vspark');
    expect(html).not.toContain('+18');
  });

  it('DOES render the trend when the pair is comparable — proves the abstain check is not vacuous', () => {
    const html = renderTrajectoryMovement(
      buildTrajectoryMovement(reportWithChangeState('measured', [40, 45, 50, 58])),
    );
    // The same markers asserted absent above must be present here, or that assertion proved nothing.
    expect(html).toContain('ds-vspark');
    expect(html).not.toContain('not comparable');
  });
});
