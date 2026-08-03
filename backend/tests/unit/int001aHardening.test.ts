/**
 * INT-001A — post-audit hardening characterization.
 *
 * Pins the three implemented findings:
 *  F3 — deterministic snapshot ordering (explicit per-table order columns,
 *       id tiebreak, fingerprint behaviour unchanged),
 *  F4 — canonical recommendation keys owned by the engine (no read-layer
 *       duplication),
 *  F5 — defensive tenant validation in the read mapper (mismatch fails open
 *       as never_generated; never throws; never exposes foreign data).
 * Everything stays dormant — ports injected, DB mocked, no runtime wiring.
 */

type RecordedQuery = {
  table: string;
  filters: Array<[string, unknown]>;
  orders: Array<[string, boolean]>;
  limit: number | null;
};

const queries: RecordedQuery[] = [];
const tableResponses: Record<string, Array<{ data: unknown; error: unknown }>> = {};

function respond(table: string) {
  const q = tableResponses[table];
  return (q && q.length > 0 ? q.shift() : undefined) ?? { data: [], error: null };
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec: RecordedQuery = { table, filters: [], orders: [], limit: null };
    queries.push(rec);
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn((k: string, v: unknown) => { rec.filters.push([k, v]); return chain; }),
      order: jest.fn((col: string, opts?: { ascending?: boolean }) => {
        rec.orders.push([col, opts?.ascending !== false]);
        return chain;
      }),
      limit: jest.fn((n: number) => { rec.limit = n; return chain; }),
      upsert: jest.fn(() => chain),
      update: jest.fn(() => chain),
      maybeSingle: jest.fn(async () => respond(table)),
      single: jest.fn(async () => respond(table)),
      then: (res: any, rej?: any) => Promise.resolve(respond(table)).then(res, rej),
    };
    return chain;
  },
}));

import { durableSnapshotSource } from '../../services/leadIntelligenceOrchestration/snapshotSource';
import { computeInputFingerprint } from '../../services/leadIntelligenceOrchestration/fingerprint';
import { ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION } from '../../services/leadIntelligenceOrchestration/engineVersion';
import type { LeadIntelligenceRecord } from '../../services/leadIntelligenceOrchestration/types';
import { LEAD_RECOMMENDATION_KEYS } from '../../services/leadIntelligenceEngine/types';
import type { LeadRecommendations, LeadCaptureSnapshot } from '../../services/leadIntelligenceEngine/types';
import { toLeadIntelligenceView } from '../../services/leadIntelligenceReadApi/mapper';
import { createLeadIntelligenceReadApi } from '../../services/leadIntelligenceReadApi';

const NOW = '2026-08-03T12:00:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  queries.length = 0;
  for (const k of Object.keys(tableResponses)) delete tableResponses[k];
});

// ── Finding 3 — deterministic snapshot ordering ─────────────────────────────

describe('INT-001A F3 — snapshot ordering', () => {
  test('every collection query orders by its own timestamp column ascending with an id tiebreak', async () => {
    tableResponses.leads = [{ data: [{ id: 'L1', company_id: 'co-1', visitor_session_id: 'vs-1', unified_person_id: 'up-1' }], error: null }];
    tableResponses.campaign_touchpoints = [
      { data: [], error: null }, // lead_id query → empty → fallback by session
      { data: [], error: null },
    ];
    const rows = await durableSnapshotSource.load('co-1', 'L1');
    expect(rows).not.toBeNull();

    const byTable = (t: string) => queries.filter((q) => q.table === t);
    const events = byTable('tracking_events');
    expect(events).toHaveLength(1);
    expect(events[0].orders).toEqual([['created_at', true], ['id', true]]);

    const touchpoints = byTable('campaign_touchpoints');
    expect(touchpoints).toHaveLength(2); // primary + session fallback — BOTH ordered
    for (const q of touchpoints) expect(q.orders).toEqual([['touched_at', true], ['id', true]]);

    const sessions = byTable('visitor_sessions');
    expect(sessions).toHaveLength(1);
    // visitor_sessions has NO created_at column (DDL 20260677:252-275 declares
    // started_at / last_seen_at only). Ordering by a missing column makes
    // PostgREST reject the query and readRows fail open to [], which silently
    // emptied sessions on every generation. Pinned to the real column.
    expect(sessions[0].orders).toEqual([['started_at', true], ['id', true]]);

    // tenant scoping intact on every ordered query
    for (const q of [...events, ...touchpoints, ...sessions]) {
      expect(q.filters).toEqual(expect.arrayContaining([['company_id', 'co-1']]));
      expect(q.limit).not.toBeNull();
    }
  });

  test('every ORDER BY column the loader uses actually exists in that table DDL (PROD-VAL-1 guard)', async () => {
    // A column that does not exist makes PostgREST reject the query and
    // readRows fail open to [] — silently emptying the collection with no
    // error surfaced anywhere. This pins the order columns to the real schema.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const ddl = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260677_website_intelligence_foundation_phase1.sql'),
      'utf8',
    );
    const columnsOf = (table: string): string[] => {
      const m = ddl.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
      if (!m) throw new Error(`DDL for ${table} not found`);
      return m[1]
        .split('\n')
        .map((l) => l.trim().split(/\s+/)[0].replace(/[^a-z_]/gi, ''))
        .filter(Boolean);
    };

    tableResponses.leads = [{ data: [{ id: 'L1', company_id: 'co-1', visitor_session_id: 'vs-1', unified_person_id: 'up-1' }], error: null }];
    tableResponses.campaign_touchpoints = [{ data: [], error: null }, { data: [], error: null }];
    await durableSnapshotSource.load('co-1', 'L1');

    const checked: string[] = [];
    for (const table of ['tracking_events', 'visitor_sessions', 'campaign_touchpoints']) {
      const cols = columnsOf(table);
      for (const q of queries.filter((x) => x.table === table)) {
        for (const [orderCol] of q.orders) {
          expect(`${table}.${orderCol}`).toBe(cols.includes(orderCol) ? `${table}.${orderCol}` : `${table}.<MISSING COLUMN ${orderCol}>`);
          checked.push(`${table}.${orderCol}`);
        }
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(6); // 3 tables × (timestamp + id)
    expect(checked).toContain('visitor_sessions.started_at');
    expect(checked).not.toContain('visitor_sessions.created_at');
  });

  test('fingerprint behaviour unchanged: input row order never affects the fingerprint (canonicalized internally)', () => {
    const events = [
      { id: 'e1', eventName: 'page_view', pageUrl: '/a', sessionId: 's1', occurredAt: '2026-08-03T10:00:00.000Z', metadata: {} },
      { id: 'e2', eventName: 'cta_click', pageUrl: '/b', sessionId: 's1', occurredAt: '2026-08-03T10:00:00.000Z', metadata: {} }, // same timestamp
      { id: 'e3', eventName: 'page_view', pageUrl: '/c', sessionId: 's1', occurredAt: '2026-08-03T11:00:00.000Z', metadata: {} },
    ];
    const sessions = [
      { id: 's1', startedAt: NOW, lastSeenAt: NOW, firstLandingPage: '/a', utmSource: null, utmMedium: null, utmCampaign: null },
      { id: 's2', startedAt: NOW, lastSeenAt: NOW, firstLandingPage: '/b', utmSource: null, utmMedium: null, utmCampaign: null },
    ];
    const base: LeadCaptureSnapshot = {
      lead: { id: 'L1', email: 'a@b.co', name: 'A', jobTitle: null, companyName: null, companySize: null, industry: null, country: null, primaryInterest: null, message: null, source: 'website', createdAt: NOW },
      events, sessions, touchpoints: [], now: NOW,
    };
    const shuffled: LeadCaptureSnapshot = {
      ...base,
      events: [events[2], events[0], events[1]],
      sessions: [sessions[1], sessions[0]],
    };
    expect(computeInputFingerprint(shuffled)).toBe(computeInputFingerprint(base));
    expect(computeInputFingerprint(base)).toBe(computeInputFingerprint(base)); // stable across calls
  });
});

// ── Finding 4 — canonical recommendation keys ───────────────────────────────

const fullRecommendations = (): LeadRecommendations => ({
  whyValuable: { value: 'High-fit lead', confidence: 0.8, explanation: 'x' },
  likelyProductInterest: { value: 'Lead intelligence', confidence: 0.7, explanation: 'x' },
  likelyObjections: { value: ['price'], confidence: 0.6, explanation: 'x' },
  recommendedContent: { value: ['case study'], confidence: 0.6, explanation: 'x' },
  recommendedOwner: { value: 'SDR', confidence: 0.5, explanation: 'x' },
  bestChannel: { value: 'email', confidence: 0.9, explanation: 'x' },
  bestContactTime: { value: 'morning', confidence: 0.4, explanation: 'x' },
  meetingProbability: { value: 0.55, confidence: 0.5, explanation: 'x' },
  closeProbability: { value: 0.25, confidence: 0.5, explanation: 'x' },
  nextBestAction: { value: 'Schedule follow-up', confidence: 0.85, explanation: 'x' },
});

const recordFor = (companyId: string, leadId: string): LeadIntelligenceRecord => ({
  companyId,
  leadId,
  engineVersion: ENGINE_VERSION,
  schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
  generationVersion: 3,
  inputFingerprint: 'f'.repeat(16),
  generatedAt: NOW,
  rebuildRequestedAt: null,
  intelligence: { confidence: 0.8, recommendations: fullRecommendations() },
} as unknown as LeadIntelligenceRecord);

describe('INT-001A F4 — canonical recommendation keys', () => {
  test('the engine constant is exhaustive against LeadRecommendations (10 unique keys, runtime-verified)', () => {
    const canonical = LEAD_RECOMMENDATION_KEYS.map((k) => k.key);
    expect(canonical).toHaveLength(10);
    expect(new Set(canonical).size).toBe(10);
    const interfaceKeys = Object.keys(fullRecommendations());
    expect([...canonical].sort()).toEqual([...interfaceKeys].sort());
    for (const { label } of LEAD_RECOMMENDATION_KEYS) expect(label.length).toBeGreaterThan(0);
  });

  test('the read mapper emits recommendations in canonical order with canonical labels (no local duplication)', () => {
    const view = toLeadIntelligenceView(recordFor('co-1', 'L1'), { companyId: 'co-1', leadId: 'L1' });
    expect(view.status).toBe('available');
    expect(view.recommendations.map((r) => r.key)).toEqual(LEAD_RECOMMENDATION_KEYS.map((k) => k.key));
    expect(view.recommendations.map((r) => r.label)).toEqual(LEAD_RECOMMENDATION_KEYS.map((k) => k.label));
  });
});

// ── Finding 5 — defensive tenant validation ─────────────────────────────────

describe('INT-001A F5 — tenant mismatch protection', () => {
  test('a foreign-tenant record fails open as never_generated: no throw, no foreign data, requested ids echoed', () => {
    const foreign = recordFor('co-OTHER', 'L1');
    let view: ReturnType<typeof toLeadIntelligenceView>;
    expect(() => { view = toLeadIntelligenceView(foreign, { companyId: 'co-1', leadId: 'L1' }); }).not.toThrow();
    expect(view!).toMatchObject({
      companyId: 'co-1', // the REQUESTED tenant, never the record's
      leadId: 'L1',
      status: 'never_generated',
      freshness: 'never_generated',
      version: null,
      overallConfidence: null,
      intent: null,
      persona: null,
      qualification: null,
    });
    expect(view!.recommendations).toEqual([]);
    expect(JSON.stringify(view!)).not.toContain('co-OTHER'); // zero foreign leakage
  });

  test('control: a matching-tenant record still maps to a full available view', () => {
    const view = toLeadIntelligenceView(recordFor('co-1', 'L1'), { companyId: 'co-1', leadId: 'L1' });
    expect(view.status).toBe('available');
    expect(view.companyId).toBe('co-1');
    expect(view.version).not.toBeNull();
    expect(view.recommendations).toHaveLength(10);
  });

  test('end-to-end through the read API: an injected port returning a foreign record yields never_generated', async () => {
    const get = jest.fn(async () => recordFor('co-OTHER', 'L1'));
    const api = createLeadIntelligenceReadApi({ persistence: { get } as any });
    const view = await api.getLeadIntelligenceView('co-1', 'L1');
    expect(get).toHaveBeenCalledWith('co-1', 'L1');
    expect(view.status).toBe('never_generated');
    expect(view.companyId).toBe('co-1');
    expect(JSON.stringify(view)).not.toContain('co-OTHER');
  });
});
