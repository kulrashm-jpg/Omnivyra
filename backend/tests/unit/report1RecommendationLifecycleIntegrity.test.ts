/**
 * RECOMMENDATION LIFECYCLE — ABSENCE IS NOT RESOLUTION.
 *
 * ─── THE DEFECT THIS SUITE PINS ────────────────────────────────────────────
 *
 * `snapshotWriter` recorded `status: 'resolved'` for any prior action missing
 * from the current run. Set membership was the entire basis, so the system wrote
 * down that a CUSTOMER HAD COMPLETED WORK on evidence that establishes nothing
 * of the kind.
 *
 * Action ids are `<source>:<title>` and those titles interpolate the measured
 * domain, the discovered competitor name, a query and a keyword. So the ordinary
 * causes of an action "disappearing" are: its identifier changed, the surface
 * that generates it was not measured, or the scan profile narrowed. None is an
 * achievement, and nothing in the system evidences completion — the only
 * per-action signal is a dismissal, which is suppression.
 *
 * `no_longer_surfaced` states what is actually known: this IDENTIFIER stopped
 * appearing. The suite below pins that, the forward-only guarantees around it,
 * and — equally important — that the statuses which were always honest still
 * work, so the correction is not blanket suppression.
 *
 * ─── SEAM ──────────────────────────────────────────────────────────────────
 *
 * The real `persistCanonicalSnapshot` runs against the in-memory historical
 * store the other history suites use. No database, no network. A database-level
 * claim (the CHECK constraint) is NOT made here — that belongs to the
 * real-schema suite, and `report1RecommendationStatusVocabulary.test.ts` pins
 * the declarations against each other.
 */
import {
  _resetHistoricalStore,
  classifyRecommendationStatus,
  getHistoricalStore,
  type RecommendationHistoryRecord,
} from '../../services/intelligence/historicalPersistence';
import { persistCanonicalSnapshot } from '../../services/intelligence/snapshotWriter';
import type { CanonicalReport, CanonicalScore } from '../../services/canonicalReport/canonicalReportTypes';

const COMPANY = 'company-lifecycle-1';
const DOMAIN = 'northwind-analytics.test';

type Action = { id: string; title: string; pillar: string; severity: string; leverage_score: number };

/** The minimum of a CanonicalReport that the writer reads. */
function reportWith(actions: Action[]): CanonicalReport {
  return {
    authority_overview: { overall_score: { value: 61, state: 'measured' }, maturity: 'developing' },
    maturity_stage: { stage: 'emerging' },
    ai_surface_presence: { score: { value: 40, state: 'measured' } },
    pillars: [],
    action_playbook: { actions },
    evidence_trace: {
      overall: { count: 3, sources: ['crawler'], observations: [] },
      by_pillar: {},
      by_dimension: {},
    },
    // The writer reads `benchmark.overlay` / `.state` to decide whether a
    // benchmark row is recorded. Unavailable here: this suite is about the
    // recommendation lifecycle and must not imply a peer comparison.
    benchmark: { overlay: null, state: 'unavailable' },
    scan_metadata: {},
  } as unknown as CanonicalReport;
}

const action = (over: Partial<Action> = {}): Action => ({
  id: 'seo:Fix missing titles',
  title: 'Fix missing titles',
  pillar: 'foundation',
  severity: 'moderate',
  leverage_score: 7,
  ...over,
});

/**
 * Distinct wall-clock per run.
 *
 * `persistCanonicalSnapshot` stamps `observed_at` from `new Date()`, and the
 * store orders history by that value. Two runs issued in the same millisecond —
 * trivial in a unit test, impossible in production where runs are minutes or
 * days apart and `(company_id, observed_at)` is UNIQUE — would make "the most
 * recent prior row" ambiguous and the assertions intermittent. Advancing the
 * system clock per run reproduces the real separation rather than papering over
 * it with a sleep.
 */
const RUN_EPOCH = Date.parse('2026-03-01T00:00:00.000Z');
let runClock = RUN_EPOCH;

/** One report run through the REAL writer. */
async function run(actions: Action[]): Promise<void> {
  runClock += 3_600_000; // one hour between runs
  jest.setSystemTime(runClock);
  const result = await persistCanonicalSnapshot({
    companyId: COMPANY,
    report: reportWith(actions),
    scanProfile: 'standard',
    engineVersion: 'phase-5',
    providerOutcomes: [],
    domain: DOMAIN,
  });
  expect(result.written).toBe(true);
}

async function rows(): Promise<RecommendationHistoryRecord[]> {
  return getHistoricalStore().loadRecommendationHistory({ company_id: COMPANY, limit: 500 });
}

/** Rows for one action, oldest first, so a lifecycle reads top to bottom. */
async function historyFor(actionId: string): Promise<RecommendationHistoryRecord[]> {
  return (await rows())
    .filter((r) => r.action_id === actionId)
    .sort((a, b) => (a.observed_at < b.observed_at ? -1 : a.observed_at > b.observed_at ? 1 : 0));
}

const statuses = (list: RecommendationHistoryRecord[]): string[] => list.map((r) => r.status);

beforeAll(() => {
  // Only the clock is faked; the in-memory store is synchronous, so promises
  // still settle normally.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  _resetHistoricalStore();
  runClock = RUN_EPOCH;
  jest.setSystemTime(runClock);
});

// ── THE CORRECTION ─────────────────────────────────────────────────────────

describe('absence is recorded as no_longer_surfaced, never as resolved', () => {
  it('an action that stops appearing is no_longer_surfaced', async () => {
    await run([action()]);
    await run([]);
    const history = await historyFor('seo:Fix missing titles');
    expect(statuses(history)).toEqual(['first_seen', 'no_longer_surfaced']);
  });

  it('NO row anywhere in the lifecycle is written as resolved', async () => {
    await run([action()]);
    await run([]);
    await run([action()]);
    await run([]);
    for (const row of await rows()) expect(row.status).not.toBe('resolved');
  });

  it('a surface going unmeasured is not an achievement — many disappearing at once', async () => {
    // A narrower scan profile drops whole action families. Under the old rule
    // this wrote a batch of "resolved" rows, i.e. a page of work the customer
    // never did.
    const family = [
      action({ id: 'geo_aeo:Improve AI answer visibility for "mid market analytics"' }),
      action({ id: 'competitor:Run monthly competitor checkpoint vs Contoso' }),
      action({ id: 'seo:Search opportunity around analytics is being under-captured' }),
    ];
    await run(family);
    await run([]);
    const absent = (await rows()).filter((r) => r.status === 'no_longer_surfaced');
    expect(absent).toHaveLength(3);
    expect((await rows()).some((r) => r.status === 'resolved')).toBe(false);
  });
});

// ── FORWARD-ONLY ───────────────────────────────────────────────────────────

describe('the lifecycle is forward-only', () => {
  it('a still-absent action does NOT append a duplicate row on later runs', async () => {
    await run([action()]);
    await run([]);
    await run([]);
    await run([]);
    const history = await historyFor('seo:Fix missing titles');
    expect(statuses(history)).toEqual(['first_seen', 'no_longer_surfaced']);
  });

  it('prior rows are never modified — only appended to', async () => {
    await run([action()]);
    const before = (await historyFor('seo:Fix missing titles')).map((r) => JSON.stringify(r));
    await run([]);
    const after = await historyFor('seo:Fix missing titles');
    // The original row survives byte-identical; the new fact is a new row.
    expect(after.map((r) => JSON.stringify(r))).toEqual([...before, JSON.stringify(after[1])]);
    expect(after[0].status).toBe('first_seen');
  });
});

// ── REAPPEARANCE ───────────────────────────────────────────────────────────

describe('reappearance after no_longer_surfaced', () => {
  it('without severity escalation it is persistent, NOT regressed', async () => {
    await run([action({ severity: 'moderate' })]);
    await run([]);
    await run([action({ severity: 'moderate' })]);
    const history = await historyFor('seo:Fix missing titles');
    expect(statuses(history)).toEqual(['first_seen', 'no_longer_surfaced', 'persistent']);
  });

  it('with severity escalation it IS regressed — escalation is real evidence', async () => {
    await run([action({ severity: 'low' })]);
    await run([]);
    await run([action({ severity: 'critical' })]);
    const history = await historyFor('seo:Fix missing titles');
    expect(statuses(history)).toEqual(['first_seen', 'no_longer_surfaced', 'regressed']);
  });

  it('the gap remains readable — it is recorded in the PRIOR row, not re-encoded', async () => {
    // This is why reappearance needs no status of its own: the absence is still
    // in the history and is queryable per action.
    await run([action()]);
    await run([]);
    await run([action()]);
    const history = await historyFor('seo:Fix missing titles');
    expect(history[1].status).toBe('no_longer_surfaced');
    expect(history[1].observed_at < history[2].observed_at).toBe(true);
  });
});

describe('reappearance after a LEGACY resolved row', () => {
  /** A fully-formed CanonicalScore, so the seed is TYPED rather than cast. */
  const seedScore = (value: number): CanonicalScore => ({
    value,
    state: 'measured',
    confidence: 'medium',
    band: 'developing',
    evidence: { count: 1, sources: ['crawler'], observations: [] } as unknown as CanonicalScore['evidence'],
    benchmark: { value: null, label: null },
  });

  /** Seed a legacy row directly — this is what pre-correction history contains. */
  async function seedLegacyResolved(severity: 'low' | 'moderate' | 'critical'): Promise<void> {
    await getHistoricalStore().writeSnapshot({
      snapshot: {
        id: 'aaaaaaaa-0000-4000-8000-00000000f001',
        company_id: COMPANY,
        observed_at: '2026-01-01T00:00:00.000Z',
        authority_score: seedScore(55),
        ai_visibility_score: seedScore(30),
        maturity: 'building_baseline',
        maturity_stage: 'emerging',
        scan_profile: 'standard',
        source_metadata: { engine_version: 'phase-5', providers_used: [], providers_unavailable: [], subject_domain: DOMAIN },
      },
      pillars: [],
      providers: [],
      // Explicitly null: this seed is about the recommendation lifecycle and
      // must not imply a peer comparison was recorded.
      benchmark: null,
      recommendations: [{
        id: 'aaaaaaaa-0000-4000-8000-00000000f002',
        company_id: COMPANY,
        observed_at: '2026-01-01T00:00:00.000Z',
        action_id: 'seo:Fix missing titles',
        title: 'Fix missing titles',
        pillar: 'foundation',
        severity,
        leverage_score: 7,
        status: 'resolved',
      }],
      evidence: [],
    });
  }

  it('is persistent, NOT regressed — a legacy resolved row proves nothing', async () => {
    await seedLegacyResolved('moderate');
    await run([action({ severity: 'moderate' })]);
    const history = await historyFor('seo:Fix missing titles');
    expect(statuses(history)).toEqual(['resolved', 'persistent']);
  });

  it('is regressed only when severity escalated', async () => {
    await seedLegacyResolved('low');
    await run([action({ severity: 'critical' })]);
    const history = await historyFor('seo:Fix missing titles');
    expect(statuses(history)).toEqual(['resolved', 'regressed']);
  });

  it('the legacy row is PRESERVED exactly — never rewritten or reclassified', async () => {
    await seedLegacyResolved('moderate');
    const legacyBefore = JSON.stringify((await historyFor('seo:Fix missing titles'))[0]);
    await run([action()]);
    await run([]);
    const legacyAfter = JSON.stringify((await historyFor('seo:Fix missing titles'))[0]);
    expect(legacyAfter).toBe(legacyBefore);
  });

  it('a legacy resolved row is terminal for absence — it does not gain an absence row', async () => {
    await seedLegacyResolved('moderate');
    await run([]); // the action is absent, and the prior row already records an absence
    const history = await historyFor('seo:Fix missing titles');
    expect(statuses(history)).toEqual(['resolved']);
  });
});

// ── MUTABLE IDENTITY ───────────────────────────────────────────────────────

describe('a changed action identifier is not a completed action', () => {
  it('two competitor ids differing only by competitor name produce absence + first_seen', async () => {
    await run([action({ id: 'competitor:Run monthly competitor checkpoint vs Contoso' })]);
    await run([action({ id: 'competitor:Run monthly competitor checkpoint vs Fabrikam' })]);
    const old = await historyFor('competitor:Run monthly competitor checkpoint vs Contoso');
    const now = await historyFor('competitor:Run monthly competitor checkpoint vs Fabrikam');
    expect(statuses(old)).toEqual(['first_seen', 'no_longer_surfaced']);
    expect(statuses(now)).toEqual(['first_seen']);
    // The customer did nothing; nothing claims they did.
    expect((await rows()).some((r) => r.status === 'resolved')).toBe(false);
  });
});

// ── NON-VACUITY: THE HONEST STATUSES STILL WORK ────────────────────────────

describe('non-vacuity — the correction is not blanket suppression', () => {
  it('first appearance is first_seen', async () => {
    await run([action()]);
    expect(statuses(await historyFor('seo:Fix missing titles'))).toEqual(['first_seen']);
  });

  it('continued presence at equal severity is persistent', async () => {
    await run([action({ severity: 'moderate' })]);
    await run([action({ severity: 'moderate' })]);
    expect(statuses(await historyFor('seo:Fix missing titles'))).toEqual(['first_seen', 'persistent']);
  });

  it('severity escalation while continuously present is regressed', async () => {
    await run([action({ severity: 'low' })]);
    await run([action({ severity: 'critical' })]);
    expect(statuses(await historyFor('seo:Fix missing titles'))).toEqual(['first_seen', 'regressed']);
  });

  it('de-escalation is NOT reported as an achievement', async () => {
    await run([action({ severity: 'critical' })]);
    await run([action({ severity: 'low' })]);
    // Still present, so still persistent. Lower severity is not completion.
    expect(statuses(await historyFor('seo:Fix missing titles'))).toEqual(['first_seen', 'persistent']);
  });
});

// ── THE CLASSIFIER, DIRECTLY ───────────────────────────────────────────────

describe('classifyRecommendationStatus never returns resolved', () => {
  const prior = (status: RecommendationHistoryRecord['status'], severity: 'low' | 'moderate' | 'critical') => ({
    id: 'x', company_id: COMPANY, observed_at: '2026-01-01T00:00:00.000Z',
    action_id: 'a', title: 't', pillar: 'foundation' as const, severity, leverage_score: 1, status,
  });

  it('for every prior status, at equal severity, the answer is persistent', () => {
    for (const status of ['first_seen', 'persistent', 'resolved', 'regressed', 'no_longer_surfaced'] as const) {
      expect(classifyRecommendationStatus({
        current: { action_id: 'a', severity: 'moderate' },
        prior: prior(status, 'moderate'),
      })).toBe('persistent');
    }
  });

  it('for every prior status, escalation yields regressed', () => {
    for (const status of ['first_seen', 'persistent', 'resolved', 'regressed', 'no_longer_surfaced'] as const) {
      expect(classifyRecommendationStatus({
        current: { action_id: 'a', severity: 'critical' },
        prior: prior(status, 'low'),
      })).toBe('regressed');
    }
  });

  it('no prior is first_seen', () => {
    expect(classifyRecommendationStatus({
      current: { action_id: 'a', severity: 'moderate' }, prior: null,
    })).toBe('first_seen');
  });
});
