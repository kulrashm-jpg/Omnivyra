/**
 * WS-2 Milestone-1 — Lead Intelligence data-pipeline completion.
 *
 * Pins the approved M1 scope: session metadata now reaches the engines, the
 * behaviour pipeline derives the durable visitor signals from it, those
 * signals are explainable in intent / qualification / recommendation, they
 * propagate into the persisted envelope, and session persistence no longer
 * fails silently. Deterministic throughout: injected clock, no randomness,
 * ports injected, DB mocked.
 */

type Row = Record<string, unknown>;
const db = {
  insertError: null as null | { code?: string; message?: string },
  racedRow: null as Row | null,
  returnInsertedId: true,
  inserted: [] as Row[],
  selects: 0,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    // The resolver reads twice: first the pre-insert existence check (which
    // must miss, or we never reach the insert), then — only on a unique
    // violation — the conflict read-back.
    chain.maybeSingle = async () => {
      db.selects += 1;
      return { data: db.selects === 1 ? null : db.racedRow, error: null };
    };
    chain.single = async () => ({
      data: db.insertError ? null : db.returnInsertedId ? { id: 'vs-new' } : {},
      error: db.insertError,
    });
    chain.insert = (row: Row) => {
      db.inserted.push(row);
      return chain;
    };
    chain.update = () => chain;
    chain.upsert = async () => ({ error: null });
    return chain;
  },
}));

const logs: Array<{ level: string; event: string; payload: Record<string, unknown> }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    debug: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'debug', event, payload }),
    info: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'info', event, payload }),
    warn: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'warn', event, payload }),
    error: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'error', event, payload }),
  },
}));

import {
  assembleLeadCaptureSnapshot,
  analyzeBehavior,
  computeIntentIntelligence,
  buildLeadIntelligenceSummary,
  defaultEngineConfig,
  type CapturedSession,
} from '../../services/leadIntelligenceEngine';
import { registry } from '../../observability/registry';
import { INTEL_METRICS, __resetTelemetryThrottleForTests } from '../../services/leadIntelligenceTelemetry';

const counterTotal = (name: string): number =>
  registry.counterEntries().filter((c) => c.name === name).reduce((a, c) => a + c.value, 0);

const NOW = '2026-08-10T12:00:00.000Z';

/** A visitor_sessions row exactly as capture writes it. */
const sessionRow = (over: Row = {}): Row => ({
  id: 'vs-1',
  started_at: '2026-08-09T10:00:00.000Z',
  last_seen_at: '2026-08-09T10:30:00.000Z',
  first_landing_page: '/',
  last_current_page: 'https://x.com/pricing',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'q3',
  metadata: {
    visitor: {
      visit_count: 4,
      returning_visitor: true,
      first_visit_at: '2026-07-11T09:00:00.000Z',
      latest_visit_at: '2026-08-09T10:00:00.000Z',
      session_duration_ms: 1_800_000,
    },
  },
  ...over,
});

const leadRow = (): Row => ({
  id: 'L1',
  company_id: 'co-1',
  email: 'cto@bigcorp.com',
  created_at: '2026-08-09T11:00:00.000Z',
  visitor_session_id: 'vs-1',
  metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
});

const eventRow = (id: string, url: string, at: string, session = 'vs-1'): Row => ({
  id,
  event_name: 'page_view',
  page_url: url,
  visitor_session_id: session,
  occurred_at: at,
  metadata: {},
});

const buildSnapshot = (sessions: Row[], events: Row[] = [eventRow('t1', '/pricing', '2026-08-09T10:05:00.000Z')]) =>
  assembleLeadCaptureSnapshot({
    leadRow: leadRow(),
    trackingEventRows: events,
    visitorSessionRows: sessions,
    touchpointRows: [],
    now: NOW,
  });

beforeEach(() => {
  db.insertError = null;
  db.racedRow = null;
  db.returnInsertedId = true;
  db.inserted.length = 0;
  db.selects = 0;
  logs.length = 0;
  registry.reset();
  __resetTelemetryThrottleForTests();
});

describe('WS-2 M1 (1) — session metadata reaches the snapshot', () => {
  it('maps every approved additive field from visitor_sessions', () => {
    const s = buildSnapshot([sessionRow()]).sessions[0];
    expect(s).toMatchObject({
      id: 'vs-1',
      lastCurrentPage: 'https://x.com/pricing',
      returning: true,
      visitCount: 4,
      firstVisitAt: '2026-07-11T09:00:00.000Z',
      sessionDurationMs: 1_800_000,
    });
    // pre-existing fields unchanged
    expect(s.firstLandingPage).toBe('/');
    expect(s.utmCampaign).toBe('q3');
  });

  it('is backward compatible: a legacy row without metadata.visitor yields nulls, not zeros', () => {
    const s = buildSnapshot([sessionRow({ metadata: {}, last_current_page: null })]).sessions[0];
    expect(s.returning).toBeNull();
    expect(s.visitCount).toBeNull();
    expect(s.firstVisitAt).toBeNull();
    expect(s.sessionDurationMs).toBeNull();
    expect(s.lastCurrentPage).toBeNull();
  });

  it('rejects malformed metadata rather than coercing it', () => {
    const s = buildSnapshot([
      sessionRow({ metadata: { visitor: { visit_count: 'many', returning_visitor: 'yes', session_duration_ms: -5, first_visit_at: 'nope' } } }),
    ]).sessions[0];
    expect(s.visitCount).toBeNull();
    expect(s.returning).toBeNull();
    expect(s.sessionDurationMs).toBeNull();
    expect(s.firstVisitAt).toBeNull();
  });
});

describe('WS-2 M1 (2) — behaviour derivations', () => {
  const twoSessions = () => [
    sessionRow({ id: 'vs-1', started_at: '2026-08-01T10:00:00.000Z' }),
    sessionRow({
      id: 'vs-2',
      started_at: '2026-08-09T10:00:00.000Z',
      metadata: { visitor: { visit_count: 5, returning_visitor: true, first_visit_at: '2026-07-11T09:00:00.000Z', session_duration_ms: 600_000 } },
      last_current_page: 'https://x.com/demo',
    }),
  ];

  it('derives returning, visit count, first visit and days-since-first-visit', () => {
    const b = analyzeBehavior(buildSnapshot(twoSessions()), defaultEngineConfig);
    expect(b.returningVisitor).toBe(true);
    expect(b.visitCount).toBe(5); // highest durable ordinal
    expect(b.firstVisitAt).toBe('2026-07-11T09:00:00.000Z');
    expect(Math.round(b.daysSinceFirstVisit!)).toBe(30);
  });

  it('computes time between sessions deterministically', () => {
    const b = analyzeBehavior(buildSnapshot(twoSessions()), defaultEngineConfig);
    expect(b.avgTimeBetweenSessionsMs).toBe(8 * 86_400_000);
    expect(b.minTimeBetweenSessionsMs).toBe(8 * 86_400_000);
    // repeated analysis is identical
    const again = analyzeBehavior(buildSnapshot(twoSessions()), defaultEngineConfig);
    expect(again.avgTimeBetweenSessionsMs).toBe(b.avgTimeBetweenSessionsMs);
  });

  it('sums session duration and dedupes exit pages', () => {
    const b = analyzeBehavior(buildSnapshot(twoSessions()), defaultEngineConfig);
    expect(b.totalSessionDurationMs).toBe(1_800_000 + 600_000);
    expect(b.exitPages).toEqual(['/demo', '/pricing']); // sorted, deduped, path-only
  });

  it('a single session yields no gap, and unknown stays null (never 0)', () => {
    const b = analyzeBehavior(buildSnapshot([sessionRow({ metadata: {} })]), defaultEngineConfig);
    expect(b.avgTimeBetweenSessionsMs).toBeNull();
    expect(b.minTimeBetweenSessionsMs).toBeNull();
    expect(b.totalSessionDurationMs).toBeNull();
    expect(b.visitCount).toBeNull();
    expect(b.returningVisitor).toBeNull();
  });

  it('observed multi-session activity upgrades an unknown returning flag but never downgrades a true one', () => {
    const observed = analyzeBehavior(
      buildSnapshot([sessionRow({ id: 'a', metadata: {} }), sessionRow({ id: 'b', metadata: {}, started_at: '2026-08-05T10:00:00.000Z' })]),
      defaultEngineConfig,
    );
    expect(observed.returningVisitor).toBe(true);

    const firstEver = analyzeBehavior(
      buildSnapshot([sessionRow({ metadata: { visitor: { visit_count: 1, returning_visitor: false, first_visit_at: NOW } } })]),
      defaultEngineConfig,
    );
    expect(firstEver.returningVisitor).toBe(false);
  });
});

describe('WS-2 M1 (5) — explainability of the new signals', () => {
  it('intent exposes visitor loyalty and return cadence as evidenced contributions', () => {
    const snap = buildSnapshot([
      sessionRow({ id: 'vs-1', started_at: '2026-08-08T10:00:00.000Z' }),
      sessionRow({ id: 'vs-2', started_at: '2026-08-09T10:00:00.000Z' }),
    ]);
    const intent = computeIntentIntelligence(snap);
    const loyalty = intent.contributions.find((c) => c.signal === 'visitor_loyalty');
    const cadence = intent.contributions.find((c) => c.signal === 'return_cadence');

    expect(loyalty).toBeDefined();
    expect(loyalty!.points).toBe(3 * defaultEngineConfig.intent.loyaltyPoints.pointsPerVisitBeyondFirst);
    expect(loyalty!.evidence).toContain('Visit #4');
    expect(cadence).toBeDefined();
    expect(cadence!.evidence).toBe('Returned within a day');
    // every contribution stays explainable
    for (const c of intent.contributions) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it('loyalty is capped and absent for a first-time visitor', () => {
    const many = computeIntentIntelligence(
      buildSnapshot([sessionRow({ metadata: { visitor: { visit_count: 99, returning_visitor: true, first_visit_at: '2026-01-01T00:00:00.000Z' } } })]),
    );
    expect(many.contributions.find((c) => c.signal === 'visitor_loyalty')!.points).toBe(
      defaultEngineConfig.intent.loyaltyPoints.cap,
    );

    const first = computeIntentIntelligence(
      buildSnapshot([sessionRow({ metadata: { visitor: { visit_count: 1, returning_visitor: false, first_visit_at: NOW } } })]),
    );
    expect(first.contributions.find((c) => c.signal === 'visitor_loyalty')).toBeUndefined();
  });

  it('qualification urgency and behaviour reasoning cite the new signals', () => {
    const summary = buildLeadIntelligenceSummary(
      buildSnapshot([
        sessionRow({ id: 'vs-1', started_at: '2026-08-08T10:00:00.000Z' }),
        sessionRow({ id: 'vs-2', started_at: '2026-08-09T10:00:00.000Z' }),
      ]),
    );
    const urgency = summary.qualification.sections.find((s) => s.key === 'urgency')!;
    const behaviour = summary.qualification.sections.find((s) => s.key === 'behavior')!;
    expect(urgency.reason).toContain('returning visitor');
    expect(urgency.reason).toMatch(/returned after .* day/);
    expect(behaviour.reason).toContain('measured on site');
    expect(behaviour.reason).toContain('last left from');
  });

  it('recommendation value rationale states returning behaviour', () => {
    const summary = buildLeadIntelligenceSummary(buildSnapshot([sessionRow()]));
    expect(summary.recommendations.whyValuable.value).toContain('Returning visitor');
    expect(summary.recommendations.whyValuable.explanation.length).toBeGreaterThan(0);
  });
});

describe('WS-2 M1 (4) — propagation into the envelope, without duplication', () => {
  it('the new signals reach the full summary and its diagnostics counts', () => {
    const summary = buildLeadIntelligenceSummary(buildSnapshot([sessionRow()]));
    expect(summary.intent.contributions.some((c) => c.signal === 'visitor_loyalty')).toBe(true);
    expect(summary.qualification.sections).toHaveLength(5);
    expect(summary.timeline.length).toBeGreaterThan(0);
    expect(summary.persona.persona).toBe('CTO'); // unchanged behaviour
  });

  it('behaviour analysis is computed once and shared — no engine recomputes it', () => {
    const snap = buildSnapshot([sessionRow()]);
    const shared = analyzeBehavior(snap, defaultEngineConfig);
    const intentFromShared = computeIntentIntelligence(snap, defaultEngineConfig, shared);
    const intentStandalone = computeIntentIntelligence(snap);
    expect(JSON.stringify(intentFromShared)).toBe(JSON.stringify(intentStandalone));
  });

  it('is fully deterministic — identical input yields byte-identical intelligence', () => {
    const a = buildLeadIntelligenceSummary(buildSnapshot([sessionRow()]));
    const b = buildLeadIntelligenceSummary(buildSnapshot([sessionRow()]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('WS-2 M1 (3) — session persistence hardening', () => {
  const resolve = async () => {
    const { resolveVisitorSession } = await import('../../services/attributionResolverService');
    return resolveVisitorSession({
      companyId: 'co-1',
      websiteId: 'w-1',
      attribution: { anonymous_id: 'anon-1', session_id: 'sess-1' } as never,
    });
  };

  it('returns the inserted id on the happy path and records no failure', async () => {
    const res = await resolve();
    expect(res.sessionId).toBe('vs-new');
    expect(logs.filter((l) => l.event === 'intel_session_persist_failed')).toHaveLength(0);
  });

  it('recovers the concurrently-created row on a unique violation instead of returning null', async () => {
    db.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    db.racedRow = { id: 'vs-raced' };
    const res = await resolve();
    expect(res.sessionId).toBe('vs-raced'); // journey linkage preserved
    expect(counterTotal(INTEL_METRICS.session.persistence)).toBe(1);
    expect(counterTotal(INTEL_METRICS.session.failures)).toBe(0); // a race is not a failure
    // a benign race is not logged as a failure
    expect(logs.filter((l) => l.event === 'intel_session_persist_failed')).toHaveLength(0);
  });

  it('surfaces an unrecoverable conflict instead of failing silently', async () => {
    db.insertError = { code: '23505', message: 'duplicate key' };
    db.racedRow = null;
    const res = await resolve();
    expect(res.sessionId).toBeNull(); // fail-open preserved
    const log = logs.find((l) => l.event === 'intel_session_persist_failed');
    expect(log?.level).toBe('warn');
    expect(log?.payload).toMatchObject({ outcome: 'conflict_unrecovered' });
  });

  it('surfaces a non-conflict insert failure and still never throws into capture', async () => {
    db.insertError = { code: '42501', message: 'permission denied for table visitor_sessions' };
    await expect(resolve()).resolves.toMatchObject({ sessionId: null });
    const log = logs.find((l) => l.event === 'intel_session_persist_failed');
    expect(log?.payload).toMatchObject({ outcome: 'insert_failed' });
    expect(String(log?.payload.detail)).toContain('permission denied');
    expect(String(log?.payload.impact)).toContain('no journey or behaviour signal');
    expect(counterTotal(INTEL_METRICS.session.failures)).toBe(1);
  });

  it('reports an insert that succeeded but returned no id', async () => {
    db.returnInsertedId = false;
    const res = await resolve();
    expect(res.sessionId).toBeNull();
    expect(logs.find((l) => l.event === 'intel_session_persist_failed')?.payload).toMatchObject({
      outcome: 'missing_id',
    });
  });

  it('telemetry failure can never break the capture path', async () => {
    const spy = jest.spyOn(registry, 'incr').mockImplementation(() => {
      throw new Error('registry exploded');
    });
    db.insertError = { code: '42501', message: 'boom' };
    await expect(resolve()).resolves.toMatchObject({ sessionId: null });
    spy.mockRestore();
  });
});

describe('WS-2 M1 — no regression to existing contracts', () => {
  it('CapturedSession additions are additive: pre-existing fields keep their meaning', () => {
    const s: CapturedSession = buildSnapshot([sessionRow()]).sessions[0];
    const preExisting = ['id', 'startedAt', 'lastSeenAt', 'firstLandingPage', 'utmSource', 'utmMedium', 'utmCampaign'];
    for (const k of preExisting) expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(true);
  });

  it('a snapshot with zero sessions still produces complete intelligence', () => {
    const summary = buildLeadIntelligenceSummary(buildSnapshot([]));
    expect(summary.qualification.sections).toHaveLength(5);
    expect(summary.intent.contributions.some((c) => c.signal === 'visitor_loyalty')).toBe(false);
    expect(summary.intent.contributions.some((c) => c.signal === 'return_cadence')).toBe(false);
  });
});
