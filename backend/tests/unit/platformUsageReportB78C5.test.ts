/**
 * B7.8-C.5 — platform usage reporting read path.
 *
 * The decisive assertions are negative: read-only, one table, no tenant
 * parameter, no `select('*')`, no customer billing table.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

const mockRequireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => mockRequireCapability(...a),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../../db/supabaseClient';
import {
  getPlatformUsageReport,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../services/billing/platformUsageReportService';
import handler from '../../../pages/api/admin/consumption/platform-usage';
import {
  CONSUMPTION_VIEW_AGGREGATE,
  BILLING_AUDIT_VIEW,
  CAPABILITY_HIERARCHY,
} from '../../../shared/contracts/security';
import { capabilitiesForRole } from '../../security/capabilityRegistry';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

/** Every table touched and every query op, so read-only is provable. */
let touched: string[];
let ops: string[];
let rows: Record<string, unknown>[];

const row = (over: Record<string, unknown> = {}) => ({
  id: 'e1', provider_name: 'openai', model_name: 'text-embedding-3-small',
  model_version: null, source_type: 'system', source_name: 'openai',
  process_type: 'embedding_generation', input_tokens: 6, output_tokens: null,
  total_tokens: 6, unit_cost: 0.00002, total_cost: 0.00000012,
  pricing_snapshot: { source: 'model_pricing' },
  resource_type: 'platform_topic_node', resource_id: 't1',
  created_at: '2026-08-13T10:00:00Z', ...over,
});

function install() {
  touched = []; ops = [];
  mockFrom.mockImplementation(((table: string) => {
    touched.push(table);
    const chain: Record<string, unknown> = {};
    chain.select = (cols: string) => { ops.push('select:' + cols); return chain; };
    chain.gte = (c: string, v: string) => { ops.push('gte:' + c + '=' + v); return chain; };
    chain.lte = (c: string, v: string) => { ops.push('lte:' + c + '=' + v); return chain; };
    chain.order = (c: string, o?: { ascending?: boolean }) => { ops.push('order:' + c + ':' + (o?.ascending ? 'asc' : 'desc')); return chain; };
    chain.range = (a: number, b: number) => { ops.push('range:' + a + '-' + b); return Promise.resolve({ data: rows, error: null }); };
    // Mutation verbs deliberately absent — calling one throws, proving read-only.
    for (const v of ['insert', 'update', 'upsert', 'delete']) {
      chain[v] = () => { throw new Error('MUTATION ATTEMPTED: ' + v); };
    }
    return chain as never;
  }) as never);
}

const mkRes = () => {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn(() => res as never);
  res.json = jest.fn(() => res as never);
  res.setHeader = jest.fn(() => res as never);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  rows = [row()];
  install();
  mockRequireCapability.mockResolvedValue({ ok: true, principal: { userId: 'op-1' } });
});

/* ── service: safety ───────────────────────────────────────────────────── */

describe('B7.8-C.5 · service safety', () => {
  it('5/6. uses an explicit column allow-list, never select(*)', async () => {
    await getPlatformUsageReport();
    const sel = ops.find((o) => o.startsWith('select:')) ?? '';
    expect(sel).not.toContain('*');
    expect(sel).toContain('total_cost');
    expect(sel).toContain('provider_name');
  });

  it('7. touches ONLY platform_usage_events — no customer billing table', async () => {
    await getPlatformUsageReport();
    expect(touched).toEqual(['platform_usage_events']);
    for (const t of ['usage_events', 'unified_transactions', 'companies', 'user_company_roles']) {
      expect(touched).not.toContain(t);
    }
  });

  it('8. performs NO mutation — mutation verbs throw if reached', async () => {
    await getPlatformUsageReport();
    expect(ops.some((o) => /insert|update|upsert|delete/.test(o))).toBe(false);
  });

  it('4. requires no tenant parameter, and never filters by one', async () => {
    await getPlatformUsageReport();
    expect(ops.filter((o) => /company|organization|tenant/i.test(o))).toEqual([]);
  });

  it('18/19. never selects credentials, embeddings or the idempotency token', async () => {
    await getPlatformUsageReport();
    const sel = ops.find((o) => o.startsWith('select:')) ?? '';
    for (const forbidden of ['embedding', 'api_key', 'apiKey', 'secret', 'token_secret', 'idempotency_key']) {
      expect(sel).not.toContain(forbidden);
    }
  });
});

/* ── service: aggregation ──────────────────────────────────────────────── */

describe('B7.8-C.5 · aggregation', () => {
  beforeEach(() => {
    rows = [
      row({ id: 'a', total_cost: 0.10, total_tokens: 10 }),
      row({ id: 'b', total_cost: 0.20, total_tokens: 20, model_name: 'text-embedding-3-large' }),
      row({ id: 'c', total_cost: 0.05, total_tokens: 5, resource_type: 'other_resource' }),
    ];
  });

  it('9/12. totals spend, tokens and event count', async () => {
    const out = await getPlatformUsageReport();
    const s = (out as { report: { summary: Record<string, number> } }).report.summary;
    expect(s.totalCostUsd).toBeCloseTo(0.35, 10);
    expect(s.totalTokens).toBe(35);
    expect(s.eventCount).toBe(3);
  });

  it('10. aggregates by provider/model, ordered by spend', async () => {
    const out = await getPlatformUsageReport();
    const g = (out as { report: { summary: { byProviderModel: Array<Record<string, unknown>> } } }).report.summary.byProviderModel;
    expect(g[0].model).toBe('text-embedding-3-large');   // 0.20 is highest
    expect(g[0].totalCostUsd).toBeCloseTo(0.20, 10);
    expect(g).toHaveLength(2);
  });

  it('11. aggregates by resource type', async () => {
    const out = await getPlatformUsageReport();
    const g = (out as { report: { summary: { byResourceType: Array<Record<string, unknown>> } } }).report.summary.byResourceType;
    expect(g.map((e) => e.resourceType).sort()).toEqual(['other_resource', 'platform_topic_node']);
  });

  it('15. an empty result set yields a zeroed summary, not an error', async () => {
    rows = [];
    const out = await getPlatformUsageReport();
    expect((out as { ok: boolean }).ok).toBe(true);
    const r = (out as { report: { items: unknown[]; summary: Record<string, unknown> } }).report;
    expect(r.items).toEqual([]);
    expect(r.summary).toMatchObject({ totalCostUsd: 0, eventCount: 0, totalTokens: 0 });
  });
});

/* ── service: filters ──────────────────────────────────────────────────── */

describe('B7.8-C.5 · filters', () => {
  it('13. applies date-range bounds', async () => {
    await getPlatformUsageReport({ from: '2026-08-01', to: '2026-08-31' });
    expect(ops.some((o) => o.startsWith('gte:created_at='))).toBe(true);
    expect(ops.some((o) => o.startsWith('lte:created_at='))).toBe(true);
  });

  it('16. a malformed date is rejected, not coerced', async () => {
    expect(await getPlatformUsageReport({ from: 'not-a-date' })).toMatchObject({ ok: false, reason: 'invalid_from' });
    expect(await getPlatformUsageReport({ to: 'garbage' })).toMatchObject({ ok: false, reason: 'invalid_to' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('17. a reversed range is rejected before any query', async () => {
    const out = await getPlatformUsageReport({ from: '2026-08-31', to: '2026-08-01' });
    expect(out).toMatchObject({ ok: false, reason: 'reversed_range' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('14. ordering is deterministic with a unique tie-break', async () => {
    await getPlatformUsageReport();
    expect(ops).toContain('order:created_at:desc');
    expect(ops).toContain('order:id:desc');     // created_at is not unique
  });

  it('14. pagination clamps and computes hasMore without a COUNT', async () => {
    rows = Array.from({ length: DEFAULT_PAGE_SIZE + 1 }, (_, i) => row({ id: 'x' + i }));
    const out = await getPlatformUsageReport();
    const r = (out as { report: { items: unknown[]; hasMore: boolean } }).report;
    expect(r.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(r.hasMore).toBe(true);
    expect(ops).toContain('range:0-' + DEFAULT_PAGE_SIZE);
  });

  it('clamps oversized pageSize and floors negative pages', async () => {
    const out = await getPlatformUsageReport({ pageSize: 99999, page: -5 });
    const r = (out as { report: { pageSize: number; page: number } }).report;
    expect(r.pageSize).toBe(MAX_PAGE_SIZE);
    expect(r.page).toBe(0);
  });

  it('a query failure returns a typed reason, never a throw', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(getPlatformUsageReport()).resolves.toMatchObject({ ok: false, reason: 'query_failed' });
  });
});

/* ── route ─────────────────────────────────────────────────────────────── */

describe('B7.8-C.5 · route', () => {
  it('1. an authorized platform operator can read', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].items).toHaveLength(1);
  });

  it('2/3. an unauthorized or company-scoped caller is rejected before DB access', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  it('gates on a GRANTED platform-tier read capability', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(mockRequireCapability.mock.calls[0][2]).toMatchObject({ capability: CONSUMPTION_VIEW_AGGREGATE });
    expect(CONSUMPTION_VIEW_AGGREGATE).toBe('consumption.view.aggregate');
  });

  it('4. no companyId/organizationId is read from the query', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: { companyId: 'c1', organizationId: 'o1' } } as never, res as never);
    expect(ops.filter((o) => /company|organization/i.test(o))).toEqual([]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('labels the summary scope so a page total is not read as all-time spend', async () => {
    rows = Array.from({ length: DEFAULT_PAGE_SIZE + 1 }, (_, i) => row({ id: 'y' + i }));
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(res.json.mock.calls[0][0].summaryScope).toBe('current_page');
  });

  it('maps filter failures to 400', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: { from: 'bad' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects non-GET before the guard', async () => {
    const res = mkRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockRequireCapability).not.toHaveBeenCalled();
  });
});

/* ── B7.8-C.9: date boundaries are strict ISO and always UTC ───────────── */

describe('B7.8-C.9 · date boundary parsing', () => {
  /** The exact `gte:`/`lte:` bounds the service handed to the query. */
  const bounds = () => ({
    gte: (ops.find((o) => o.startsWith('gte:created_at=')) ?? '').replace('gte:created_at=', ''),
    lte: (ops.find((o) => o.startsWith('lte:created_at=')) ?? '').replace('lte:created_at=', ''),
  });

  it('1. a date-only `from` is the START of that UTC day', async () => {
    await getPlatformUsageReport({ from: '2026-08-13' });
    expect(bounds().gte).toBe('2026-08-13T00:00:00.000Z');
  });

  it('2. an explicit `from` datetime is preserved, not re-bounded', async () => {
    await getPlatformUsageReport({ from: '2026-08-13T09:30:00Z' });
    expect(bounds().gte).toBe('2026-08-13T09:30:00.000Z');
  });

  it('5/6. a date-only `to` is the END of that UTC day — the whole day is included', async () => {
    await getPlatformUsageReport({ to: '2026-08-13' });
    expect(bounds().lte).toBe('2026-08-13T23:59:59.999Z');
  });

  it('7. an explicit `to` datetime is NOT silently extended to end-of-day', async () => {
    await getPlatformUsageReport({ to: '2026-08-13T09:30:00Z' });
    expect(bounds().lte).toBe('2026-08-13T09:30:00.000Z');
  });

  it('REGRESSION: to=2026-08-31 no longer truncates the requested day', async () => {
    await getPlatformUsageReport({ to: '2026-08-31' });
    const lte = bounds().lte;
    expect(lte).toBe('2026-08-31T23:59:59.999Z');
    expect(lte).not.toBe('2026-08-31T00:00:00.000Z');   // the old, truncating value
  });

  it('a single-day range covers the complete calendar day', async () => {
    await getPlatformUsageReport({ from: '2026-08-13', to: '2026-08-13' });
    const b = bounds();
    expect(b.gte).toBe('2026-08-13T00:00:00.000Z');
    expect(b.lte).toBe('2026-08-13T23:59:59.999Z');
    // An event at either edge of the day falls inside the closed interval.
    expect('2026-08-13T00:00:00.000Z' >= b.gte).toBe(true);
    expect('2026-08-13T23:59:59.998Z' <= b.lte).toBe(true);
  });

  it('3. a numeric-only boundary is REJECTED, never coerced', async () => {
    for (const bad of ['5', '0', '2026', '1700000000']) {
      jest.clearAllMocks(); install();
      expect(await getPlatformUsageReport({ from: bad })).toMatchObject({ ok: false, reason: 'invalid_from' });
      expect(await getPlatformUsageReport({ to: bad })).toMatchObject({ ok: false, reason: 'invalid_to' });
      expect(mockFrom).not.toHaveBeenCalled();
    }
  });

  it('4/8. ambiguous, locale-shaped or malformed boundaries are rejected', async () => {
    for (const bad of ['08/13/2026', '13-08-2026', 'Aug 13 2026', 'not-a-date', 'yesterday', '2026-8-3', '2026-08-13X10:00']) {
      jest.clearAllMocks(); install();
      expect(await getPlatformUsageReport({ from: bad })).toMatchObject({ ok: false, reason: 'invalid_from' });
      expect(await getPlatformUsageReport({ to: bad })).toMatchObject({ ok: false, reason: 'invalid_to' });
      expect(mockFrom).not.toHaveBeenCalled();
    }
  });

  it('10. leap-day handling: valid in a leap year, rejected otherwise', async () => {
    await getPlatformUsageReport({ from: '2024-02-29' });
    expect(bounds().gte).toBe('2024-02-29T00:00:00.000Z');

    jest.clearAllMocks(); install();
    // 2026 is not a leap year — JS would roll this to Mar 1 rather than fail.
    expect(await getPlatformUsageReport({ from: '2026-02-29' })).toMatchObject({ ok: false, reason: 'invalid_from' });
    expect(await getPlatformUsageReport({ to: '2026-02-30' })).toMatchObject({ ok: false, reason: 'invalid_to' });
  });

  it('11. month-end handling across differing month lengths', async () => {
    for (const [day, end] of [['2026-02-28', '2026-02-28T23:59:59.999Z'], ['2026-04-30', '2026-04-30T23:59:59.999Z'], ['2026-08-31', '2026-08-31T23:59:59.999Z']]) {
      jest.clearAllMocks(); install();
      await getPlatformUsageReport({ to: day });
      expect(bounds().lte).toBe(end);
    }
    jest.clearAllMocks(); install();
    expect(await getPlatformUsageReport({ to: '2026-04-31' })).toMatchObject({ ok: false, reason: 'invalid_to' });
  });

  it('12. year-end handling spans the boundary without truncation', async () => {
    await getPlatformUsageReport({ from: '2026-12-31', to: '2026-12-31' });
    const b = bounds();
    expect(b.gte).toBe('2026-12-31T00:00:00.000Z');
    expect(b.lte).toBe('2026-12-31T23:59:59.999Z');
  });

  it('13. timezone contract: UTC always, and an explicit offset is honoured', async () => {
    // A datetime with no offset is read as UTC, so the report cannot change
    // meaning with the host's timezone.
    await getPlatformUsageReport({ from: '2026-08-13T00:00:00' });
    expect(bounds().gte).toBe('2026-08-13T00:00:00.000Z');

    jest.clearAllMocks(); install();
    // An explicit offset is respected and normalised to UTC: 05:30+05:30 = 00:00Z.
    await getPlatformUsageReport({ from: '2026-08-13T05:30:00+05:30' });
    expect(bounds().gte).toBe('2026-08-13T00:00:00.000Z');
  });

  it('9. from > to is still rejected, including same-day inversions', async () => {
    expect(await getPlatformUsageReport({ from: '2026-08-31', to: '2026-08-01' }))
      .toMatchObject({ ok: false, reason: 'reversed_range' });
    // from's start-of-day vs to's end-of-day means an equal date is NOT reversed.
    const same = await getPlatformUsageReport({ from: '2026-08-13', to: '2026-08-13' });
    expect((same as { ok: boolean }).ok).toBe(true);
  });
});

/* ── F-1: summaryScope must not claim completeness for a trailing page ──── */

describe('B7.8-C.5 · F-1 summaryScope over a real multi-page range', () => {
  /**
   * A range-aware table mock. Unlike the default mock, this HONOURS the
   * range(start, end) arguments the way PostgREST does (inclusive both ends),
   * so page offsets and hasMore are computed from genuine slices rather than a
   * fixed array — which is what makes the 120-row shape below meaningful.
   */
  function installTable(total: number) {
    touched = []; ops = [];
    const table = Array.from({ length: total }, (_, i) => row({ id: 'r' + i, total_cost: 0.10 }));
    mockFrom.mockImplementation(((t: string) => {
      touched.push(t);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.gte = () => chain;
      chain.lte = () => chain;
      chain.order = () => chain;
      chain.range = (a: number, b: number) => {
        ops.push('range:' + a + '-' + b);
        return Promise.resolve({ data: table.slice(a, b + 1), error: null });
      };
      return chain as never;
    }) as never);
  }

  const get = async (query: Record<string, string>) => {
    const res = mkRes();
    await handler({ method: 'GET', query } as never, res as never);
    return res.json.mock.calls[0][0];
  };

  it('1. page 0 + hasMore=false → complete_for_range', async () => {
    installTable(20);                       // fits in one 50-row page
    const body = await get({ pageSize: '50' });
    expect(body.page).toBe(0);
    expect(body.hasMore).toBe(false);
    expect(body.summaryScope).toBe('complete_for_range');
  });

  it('2. page 0 + hasMore=true → current_page', async () => {
    installTable(120);
    const body = await get({ pageSize: '50' });
    expect(body.hasMore).toBe(true);
    expect(body.summaryScope).toBe('current_page');
  });

  it('3. page > 0 + hasMore=false → MUST NOT be complete_for_range', async () => {
    installTable(120);                      // page 2 = rows 100..119 → 20 rows
    const body = await get({ pageSize: '50', page: '2' });
    expect(body.page).toBe(2);
    expect(body.hasMore).toBe(false);       // last page — the F-1 trap
    expect(body.summaryScope).not.toBe('complete_for_range');
    expect(body.summaryScope).toBe('current_page');
  });

  it('4. page > 0 + hasMore=true → MUST NOT be complete_for_range', async () => {
    installTable(120);
    const body = await get({ pageSize: '50', page: '1' });
    expect(body.hasMore).toBe(true);
    expect(body.summaryScope).not.toBe('complete_for_range');
  });

  it('5. the final page of a 120-row / 50-page-size range cannot claim completeness', async () => {
    installTable(120);
    const p0 = await get({ pageSize: '50' });
    const p1 = await get({ pageSize: '50', page: '1' });
    const p2 = await get({ pageSize: '50', page: '2' });

    expect([p0.items.length, p1.items.length, p2.items.length]).toEqual([50, 50, 20]);

    // Exactly one page may be labelled complete — and for this range, none is.
    expect([p0.summaryScope, p1.summaryScope, p2.summaryScope])
      .toEqual(['current_page', 'current_page', 'current_page']);

    // The concrete harm the label prevents: page 2 totals 20 of 120 rows, so
    // reading it as the range total under-reports platform spend ~83%.
    expect(p2.summary.eventCount).toBe(20);
    expect(p2.summary.totalCostUsd).toBeCloseTo(2.0, 10);   // vs 12.0 for the range
  });

  it('page offsets are computed correctly (LIMIT/OFFSET arithmetic)', async () => {
    installTable(120);
    await get({ pageSize: '50', page: '2' });
    expect(ops).toContain('range:100-150');
  });
});

/* ── F-2: the rejected capability is transitively company-reachable ─────── */

describe('B7.8-C.5 · F-2 authorization boundary (evidence, not prose)', () => {
  it('BILLING_AUDIT_VIEW IS reachable by COMPANY_ADMIN — so it is unsafe here', () => {
    // The corrected fact: it names no role directly, but BILLING_MANAGE is its
    // hierarchy parent and COMPANY_ADMIN holds BILLING_MANAGE.
    expect(CAPABILITY_HIERARCHY.some((p) => p.child === BILLING_AUDIT_VIEW)).toBe(true);
    expect(capabilitiesForRole('COMPANY_ADMIN')).toContain(BILLING_AUDIT_VIEW);
  });

  it('CONSUMPTION_VIEW_AGGREGATE is NOT reachable by COMPANY_ADMIN', () => {
    expect(capabilitiesForRole('COMPANY_ADMIN')).not.toContain(CONSUMPTION_VIEW_AGGREGATE);
    // No hierarchy parent — it reaches only roles that name it explicitly.
    expect(CAPABILITY_HIERARCHY.some((p) => p.child === CONSUMPTION_VIEW_AGGREGATE)).toBe(false);
  });

  it('SUPER_ADMIN does hold the capability this route requires', () => {
    expect(capabilitiesForRole('SUPER_ADMIN')).toContain(CONSUMPTION_VIEW_AGGREGATE);
  });

  it('the route gates on the platform-tier capability, never the billing one', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    const opts = mockRequireCapability.mock.calls[0][2];
    expect(opts.capability).toBe(CONSUMPTION_VIEW_AGGREGATE);
    expect(opts.capability).not.toBe(BILLING_AUDIT_VIEW);
  });

  it('a company-scoped admin is rejected, and reaches no database', async () => {
    // COMPANY_ADMIN lacks CONSUMPTION_VIEW_AGGREGATE (proved above), so
    // requireCapability denies and writes the response itself.
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler({ method: 'GET', query: { companyId: 'c1' } } as never, res as never);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();      // the guard owns the response
    expect(res.status).not.toHaveBeenCalledWith(200);
  });
});

/* ── structural proof ──────────────────────────────────────────────────── */

describe('B7.8-C.5 · route is transport-only (source proof)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../pages/api/admin/consumption/platform-usage.ts'), 'utf8',
  );
  const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*')).join('\n');

  it('has no database client and names no table', () => {
    expect(code).not.toMatch(/supabaseClient|ownedDbTable/);
    for (const t of ['platform_usage_events', 'usage_events', 'unified_transactions']) {
      expect(code).not.toContain(t);
    }
  });

  it('20. never reaches a provider or the customer ledger', () => {
    expect(code).not.toMatch(/openai|signalEmbeddingService|usageLedgerService|logUsageEvent/i);
  });
});
