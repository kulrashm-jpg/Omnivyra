/**
 * WS-2B — Visitor shadow observation.
 *
 * The bundle was computed on every captured event and discarded. These assert that it is now
 * observable, that observation is the ONLY thing added, and that dark still means dark:
 *
 *   ONCE        the understanding is built exactly once per event — observation reads, never rebuilds
 *   OBSERVABLE  parity, projection, confidence and provenance are all inspectable afterwards
 *   DARK        flag off ⇒ nothing computed, nothing observed, ring empty
 *   BOUNDED     the ring cannot grow without limit on a live path
 *   NO STORAGE  no database, queue, API or schema is touched
 *
 * Two layers are exercised: the seam directly (with real bundles), and the capture path end to end
 * (with the engagement writers stubbed so no I/O occurs).
 */

jest.mock('../../services/engagementNormalizationService', () => ({
  resolveSource: jest.fn(async () => 'src-1'),
  resolveThread: jest.fn(async () => 'thr-1'),
  resolveAuthor: jest.fn(async () => 'auth-1'),
  insertMessage: jest.fn(async () => 'msg-1'),
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'update', 'insert', 'contains', 'lte', 'gte']) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.upsert = async () => ({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  },
}));

import {
  computeVisitorUnderstandingShadow,
  observeVisitorShadow,
  recentVisitorShadowObservations,
  latestVisitorShadowObservation,
  __resetVisitorShadowObservationsForTests,
  VISITOR_SHADOW_OBSERVATION_LIMIT,
} from '../../services/visitorIntelligence';
import { ingestExtensionEvent } from '../../services/extensionEventIngestionService';

const ASOF = '2026-08-08T00:00:00.000Z';
const savedEnv = { ...process.env };
const enable = () => { process.env.VISITOR_UNDERSTANDING_ENABLED = 'true'; };

beforeEach(() => { __resetVisitorShadowObservationsForTests(); });
afterEach(() => { __resetVisitorShadowObservationsForTests(); process.env = { ...savedEnv }; });

const shadow = (anonymousId = 'alice') =>
  computeVisitorUnderstandingShadow({ companyId: 'co-1', asOf: ASOF, source: 'linkedin', anonymousId });

const captureEvent = async (username: string, messageId = 'm-1') =>
  ingestExtensionEvent({
    platform: 'linkedin', event_type: 'dm', platform_message_id: messageId, organization_id: 'co-1',
    data: { content: 'hi', created_at: ASOF, author_username: username },
  } as Parameters<typeof ingestExtensionEvent>[0]);

// ── DARK ───────────────────────────────────────────────────────────────────────────────────────────
describe('Visitor shadow observation — dark by default', () => {
  it('flag off: nothing computed and nothing observed', () => {
    delete process.env.VISITOR_UNDERSTANDING_ENABLED;
    expect(shadow()).toBeNull();
    expect(observeVisitorShadow(shadow())).toBeNull();
    expect(recentVisitorShadowObservations()).toEqual([]);
  });

  it('observing a null bundle records nothing and returns null', () => {
    expect(observeVisitorShadow(null)).toBeNull();
    expect(recentVisitorShadowObservations()).toHaveLength(0);
  });

  it('capture path with the flag off leaves the ring empty', async () => {
    delete process.env.VISITOR_UNDERSTANDING_ENABLED;
    await captureEvent('alice');
    expect(recentVisitorShadowObservations()).toEqual([]);
    expect(latestVisitorShadowObservation()).toBeNull();
  });

  it('any value other than exactly "true" stays dark', async () => {
    for (const v of ['TRUE', '1', 'yes', '']) {
      process.env.VISITOR_UNDERSTANDING_ENABLED = v;
      __resetVisitorShadowObservationsForTests();
      await captureEvent('alice');
      expect(recentVisitorShadowObservations()).toEqual([]);
    }
  });
});

// ── OBSERVABLE ─────────────────────────────────────────────────────────────────────────────────────
describe('Visitor shadow observation — the bundle becomes observable', () => {
  it('parity is available, pinned to the bundle that produced it', () => {
    enable();
    const bundle = shadow()!;
    const o = observeVisitorShadow(bundle)!;
    // Pinned to the source value, not merely type/range-checked: a range assertion would accept any
    // number in [0,1] and so would not notice parity being replaced by a constant.
    expect(o.parity).toBe(bundle.comparison.parity);
    expect(o.parity).toBe(1);
  });

  it('the projection is available VERBATIM, not merely counted', () => {
    enable();
    const bundle = shadow()!;
    const o = observeVisitorShadow(bundle)!;
    // Reference identity: the projection is the one that was built, not a reconstruction.
    expect(o.projection).toBe(bundle.projection);
    expect(o.projection.key).toEqual({ companyId: 'co-1', visitorId: 'alice' });
  });

  it('confidence is available', () => {
    enable();
    const bundle = shadow()!;
    const o = observeVisitorShadow(bundle)!;
    expect(o.confidence).toBe(bundle.projection.confidence);
    expect(typeof o.confidence).toBe('number');
  });

  it('provenance is available — distinct evidence systems, sorted', () => {
    enable();
    const o = observeVisitorShadow(shadow())!;
    expect(Array.isArray(o.provenance)).toBe(true);
    expect(o.provenance.length).toBeGreaterThan(0);
    expect([...o.provenance].sort()).toEqual(o.provenance);      // stable ordering
    expect(new Set(o.provenance).size).toBe(o.provenance.length); // deduplicated
  });

  it('the field-level comparison is available, so a divergence can be inspected', () => {
    enable();
    const bundle = shadow()!;
    const o = observeVisitorShadow(bundle)!;
    expect(o.comparison).toBe(bundle.comparison);
    expect(Array.isArray(o.comparison.divergences)).toBe(true);
  });

  it('carries the tenant, the visitor and a clock-free timestamp', () => {
    enable();
    const bundle = shadow()!;
    const o = observeVisitorShadow(bundle)!;
    expect(o.companyId).toBe('co-1');
    expect(o.visitorId).toBe('alice');
    // observedAt is the understanding's own builtAt — no clock is read by the seam.
    expect(o.observedAt).toBe(bundle.understanding.builtAt);
  });
});

// ── ONCE ───────────────────────────────────────────────────────────────────────────────────────────
describe('Visitor shadow observation — computed exactly once', () => {
  it('one captured event yields exactly one observation', async () => {
    enable();
    await captureEvent('alice');
    expect(recentVisitorShadowObservations()).toHaveLength(1);
  });

  it('observation reads the bundle — it never rebuilds the understanding', () => {
    enable();
    const bundle = shadow()!;
    const o = observeVisitorShadow(bundle)!;
    // Both are the SAME objects the single compute produced. A rebuild would be deep-equal but
    // distinct, so reference identity is what rules it out.
    expect(o.projection).toBe(bundle.projection);
    expect(o.comparison).toBe(bundle.comparison);
  });

  it('distinct captured authors produce distinct observations', async () => {
    enable();
    await captureEvent('alice', 'm-1');
    await captureEvent('bob', 'm-2');
    const ids = recentVisitorShadowObservations().map((o) => o.visitorId);
    expect(ids).toEqual(['alice', 'bob']);
  });
});

// ── BOUNDED ────────────────────────────────────────────────────────────────────────────────────────
describe('Visitor shadow observation — bounded', () => {
  it('retains at most the declared limit, dropping oldest first', () => {
    enable();
    for (let i = 0; i < VISITOR_SHADOW_OBSERVATION_LIMIT + 10; i++) {
      observeVisitorShadow(shadow(`visitor-${i}`));
    }
    const kept = recentVisitorShadowObservations();
    // An unbounded diagnostic on a live capture path is a memory leak wearing a useful name.
    expect(kept).toHaveLength(VISITOR_SHADOW_OBSERVATION_LIMIT);
    expect(kept[kept.length - 1].visitorId).toBe(`visitor-${VISITOR_SHADOW_OBSERVATION_LIMIT + 9}`);
    expect(kept[0].visitorId).toBe('visitor-10');
  });

  it('the returned list is a copy — callers cannot mutate the ring', () => {
    enable();
    observeVisitorShadow(shadow());
    const first = recentVisitorShadowObservations() as unknown as unknown[];
    first.length = 0;
    expect(recentVisitorShadowObservations()).toHaveLength(1);
  });

  it('latest returns the most recent', () => {
    enable();
    observeVisitorShadow(shadow('first'));
    observeVisitorShadow(shadow('second'));
    expect(latestVisitorShadowObservation()!.visitorId).toBe('second');
  });
});

// ── NO STORAGE ─────────────────────────────────────────────────────────────────────────────────────
describe('Visitor shadow observation — observation, not storage', () => {
  it('the module exposes no writer, persister, queue or api', async () => {
    const mod = await import('../../services/visitorIntelligence/observation');
    const forbidden = Object.keys(mod).filter((k) => /save|write|persist|upsert|insert|queue|enqueue|api|repository/i.test(k));
    expect(forbidden).toEqual([]);
  });

  it('never throws — a diagnostic must not break the path it observes', () => {
    enable();
    const malformed = { understanding: null, projection: null, comparison: null } as never;
    expect(() => observeVisitorShadow(malformed)).not.toThrow();
    expect(observeVisitorShadow(malformed)).toBeNull();
  });
});
