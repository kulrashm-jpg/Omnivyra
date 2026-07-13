/**
 * CSA-001 — the canonical Customer Usage Signal Platform.
 *
 * Locks the ONE usage platform end-to-end: canonical event model + validation,
 * idempotent/dedup-safe ingestion through the single authority, privacy (no PII,
 * tenant forced from auth), pure daily/weekly/monthly aggregation over the
 * time-series, and fail-safe/backward-compatible behavior. No real DB — the
 * Supabase client is stubbed to mirror ON CONFLICT DO NOTHING semantics.
 */

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import {
  normalizeUsageEvent,
  deriveEventId,
  isUsageEventType,
  USAGE_EVENT_TYPES,
  type UsageEvent,
} from '../../../lib/usage/usageEvent';
import { ingestUsageEvents } from '../../services/usage/usageIngestionService';
import { aggregateUsage, getUsageSummary, type UsageRow } from '../../services/usage/usageAuthorityService';
import { recordRawCounter } from '../../observability/metrics';

const NOW = '2026-07-13T12:00:00.000Z';

/** In-memory customer_usage_events stub honoring UNIQUE (company_id, event_id). */
function makeSupabase(seed: Array<Record<string, unknown>> = []) {
  const store = [...seed];
  const api = {
    from() {
      return {
        // ingestion path: upsert(rows, {ignoreDuplicates}).select('event_id')
        upsert(rows: Array<Record<string, unknown>>) {
          const inserted: Array<Record<string, unknown>> = [];
          for (const r of rows) {
            const dup = store.some((s) => s.company_id === r.company_id && s.event_id === r.event_id);
            if (dup) continue;
            store.push(r);
            inserted.push(r);
          }
          return { select: async () => ({ data: inserted.map((r) => ({ event_id: r.event_id })), error: null }) };
        },
      };
    },
    _store: store,
  };
  return { supabase: api as never, store };
}

const ctx = (over: Record<string, unknown> = {}) => ({ companyId: 'org1', userId: 'u1', now: NOW, ...over });

describe('CSA-001 §1 — canonical event model', () => {
  test('the 14 canonical event types are recognized; unknowns rejected', () => {
    expect(USAGE_EVENT_TYPES).toHaveLength(14);
    expect(isUsageEventType('campaign_created')).toBe(true);
    expect(isUsageEventType('nonsense')).toBe(false);
  });

  test('normalize validates type + company and defaults occurredAt/eventId', () => {
    const r = normalizeUsageEvent({ companyId: 'org1', eventType: 'login' }, NOW);
    expect(r.ok).toBe(true);
    expect(r.event!.occurredAt).toBe(NOW);
    expect(r.event!.eventId).toBeTruthy();

    expect(normalizeUsageEvent({ companyId: '', eventType: 'login' }, NOW).ok).toBe(false);
    expect(normalizeUsageEvent({ companyId: 'org1', eventType: 'bogus' as never }, NOW).ok).toBe(false);
  });

  test('deriveEventId is deterministic for the same logical event', () => {
    const a = deriveEventId({ companyId: 'o', userId: 'u', eventType: 'login', feature: null, occurredAt: NOW });
    const b = deriveEventId({ companyId: 'o', userId: 'u', eventType: 'login', feature: null, occurredAt: NOW });
    expect(a).toBe(b);
  });
});

describe('CSA-001 §5 — privacy', () => {
  test('PII keys are stripped from metadata; only bounded non-PII survives', () => {
    const r = normalizeUsageEvent({
      companyId: 'org1', eventType: 'feature_used',
      metadata: { email: 'a@b.com', name: 'Jo', ip: '1.2.3.4', count: 3, ok: true },
    }, NOW);
    expect(r.event!.metadata).toEqual({ count: 3, ok: true });
  });

  test('ingestion forces the authenticated tenant — a client-supplied companyId cannot spoof', async () => {
    const { supabase, store } = makeSupabase();
    await ingestUsageEvents(
      [{ companyId: 'ATTACKER-ORG', eventType: 'login' } as UsageEvent],
      ctx({ supabase }),
    );
    expect(store).toHaveLength(1);
    expect(store[0].company_id).toBe('org1'); // forced to the authenticated tenant
  });
});

describe('CSA-001 §2/§6 — ingestion, dedup, idempotency', () => {
  test('valid events persist; invalid ones are rejected with reasons', async () => {
    const { supabase } = makeSupabase();
    const r = await ingestUsageEvents([
      { companyId: 'x', eventType: 'login', eventId: 'e1' },
      { companyId: 'x', eventType: 'campaign_created', eventId: 'e2' },
      { companyId: 'x', eventType: 'bogus' as never, eventId: 'e3' },
    ], ctx({ supabase }));
    expect(r.received).toBe(3);
    expect(r.persisted).toBe(2);
    expect(r.rejected).toBe(1);
    expect(r.reasons.invalid_event_type).toBe(1);
  });

  test('in-batch duplicates (same eventId) are counted once', async () => {
    const { supabase, store } = makeSupabase();
    const r = await ingestUsageEvents([
      { companyId: 'x', eventType: 'login', eventId: 'dup' },
      { companyId: 'x', eventType: 'login', eventId: 'dup' },
    ], ctx({ supabase }));
    expect(r.persisted).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(store).toHaveLength(1);
  });

  test('replay of an already-stored event never double-counts', async () => {
    const { supabase, store } = makeSupabase();
    const event: UsageEvent = { companyId: 'x', eventType: 'content_published', eventId: 'once' };
    const first = await ingestUsageEvents([event], ctx({ supabase }));
    const second = await ingestUsageEvents([event], ctx({ supabase }));
    expect(first.persisted).toBe(1);
    expect(second.persisted).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(store).toHaveLength(1); // exactly one row survives the replay
  });

  test('events without an eventId dedupe via the deterministic derived id', async () => {
    const { supabase, store } = makeSupabase();
    const e: UsageEvent = { companyId: 'x', eventType: 'login', occurredAt: NOW };
    await ingestUsageEvents([e], ctx({ supabase }));
    await ingestUsageEvents([e], ctx({ supabase }));
    expect(store).toHaveLength(1);
  });

  test('emits received/persisted observability counters (§7)', async () => {
    const { supabase } = makeSupabase();
    (recordRawCounter as jest.Mock).mockClear();
    await ingestUsageEvents([{ companyId: 'x', eventType: 'login', eventId: 'm1' }], ctx({ supabase }));
    const names = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining(['usage.events.received', 'usage.events.persisted']));
  });
});

describe('CSA-001 §3 — aggregation (daily / weekly / monthly) + time-series', () => {
  const rows: UsageRow[] = [
    { user_id: 'u1', event_type: 'login', feature: null, capability: null, occurred_at: '2026-07-06T09:00:00Z' }, // Mon
    { user_id: 'u2', event_type: 'login', feature: null, capability: null, occurred_at: '2026-07-06T10:00:00Z' },
    { user_id: 'u1', event_type: 'campaign_created', feature: 'planner', capability: 'campaign', occurred_at: '2026-07-08T10:00:00Z' }, // Wed
    { user_id: 'u1', event_type: 'content_published', feature: 'writer', capability: 'publishing', occurred_at: '2026-08-02T10:00:00Z' },
  ];

  test('daily buckets by UTC day with per-bucket active users', () => {
    const s = aggregateUsage(rows, { companyId: 'x', from: 'a', to: 'b', granularity: 'daily' });
    expect(s.totalEvents).toBe(4);
    expect(s.activeUsers).toBe(2);
    const jul6 = s.series.find((b) => b.bucket === '2026-07-06')!;
    expect(jul6.count).toBe(2);
    expect(jul6.activeUsers).toBe(2);
    expect(s.byType).toEqual({ login: 2, campaign_created: 1, content_published: 1 });
    expect(s.byCapability).toEqual({ campaign: 1, publishing: 1 });
  });

  test('weekly buckets collapse to the UTC Monday of each week', () => {
    const s = aggregateUsage(rows, { companyId: 'x', from: 'a', to: 'b', granularity: 'weekly' });
    // Jul 6 (Mon) and Jul 8 (Wed) share the week of 2026-07-06.
    const wk = s.series.find((b) => b.bucket === '2026-07-06')!;
    expect(wk.count).toBe(3);
    expect(s.series.map((b) => b.bucket)).toContain('2026-07-27'); // week containing Aug 2
  });

  test('monthly buckets by YYYY-MM, sorted ascending', () => {
    const s = aggregateUsage(rows, { companyId: 'x', from: 'a', to: 'b', granularity: 'monthly' });
    expect(s.series.map((b) => b.bucket)).toEqual(['2026-07', '2026-08']);
    expect(s.series[0].count).toBe(3);
    expect(s.series[1].count).toBe(1);
  });

  test('aggregation is deterministic (same rows → identical summary)', () => {
    const a = aggregateUsage(rows, { companyId: 'x', from: 'a', to: 'b', granularity: 'daily' });
    const b = aggregateUsage(rows, { companyId: 'x', from: 'a', to: 'b', granularity: 'daily' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('CSA-001 §8 — backward compatibility / fail-safe', () => {
  test('an empty batch is a no-op success (never throws)', async () => {
    const r = await ingestUsageEvents([], ctx());
    expect(r.ok).toBe(true);
    expect(r.persisted).toBe(0);
  });

  test('a DB failure degrades to ok:false without throwing (table not applied yet)', async () => {
    const failing = {
      from() {
        return { upsert() { return { select: async () => ({ data: null, error: { message: 'relation does not exist' } }) }; } };
      },
    } as never;
    const r = await ingestUsageEvents([{ companyId: 'x', eventType: 'login', eventId: 'e' }], ctx({ supabase: failing }));
    expect(r.ok).toBe(false);
    expect(r.persisted).toBe(0);
  });

  test('the usage authority read is fail-safe → empty summary on error', async () => {
    const failing = {
      from() {
        return {
          select() { return { eq() { return { gte() { return { lte() { return { order() { return { limit: async () => ({ data: null, error: { message: 'boom' } }) }; } }; } }; } }; } }; },
        };
      },
    } as never;
    const s = await getUsageSummary('org1', { from: 'a', to: 'b', granularity: 'daily' }, { supabase: failing });
    expect(s.totalEvents).toBe(0);
    expect(s.series).toEqual([]);
  });
});
