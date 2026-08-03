/**
 * @jest-environment jsdom
 *
 * INT-001 Phase 1 — visitor journey & attribution intelligence.
 *
 * Verifies the Phase 1 extensions AND re-asserts the Phase 0 baseline where
 * Phase 1 touches it: visitor-session creation stats, returning-visitor /
 * multi-session behaviour, session continuation (metadata MERGE, duration),
 * client journey persistence (append-only, bounded, ordered), click-id
 * first-touch capture, touchpoint timeline metadata, the lead's
 * attribution_intelligence extension, duplicate protection ordering, tenant
 * isolation of the history read, and the unchanged session-starvation path.
 */

type RecordedOp = {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: Array<[string, ...unknown[]]>;
};

const ops: RecordedOp[] = [];
const responseQueues: Record<string, Array<{ data: unknown; error: unknown }>> = {};

function queueResponse(key: string, value: { data: unknown; error: unknown }) {
  (responseQueues[key] = responseQueues[key] ?? []).push(value);
}
function nextResponse(table: string, op: string) {
  const q = responseQueues[`${table}:${op}`];
  return (q && q.length > 0 ? q.shift() : undefined) ?? { data: null, error: null };
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec: RecordedOp = { table, op: 'select', payload: undefined, filters: [] };
    ops.push(rec);
    let resolved: { data: unknown; error: unknown } | null = null;
    const resolve = () => (resolved = resolved ?? nextResponse(table, rec.op));
    const chain: any = {
      select: jest.fn(() => chain),
      insert: jest.fn((p: Record<string, unknown>) => { rec.op = 'insert'; rec.payload = p; return chain; }),
      update: jest.fn((p: Record<string, unknown>) => { rec.op = 'update'; rec.payload = p; return chain; }),
      eq: jest.fn((k: string, v: unknown) => { rec.filters.push(['eq', k, v]); return chain; }),
      is: jest.fn((k: string, v: unknown) => { rec.filters.push(['is', k, v]); return chain; }),
      gte: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      maybeSingle: jest.fn(async () => {
        const r = resolve();
        return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
      }),
      single: jest.fn(async () => {
        const r = resolve();
        return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
      }),
      then: (res: any, rej?: any) => {
        const r = resolve();
        const arr = Array.isArray(r.data) ? r.data : r.data != null ? [r.data] : [];
        return Promise.resolve({ ...r, data: arr }).then(res, rej);
      },
    };
    return chain;
  },
}));

const createLead = jest.fn();
jest.mock('../../services/leadService', () => ({ createLead: (...a: unknown[]) => createLead(...a) }));

import {
  resolveVisitorSession,
  stitchSessionToLead,
  persistCampaignTouchpoint,
} from '../../services/attributionResolverService';
import { captureWebsiteLead } from '../../services/leadCaptureService';
import {
  ensureVisitorIds,
  captureClickIds,
  recordJourneyPage,
  recordJourneyEvent,
  getJourneySummary,
} from '../../../lib/website/journeyIntelligence';
import { captureAttribution } from '../../../lib/website/attributionCapture';

const opsFor = (table: string, op?: RecordedOp['op']) =>
  ops.filter((o) => o.table === table && (!op || o.op === op));

const ATTR = {
  anonymous_id: 'anon-x',
  session_id: 'sess-x',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'spring',
  referrer: 'https://g.com',
  landing_page: '/landing',
  current_page: '/contact',
  consent_state: 'granted',
} as const;

function setUrl(url: string) {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  jest.clearAllMocks();
  ops.length = 0;
  for (const k of Object.keys(responseQueues)) delete responseQueues[k];
  localStorage.clear();
  sessionStorage.clear();
  setUrl('/');
});

// ── Layer 1: visitor session intelligence (server) ──────────────────────────

describe('INT-001 P1 — visitor session intelligence', () => {
  test('first-ever session: metadata.visitor carries visit_count 1, returning false, first_visit_at = now', async () => {
    queueResponse('visitor_sessions:select', { data: null, error: null }); // session lookup
    queueResponse('visitor_sessions:select', { data: [], error: null });   // visitor history
    queueResponse('visitor_sessions:insert', { data: { id: 'vs-1' }, error: null });
    const result = await resolveVisitorSession({ companyId: 'co-1', websiteId: 'w-1', attribution: { ...ATTR, metadata: { k: 'v' } } });
    expect(result.sessionId).toBe('vs-1');
    const [ins] = opsFor('visitor_sessions', 'insert');
    expect(ins.payload!.metadata).toMatchObject({
      k: 'v', // pre-Phase-1 metadata passthrough preserved
      visitor: {
        visit_count: 1,
        returning_visitor: false,
        first_visit_at: expect.any(String),
        latest_visit_at: expect.any(String),
      },
    });
  });

  test('multi-session visitor: history rows → visit_count N+1, returning true, first_visit_at = earliest prior session', async () => {
    queueResponse('visitor_sessions:select', { data: null, error: null });
    queueResponse('visitor_sessions:select', {
      data: [{ created_at: '2026-06-01T00:00:00Z' }, { created_at: '2026-07-01T00:00:00Z' }],
      error: null,
    });
    queueResponse('visitor_sessions:insert', { data: { id: 'vs-3' }, error: null });
    await resolveVisitorSession({ companyId: 'co-1', attribution: { ...ATTR, session_id: 'sess-3' } });
    const [ins] = opsFor('visitor_sessions', 'insert');
    expect(ins.payload!.metadata).toMatchObject({
      visitor: { visit_count: 3, returning_visitor: true, first_visit_at: '2026-06-01T00:00:00Z' },
    });
  });

  test('tenant isolation: the visitor-history read filters by company_id AND anonymous_id', async () => {
    queueResponse('visitor_sessions:select', { data: null, error: null });
    queueResponse('visitor_sessions:select', { data: [], error: null });
    queueResponse('visitor_sessions:insert', { data: { id: 'vs-1' }, error: null });
    await resolveVisitorSession({ companyId: 'co-A', attribution: { ...ATTR } });
    const selects = opsFor('visitor_sessions', 'select');
    const history = selects[1]; // lookup first, history second
    expect(history.filters).toEqual([
      ['eq', 'company_id', 'co-A'],
      ['eq', 'anonymous_id', 'anon-x'],
    ]);
  });

  test('history-read failure is fail-safe: the session insert proceeds without the visitor block', async () => {
    queueResponse('visitor_sessions:select', { data: null, error: null });
    // history read: make the thenable reject by throwing from order()? simplest:
    // simulate infra error by queuing a response whose data access throws is not
    // possible with this recorder — instead reject inside then via error object
    // is swallowed by the service's try/catch around the WHOLE read. We emulate
    // the catch path by making Array.isArray see a poisoned proxy:
    const poison = new Proxy({}, { get() { throw new Error('infra down'); } });
    queueResponse('visitor_sessions:select', { data: poison as unknown, error: null });
    queueResponse('visitor_sessions:insert', { data: { id: 'vs-9' }, error: null });
    const result = await resolveVisitorSession({ companyId: 'co-1', attribution: { ...ATTR, metadata: { k: 'v' } } });
    expect(result.sessionId).toBe('vs-9');
    const [ins] = opsFor('visitor_sessions', 'insert');
    expect((ins.payload!.metadata as Record<string, unknown>).visitor).toBeUndefined();
    expect(ins.payload!.metadata).toMatchObject({ k: 'v' });
  });

  test('session continuation: update MERGES stored metadata (never replaces), preserves visitor keys and computes session_duration_ms', async () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    queueResponse('visitor_sessions:select', {
      data: {
        id: 'vs-old', created_at: startedAt, first_touch: { utm_source: 'first' },
        metadata: { k: 'v', visitor: { visit_count: 2, returning_visitor: true, first_visit_at: '2026-01-01T00:00:00Z' } },
      },
      error: null,
    });
    await resolveVisitorSession({ companyId: 'co-1', attribution: { ...ATTR, metadata: { extra: 'client' } } });
    const [upd] = opsFor('visitor_sessions', 'update');
    const metadata = upd.payload!.metadata as Record<string, any>;
    expect(metadata.k).toBe('v');            // stored metadata preserved
    expect(metadata.extra).toBe('client');   // fresh client metadata merged in
    expect(metadata.visitor).toMatchObject({
      visit_count: 2, returning_visitor: true, first_visit_at: '2026-01-01T00:00:00Z', // preserved
      latest_visit_at: expect.any(String),
    });
    expect(metadata.visitor.session_duration_ms).toBeGreaterThanOrEqual(90_000);
  });

  test('PHASE 0 REGRESSION — session starvation unchanged: no ids → null session, ZERO DB operations', async () => {
    const result = await resolveVisitorSession({
      companyId: 'co-1',
      attribution: { ...ATTR, anonymous_id: null, session_id: null },
    });
    expect(result.sessionId).toBeNull();
    expect(ops.length).toBe(0);
  });

  test('PHASE 0 REGRESSION — stitch payloads unchanged (touchpoint adoption stays exactly {lead_id})', async () => {
    await stitchSessionToLead({ leadId: 'L1', companyId: 'co-1', visitorSessionId: 'vs-1', unifiedPersonId: 'up-1' });
    const [tp] = opsFor('campaign_touchpoints', 'update');
    expect(tp.payload).toEqual({ lead_id: 'L1' });
  });
});

// ── Layer 4: touchpoint timeline ─────────────────────────────────────────────

describe('INT-001 P1 — touchpoint timeline', () => {
  test('touchpoints carry captured_at + the journey snapshot; sequential inserts stay deterministically ordered', async () => {
    const journey = { pages: [{ p: '/a', t: 'T1' }], sequence: 1 };
    await persistCampaignTouchpoint({
      companyId: 'co-1', attribution: { ...ATTR, metadata: { journey } }, touchpointType: 'first_touch',
    });
    await persistCampaignTouchpoint({
      companyId: 'co-1', attribution: { ...ATTR }, touchpointType: 'conversion',
    });
    const inserts = opsFor('campaign_touchpoints', 'insert');
    expect(inserts).toHaveLength(2);
    const m1 = inserts[0].payload!.metadata as Record<string, any>;
    const m2 = inserts[1].payload!.metadata as Record<string, any>;
    expect(m1.attribution).toMatchObject({ utm_source: 'google' }); // Phase 0 snapshot untouched
    expect(m1.journey).toEqual(journey);
    expect(m2.journey).toBeUndefined(); // no journey sent → key absent
    expect(typeof m1.captured_at).toBe('string');
    expect(m1.captured_at <= m2.captured_at).toBe(true); // deterministic ordering
    expect(inserts[0].payload).toMatchObject({ touchpoint_type: 'first_touch' });
    expect(inserts[1].payload).toMatchObject({ touchpoint_type: 'conversion' });
  });
});

// ── Layer 5: attribution extension on the lead ───────────────────────────────

describe('INT-001 P1 — lead attribution intelligence', () => {
  const submission = () => ({
    intent: 'contact_sales',
    firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.com', consent: true,
    rawBody: {
      utm_source: 'google', utm_campaign: 'spring', campaign_id: 'cmp-1', cta_id: 'hero',
      session_id: 'sess-x', anonymous_id: 'anon-x', current_page: '/contact-sales',
      attribution: {
        metadata: {
          journey: {
            entered_at: 'T0',
            pages: [{ p: '/a', t: 'T1' }, { p: '/b', t: 'T2' }],
            events: [{ e: 'cta_click', t: 'T1b' }],
            exit_page: '/b', sequence: 2, click_ids: { gclid: 'g-123' },
          },
        },
      },
    },
  });

  function arm(noDupe = true) {
    queueResponse('leads:select', { data: noDupe ? [] : [{ id: 'L-old', created_at: new Date().toISOString() }], error: null });
    queueResponse('visitor_sessions:select', { data: null, error: null }); // lookup
    queueResponse('visitor_sessions:select', { data: [], error: null });   // history
    queueResponse('visitor_sessions:insert', { data: { id: 'vs-1' }, error: null });
    createLead.mockResolvedValue({ id: 'L-new', source: 'website', unified_person_id: 'up-1' });
  }

  test('lead metadata gains journey + attribution_intelligence with a deterministic linear touch list and latest campaign snapshot', async () => {
    arm();
    const result = await captureWebsiteLead(submission() as any, { companyId: 'co-1' });
    expect(result.status).toBe('created');
    const [, input] = createLead.mock.calls[0] as [string, Record<string, any>];
    // journey persisted verbatim (Layer 2/3 payload)
    expect(input.metadata.journey).toMatchObject({ exit_page: '/b', sequence: 2 });
    expect(input.metadata.journey.events).toEqual([{ e: 'cta_click', t: 'T1b' }]);
    // Layer 5 block
    const intel = input.metadata.attribution_intelligence;
    expect(intel.first_touch).toBeDefined();
    expect(intel.last_touch).toBeDefined();
    expect(intel.touch_list.map((t: any) => t.type)).toEqual(['first_touch', 'page_view', 'page_view', 'conversion']);
    expect(intel.touch_list[1]).toMatchObject({ page: '/a', at: 'T1' });
    expect(intel.touch_list[3]).toMatchObject({ page: '/contact-sales' });
    expect(intel.latest_campaign).toEqual({
      utm_source: 'google', utm_medium: null, utm_campaign: 'spring', utm_content: null, utm_term: null,
      campaign_id: 'cmp-1', content_id: null, cta_id: 'hero',
    });
    expect(intel.click_ids).toEqual({ gclid: 'g-123' });
    // Phase 0 keys unchanged alongside
    expect(input.metadata).toMatchObject({ lead_capture: true, intent: 'contact_sales' });
    expect(input.metadata.web_attribution).toMatchObject({ utm_source: 'google', campaign_id: 'cmp-1', cta_id: 'hero' });
  });

  test('PHASE 0 REGRESSION — duplicate protection still short-circuits BEFORE any session/intelligence work', async () => {
    arm(false);
    const result = await captureWebsiteLead(submission() as any, { companyId: 'co-1' });
    expect(result).toMatchObject({ status: 'duplicate', leadId: 'L-old' });
    expect(createLead).not.toHaveBeenCalled();
    expect(opsFor('visitor_sessions').length).toBe(0); // no session ops at all
  });
});

// ── Layers 1–3 client side: ids, journey, click ids ──────────────────────────

describe('INT-001 P1 — client journey intelligence', () => {
  test('ensureVisitorIds mints durable anonymous + per-tab session ids, stable across calls, tracker value respected', () => {
    const first = ensureVisitorIds();
    expect(first.anonymousId).toMatch(/^anon-/);
    expect(first.sessionId).toMatch(/^sess-/);
    expect(ensureVisitorIds()).toEqual(first); // stable
    expect(sessionStorage.getItem('omn_session')).toBe(first.sessionId);
    // a pre-existing tracker session is never overwritten
    sessionStorage.setItem('omn_session', 'tracker-sess');
    expect(ensureVisitorIds().sessionId).toBe('tracker-sess');
  });

  test('consent denied: no ids minted, journey stays empty, captureAttribution keeps the pre-Phase-1 empty session fields', () => {
    localStorage.setItem('omnivyra_analytics_consent', 'denied');
    expect(ensureVisitorIds()).toEqual({ anonymousId: '', sessionId: '' });
    recordJourneyPage('/x');
    expect(getJourneySummary()).toMatchObject({ pages: [], sequence: 0, exit_page: null });
    const a = captureAttribution() as Record<string, any>;
    expect(a.session_id).toBe('');
    expect(a.anonymous_id).toBe('');
  });

  test('journey pages: ordered, consecutive-duplicate-free, bounded at 50, exit_page = last page', () => {
    recordJourneyPage('/a');
    recordJourneyPage('/a'); // consecutive dup skipped
    recordJourneyPage('/b');
    let summary = getJourneySummary();
    expect(summary.pages.map((p) => p.p)).toEqual(['/a', '/b']);
    expect(summary.sequence).toBe(2);
    expect(summary.exit_page).toBe('/b');
    for (let i = 0; i < 60; i += 1) recordJourneyPage(`/page-${i}`);
    summary = getJourneySummary();
    expect(summary.pages).toHaveLength(50); // bounded
    expect(summary.pages[49].p).toBe('/page-59'); // newest kept
  });

  test('journey events: append-only ordering preserved, bounded at 100', () => {
    recordJourneyEvent('form_start', { intent: 'contact_sales' });
    recordJourneyEvent('cta_click', { label: 'Hero' });
    let summary = getJourneySummary();
    expect(summary.events.map((e) => e.e)).toEqual(['form_start', 'cta_click']);
    for (let i = 0; i < 120; i += 1) recordJourneyEvent('engagement');
    summary = getJourneySummary();
    expect(summary.events).toHaveLength(100);
    expect(summary.events[99].e).toBe('engagement');
  });

  test('click ids: captured from the URL first-touch style (later values never overwrite)', () => {
    setUrl('/?gclid=first-click&fbclid=fb-1');
    expect(captureClickIds()).toEqual({ gclid: 'first-click', fbclid: 'fb-1' });
    setUrl('/?gclid=second-click');
    expect(captureClickIds()).toEqual({ gclid: 'first-click', fbclid: 'fb-1' });
  });

  test('captureAttribution: self-minted ids + nested attribution.metadata.journey; tracker session keeps the legacy aliasing', () => {
    recordJourneyPage('/a');
    setUrl('/request-demo?utm_source=google&gclid=g-9');
    const a = captureAttribution() as Record<string, any>;
    expect(String(a.session_id)).toMatch(/^sess-/);
    expect(String(a.anonymous_id)).toMatch(/^anon-/);
    expect(a.attribution.metadata.journey).toMatchObject({
      sequence: 1, exit_page: '/a', click_ids: { gclid: 'g-9' },
    });
    // legacy tracker aliasing preserved (Phase 0 pin): session value used for BOTH ids
    sessionStorage.setItem('omn_session', 'tracker-sess');
    const b = captureAttribution() as Record<string, any>;
    expect(b.session_id).toBe('tracker-sess');
    expect(b.anonymous_id).toBe('tracker-sess');
  });
});
