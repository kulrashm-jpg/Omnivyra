/**
 * Provider reconcilers read PLATFORM spend (platform_usage_events) as well as customer spend (usage_events).
 *
 * A provider invoice covers every call made with our provider account, platform calls included. Before this
 * change the reconcilers read usage_events only, so the platform share of a (day, model) bucket was spread
 * PRO-RATA ONTO THE CUSTOMERS of that bucket as variance (written to cost_reconciliation_adjustments with their
 * organization_id). Now platform spend is its own aggregate with organization_id null.
 *
 * The fake supabase APPLIES eq / like / or / gte / lt like PostgREST (a recorded-but-ignored filter would let a
 * test pass on code that reads the wrong rows). The adapters are stubbed to return fixed invoice lines: these
 * tests are about the estimate side, not invoice normalization (covered by the per-provider adapter suites).
 */
import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;
type Err = { message: string; code?: string };
/**
 * A small STATEFUL table engine: inserts and upserts land in `tables`, so a retry sees what the first attempt
 * wrote. It enforces the two real unique keys the persist step relies on -
 * provider_invoice_imports(provider, provider_invoice_id) -> 23505, and cost_reconciliation_runs(provider,
 * period_start, period_end) for the upsert. `fail['table:op']` injects ONE failure; `writes` logs every write.
 */
const mockDb: {
  tables: Record<string, Row[]>; failRead: string | null; writes: Array<{ table: string; op: string; rows: Row[] }>;
  fail: Record<string, Err | 'null-count' | 'zero-rows'>; seq: number;
} = { tables: {}, failRead: null, writes: [], fail: {}, seq: 0 };
let mockLines: Row[] = [];

function likeToRegex(pattern: string): RegExp {
  return new RegExp('^' + pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}
function takeFail(key: string) { const f = mockDb.fail[key]; delete mockDb.fail[key]; return f; }

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const rowsOf = () => (mockDb.tables[table] ??= []);
      const filters: Array<(r: Row) => boolean> = [];
      let mode: 'select' | 'count' | 'update' = 'select';
      let patch: Row = {};
      const matched = () => rowsOf().filter((r) => filters.every((f) => f(r)));
      const b: any = {};
      b.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => { if (opts?.head) mode = 'count'; return b; };
      b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
      b.like = (c: string, p: string) => { const re = likeToRegex(p); filters.push((r) => re.test(String(r[c] ?? ''))); return b; };
      b.or = (expr: string) => {
        // only the `col.like.pattern,col.like.pattern` form the image reconciler uses
        const alts = expr.split(',').map((a) => { const [c, op, ...rest] = a.split('.'); if (op !== 'like') throw new Error(`fake: unsupported or op ${op}`); return [c, likeToRegex(rest.join('.'))] as const; });
        filters.push((r) => alts.some(([c, re]) => re.test(String(r[c] ?? ''))));
        return b;
      };
      b.gte = (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; };
      b.lt = (c: string, v: string) => { filters.push((r) => String(r[c]) < v); return b; };
      const settle = () => {
        if (mode === 'update') {
          const f = takeFail(`${table}:update`);
          if (f && f !== 'null-count' && f !== 'zero-rows') return { data: null, error: f };
          const hit = f === 'zero-rows' ? [] : matched();
          hit.forEach((r) => Object.assign(r, patch));
          mockDb.writes.push({ table, op: 'update', rows: hit.map((r) => ({ ...r })) });
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        if (mode === 'count') {
          const f = takeFail(`${table}:count`);
          if (f === 'null-count') return { data: null, count: null, error: null };
          return { data: null, count: matched().length, error: null };
        }
        if (mockDb.failRead === table) return { data: null, error: { message: 'boom' } };
        return { data: matched().map((r) => ({ ...r })), error: null };
      };
      b.then = (res: any, rej: any) => Promise.resolve(settle()).then(res, rej);
      b.maybeSingle = () => { const r = settle() as { data: Row[] | null; error: Err | null }; return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); };
      b.insert = (input: Row | Row[]) => {
        const rows = ([] as Row[]).concat(input);
        const f = takeFail(`${table}:insert`);
        if (f && typeof f === 'object') return Promise.resolve({ error: f });
        if (table === 'provider_invoice_imports' && rows.some((n) => rowsOf().some((r) => r.provider === n.provider && r.provider_invoice_id === n.provider_invoice_id))) {
          return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint', code: '23505' } });
        }
        rows.forEach((r) => rowsOf().push({ id: `${table}-${++mockDb.seq}`, ...r }));
        mockDb.writes.push({ table, op: 'insert', rows });
        return Promise.resolve({ error: null });
      };
      b.upsert = (row: Row) => ({
        select: () => ({
          single: () => {
            const f = takeFail(`${table}:upsert`);
            if (f && typeof f === 'object') return Promise.resolve({ data: null, error: f });
            let r = rowsOf().find((x) => x.provider === row.provider && x.period_start === row.period_start && x.period_end === row.period_end);
            if (r) Object.assign(r, row); else { r = { id: `run-${++mockDb.seq}`, ...row }; rowsOf().push(r); }
            mockDb.writes.push({ table, op: 'upsert', rows: [{ ...row }] });
            return Promise.resolve({ data: { id: r.id }, error: null });
          },
        }),
      });
      b.update = (p: Row) => { mode = 'update'; patch = p; return b; };
      return b;
    },
  },
}));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const norm = () => ({ lines: mockLines, warnings: [], adapter_version: 'test' });
jest.mock('../../services/billing/reconciliation/openaiAdapter', () => ({
  ...jest.requireActual('../../services/billing/reconciliation/openaiAdapter'), normalizeOpenAiUsageExport: () => norm(),
}));
jest.mock('../../services/billing/reconciliation/anthropicAdapter', () => ({
  ...jest.requireActual('../../services/billing/reconciliation/anthropicAdapter'),
  normalizeAnthropicBillingExport: () => norm(), normalizeAnthropicMessagesUsage: () => norm(),
}));
jest.mock('../../services/billing/reconciliation/geminiAdapter', () => ({
  ...jest.requireActual('../../services/billing/reconciliation/geminiAdapter'),
  normalizeGoogleCloudBillingExport: () => norm(), normalizeGeminiUsageMetadata: () => norm(),
}));
jest.mock('../../services/billing/reconciliation/audioAdapter', () => ({
  ...jest.requireActual('../../services/billing/reconciliation/audioAdapter'),
  normalizeAudioBillingExport: () => norm(), normalizeWhisperUsageExport: () => norm(), normalizeAssemblyAiUsageExport: () => norm(),
}));
jest.mock('../../services/billing/reconciliation/imageAdapter', () => ({
  ...jest.requireActual('../../services/billing/reconciliation/imageAdapter'),
  normalizeImageBillingExport: () => norm(), normalizeDalleUsageExport: () => norm(), normalizeImageUsageExport: () => norm(),
}));

import { ingestOpenAiInvoice } from '../../services/billing/reconciliation/openaiReconciler';
import { ingestAnthropicInvoice } from '../../services/billing/reconciliation/anthropicReconciler';
import { ingestGeminiInvoice } from '../../services/billing/reconciliation/geminiReconciler';
import { ingestAudioInvoice } from '../../services/billing/reconciliation/audioReconciler';
import { ingestImageInvoice } from '../../services/billing/reconciliation/imageReconciler';
import { compareOrganizationId } from '../../services/billing/reconciliation/reconciliationMatcher';
import { PLATFORM_SENTINEL_ORG } from '../../services/billing/platformSentinel';
import { logger } from '../../services/logger';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-10';
const TS = `${DAY}T12:00:00Z`;
const WINDOW = { periodStart: `${DAY}T00:00:00Z`, periodEnd: '2026-11-11T00:00:00Z' };

const line = (model: string, usd: number) => ({ period_day: DAY, model, total_usd: usd, n_requests: 1, provider_org_id: 'prov' });
const cust = (org: string, provider: string, model: string, usd: number) =>
  ({ organization_id: org, provider_name: provider, model_name: model, total_cost_usd: usd, created_at: TS, ledger_hold_transaction_id: null });
// platform_usage_events has NO total_cost_usd / organization_id: its USD column is total_cost.
const plat = (provider: string, model: string, usd: number) =>
  ({ provider_name: provider, model_name: model, total_cost: usd, created_at: TS, source_type: 'embedding' });

const adjustments = () => mockDb.writes.filter((w) => w.table === 'cost_reconciliation_adjustments').flatMap((w) => w.rows);
const imports = () => mockDb.writes.filter((w) => w.table === 'provider_invoice_imports');
const customerAdjUsd = () => adjustments().filter((r) => r.organization_id !== null)
  .reduce((s, r) => s + (Number(r.actual_usd) - Number(r.estimated_usd)), 0);

beforeEach(() => { mockDb.tables = {}; mockDb.failRead = null; mockDb.writes = []; mockDb.fail = {}; mockDb.seq = 0; mockLines = []; jest.clearAllMocks(); });

// Each reconciler with the provider_name / model it reads, so one fixture exercises all five.
const RECONCILERS = [
  { name: 'openai', provider: 'openai', model: 'gpt-4o-mini', run: () => ingestOpenAiInvoice({ providerInvoiceId: 'i', ...WINDOW, payload: {}, rates: {} as any }) },
  { name: 'anthropic', provider: 'anthropic', model: 'claude-x', run: () => ingestAnthropicInvoice({ providerInvoiceId: 'i', ...WINDOW, kind: 'billing', payload: {}, rates: {} as any } as any) },
  { name: 'gemini', provider: 'gemini', model: 'gemini-x', run: () => ingestGeminiInvoice({ providerInvoiceId: 'i', ...WINDOW, kind: 'usage_metadata', payload: {}, rates: {} as any } as any) },
  { name: 'audio (openai_audio)', provider: 'openai', model: 'whisper-1', run: () => ingestAudioInvoice({ providerInvoiceId: 'i', ...WINDOW, providerTag: 'openai_audio', kind: 'billing', payload: {}, rates: {} as any }) },
  { name: 'image (openai_image)', provider: 'openai', model: 'gpt-image-1', run: () => ingestImageInvoice({ providerInvoiceId: 'i', ...WINDOW, providerTag: 'openai_image', kind: 'billing', payload: {}, rates: {} as any }) },
];

describe.each(RECONCILERS)('$name reconciler', ({ provider, model, run }) => {
  it('MIXED bucket: the platform share of the invoice is NOT spread onto customers', async () => {
    // invoice 3.00 = customer A 1.50 + customer B 0.50 + platform 1.00, exactly as estimated
    mockLines = [line(model, 3.0)];
    mockDb.tables.usage_events = [cust(ORG_A, provider, model, 1.5), cust(ORG_B, provider, model, 0.5)];
    mockDb.tables.platform_usage_events = [plat(provider, model, 1.0)];
    await run();
    const adj = adjustments();
    expect(customerAdjUsd()).toBeCloseTo(0, 10); // pre-fix: +1.00 spread onto A (0.75) and B (0.25)
    const platform = adj.filter((r) => r.organization_id === null);
    expect(platform).toHaveLength(1);
    expect(platform[0]).toMatchObject({ estimated_usd: 1, actual_usd: 1 });
    expect(adj.map((r) => r.organization_id).sort()).toEqual([ORG_A, ORG_B, null].sort());
  });

  it('e1: an invoice with platform spend and ZERO customer usage puts no variance on customers and is estimated, not "missing"', async () => {
    mockLines = [line(model, 2.0)];
    mockDb.tables.usage_events = [];
    mockDb.tables.platform_usage_events = [plat(provider, model, 2.0)];
    await run();
    const adj = adjustments();
    expect(customerAdjUsd()).toBe(0);
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ organization_id: null, estimated_usd: 2, actual_usd: 2 });
    expect(adj[0].reason).not.toBe('missing_attribution'); // pre-fix: the platform spend was unaccounted for
  });

  it('the all-zero sentinel org in usage_events is platform spend, never a company', async () => {
    mockLines = [line(model, 2.0)];
    mockDb.tables.usage_events = [cust(ORG_A, provider, model, 1.0), cust(PLATFORM_SENTINEL_ORG, provider, model, 0.4)];
    mockDb.tables.platform_usage_events = [plat(provider, model, 0.6)];
    await run();
    const adj = adjustments();
    expect(adj.map((r) => r.organization_id)).not.toContain(PLATFORM_SENTINEL_ORG);
    // sentinel (0.4) + platform table (0.6) form ONE platform aggregate
    expect(adj.filter((r) => r.organization_id === null)).toEqual([expect.objectContaining({ estimated_usd: 1, actual_usd: 1 })]);
    expect(customerAdjUsd()).toBeCloseTo(0, 10);
  });

  it('FAIL CLOSED: a failed platform read throws BEFORE anything is written (the invoice stays importable)', async () => {
    mockLines = [line(model, 1.0)];
    mockDb.tables.usage_events = [cust(ORG_A, provider, model, 1.0)];
    mockDb.failRead = 'platform_usage_events';
    await expect(run()).rejects.toThrow(/platform_usage_events read failed/);
    expect(mockDb.writes).toEqual([]);
  });

  it('FAIL CLOSED: a failed customer read throws BEFORE anything is written', async () => {
    mockLines = [line(model, 1.0)];
    mockDb.failRead = 'usage_events';
    await expect(run()).rejects.toThrow(/usage_events read failed/);
    expect(mockDb.writes).toEqual([]);
  });

  it('CONTROL: customer-only usage reconciles exactly as before (pro-rata, no platform row)', async () => {
    mockLines = [line(model, 4.0)];
    mockDb.tables.usage_events = [cust(ORG_A, provider, model, 1.5), cust(ORG_B, provider, model, 0.5)];
    mockDb.tables.platform_usage_events = [];
    await run();
    const adj = adjustments();
    expect(adj.map((r) => r.organization_id)).toEqual([ORG_A, ORG_B]);
    // variance 2.00 split 3:1
    expect(Number(adj[0].actual_usd) - Number(adj[0].estimated_usd)).toBeCloseTo(1.5, 10);
    expect(Number(adj[1].actual_usd) - Number(adj[1].estimated_usd)).toBeCloseTo(0.5, 10);
    expect(imports()).toHaveLength(1);
  });
});

describe('the provider/model filter applies to BOTH tables', () => {
  it('audio (openai_audio) ignores platform openai spend that is not whisper', async () => {
    mockLines = [line('whisper-1', 1.0)];
    mockDb.tables.usage_events = [cust(ORG_A, 'openai', 'whisper-1', 1.0)];
    mockDb.tables.platform_usage_events = [plat('openai', 'text-embedding-3-small', 5.0)];
    await ingestAudioInvoice({ providerInvoiceId: 'i', ...WINDOW, providerTag: 'openai_audio', kind: 'billing', payload: {}, rates: {} as any });
    expect(adjustments().filter((r) => r.organization_id === null)).toEqual([]);
  });

  it('openai ignores platform spend from another provider and outside the window', async () => {
    mockLines = [line('gpt-4o-mini', 1.0)];
    mockDb.tables.usage_events = [cust(ORG_A, 'openai', 'gpt-4o-mini', 1.0)];
    mockDb.tables.platform_usage_events = [
      plat('gemini', 'gpt-4o-mini', 5.0),
      { ...plat('openai', 'gpt-4o-mini', 5.0), created_at: '2026-11-11T00:00:00Z' },
    ];
    await ingestOpenAiInvoice({ providerInvoiceId: 'i', ...WINDOW, payload: {}, rates: {} as any });
    expect(adjustments().filter((r) => r.organization_id === null)).toEqual([]);
  });
});

describe('compareOrganizationId', () => {
  it('null (platform) sorts first; ids compare as localeCompare; never throws on null', () => {
    expect(compareOrganizationId(null, null)).toBe(0);
    expect(compareOrganizationId(null, ORG_A)).toBe(-1);
    expect(compareOrganizationId(ORG_A, null)).toBe(1);
    expect(compareOrganizationId(ORG_A, ORG_B)).toBe(ORG_A.localeCompare(ORG_B));
  });
});

describe('PLATFORM_SENTINEL_ORG', () => {
  it('POSITIVE CONTROL: equals every UNKNOWN_ORG definition in the code', () => {
    const root = path.resolve(__dirname, '../../..');
    const files = ['backend/services/aiGatewayCore.ts', 'backend/services/externalApi/execution.ts', 'backend/services/llm/openaiAdapter.ts'];
    for (const rel of files) {
      const m = /UNKNOWN_ORG\s*=\s*'([0-9a-f-]{36})'/.exec(fs.readFileSync(path.join(root, rel), 'utf8'));
      expect([rel, m && m[1]]).toEqual([rel, PLATFORM_SENTINEL_ORG]);
    }
  });
});

/*
 * The shared persist step (reconciliationPersist), driven through the OpenAI reconciler. All five provider
 * reconcilers call the same function, and the describe.each above runs each of them through it.
 */
describe('persist step: resumable, one invoice per period', () => {
  const M = 'gpt-4o-mini';
  const ingest = (id = 'inv-1') => ingestOpenAiInvoice({ providerInvoiceId: id, ...WINDOW, payload: {}, rates: {} as any });
  const runs = () => mockDb.tables.cost_reconciliation_runs ?? [];
  const storedAdj = () => mockDb.tables.cost_reconciliation_adjustments ?? [];
  const fixture = () => {
    mockLines = [line(M, 4.0)];
    mockDb.tables.usage_events = [cust(ORG_A, 'openai', M, 1.5), cust(ORG_B, 'openai', M, 0.5)];
    mockDb.tables.platform_usage_events = [];
  };
  const warnEvents = () => (logger.warn as jest.Mock).mock.calls.map((c) => c[0]);

  it('happy path: run ends COMPLETED, carries the invoice id and the estimate snapshot', async () => {
    fixture();
    const out = await ingest();
    expect(out).toMatchObject({ status: 'ingested', adjustments_written: 2, resumed: false });
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ status: 'completed', metadata: expect.objectContaining({ provider_invoice_id: 'inv-1' }) });
    const md = runs()[0].metadata as any;
    expect(md.estimates).toMatchObject({ estimated_usd_sum: 2, aggregate_count: 2, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(md.estimates_first).toEqual(md.estimates);
  });

  it('a retry after COMPLETION is a duplicate and writes nothing', async () => {
    fixture();
    await ingest();
    const before = mockDb.writes.length;
    await expect(ingest()).resolves.toEqual({ status: 'duplicate', provider_invoice_id: 'inv-1' });
    expect(mockDb.writes.length).toBe(before);
  });

  it('adjustments insert FAILS -> the retry RESUMES and writes them exactly once (was: a permanent gap)', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_adjustments:insert'] = { message: 'connection reset' };
    await expect(ingest()).rejects.toThrow(/adjustments insert failed/);
    expect(runs()[0].status).toBe('running');
    expect(storedAdj()).toHaveLength(0);
    const out = await ingest();
    expect(out).toMatchObject({ status: 'ingested', resumed: true, adjustments_written: 2 });
    expect(storedAdj()).toHaveLength(2);
    expect(runs()[0].status).toBe('completed');
    expect(warnEvents()).toContain('reconcile_resumed');
  });

  it('run upsert FAILS -> the retry resumes and completes', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_runs:upsert'] = { message: 'timeout' };
    await expect(ingest()).rejects.toThrow(/run upsert failed/);
    expect(runs()).toHaveLength(0);
    await expect(ingest()).resolves.toMatchObject({ status: 'ingested', resumed: true, adjustments_written: 2 });
    expect(runs()[0].status).toBe('completed');
  });

  it('e1 #4: a crash AFTER the adjustments (run running, adjustments present) -> only the completion, no 2nd insert', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_runs:update'] = { message: 'process killed' };
    await expect(ingest()).rejects.toThrow(/run completion failed/);
    expect(runs()[0].status).toBe('running');
    expect(storedAdj()).toHaveLength(2);
    const out = await ingest();
    expect(out).toMatchObject({ status: 'ingested', resumed: true, adjustments_written: 0 });
    expect(storedAdj()).toHaveLength(2);
    expect(runs()[0].status).toBe('completed');
  });

  it('resume reconciles the STORED line_items, never the new payload', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_adjustments:insert'] = { message: 'x' };
    await expect(ingest()).rejects.toThrow();
    mockLines = [line(M, 1.0), line('other-model', 3.0)]; // same total (4.00), different lines
    await ingest();
    const models = storedAdj().map((r) => (r.metadata as any).model);
    expect(new Set(models)).toEqual(new Set([M]));
  });

  it('resume REFUSES a payload whose total differs from the stored import', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_adjustments:insert'] = { message: 'x' };
    await expect(ingest()).rejects.toThrow();
    mockLines = [line(M, 4.5)];
    const before = mockDb.writes.length;
    await expect(ingest()).rejects.toThrow(/was imported with total 4/);
    expect(mockDb.writes.length).toBe(before);
  });

  it('e1 #3: the total comparison is rounded like the matcher (0.1 + 0.2 equals 0.3), not float equality', async () => {
    mockDb.tables.usage_events = [cust(ORG_A, 'openai', M, 0.3)];
    mockDb.tables.platform_usage_events = [];
    mockLines = [line(M, 0.1), line(M, 0.2)];
    mockDb.fail['cost_reconciliation_adjustments:insert'] = { message: 'x' };
    await expect(ingest()).rejects.toThrow();
    mockLines = [line(M, 0.3)];
    await expect(ingest()).resolves.toMatchObject({ status: 'ingested', resumed: true });
  });

  it('a resume with CHANGED estimates is allowed and logged with both snapshots; the first one is kept', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_adjustments:insert'] = { message: 'x' };
    await expect(ingest()).rejects.toThrow();
    const first = (runs()[0].metadata as any).estimates;
    mockDb.tables.usage_events.push(cust(ORG_A, 'openai', M, 0.25)); // late usage
    await ingest();
    const call = (logger.warn as jest.Mock).mock.calls.find((c) => c[0] === 'reconcile_resumed');
    expect(call[1]).toMatchObject({ estimate_changed: true, estimates_first: first });
    expect(call[1].estimates_now.estimated_usd_sum).toBeCloseTo(2.25, 10);
    expect((runs()[0].metadata as any).estimates_first).toEqual(first);
  });

  it('a SECOND invoice for an already-imported period is refused before any write', async () => {
    fixture();
    await ingest('inv-1');
    const before = mockDb.writes.length;
    await expect(ingest('inv-2')).rejects.toThrow(/already reconciled by invoice inv-1/);
    expect(mockDb.writes.length).toBe(before);
  });

  it('23505 for an invoice that is NOT stored (another invoice won the period) is refused, not resumed', async () => {
    fixture();
    mockDb.fail['provider_invoice_imports:insert'] = { message: 'duplicate key value violates unique constraint', code: '23505' };
    await expect(ingest()).rejects.toThrow(/period belongs to another invoice/);
    expect(runs()).toHaveLength(0);
  });

  it('an import error that only SAYS "duplicate" (no 23505) is a failure, not a duplicate', async () => {
    fixture();
    mockDb.fail['provider_invoice_imports:insert'] = { message: 'duplicate something upstream', code: '57014' };
    await expect(ingest()).rejects.toThrow(/invoice import failed/);
  });

  it('an adjustment count with NO answer (null count, null error) refuses rather than double-inserting', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_adjustments:insert'] = { message: 'x' };
    await expect(ingest()).rejects.toThrow();
    mockDb.fail['cost_reconciliation_adjustments:count'] = 'null-count';
    await expect(ingest()).rejects.toThrow(/adjustment count returned no answer/);
    expect(storedAdj()).toHaveLength(0);
  });

  it('a completion that matches 0 rows is a failure, not a silent success', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_runs:update'] = 'zero-rows';
    await expect(ingest()).rejects.toThrow(/run completion matched 0 rows/);
  });

  it('e1: a LEGACY run for the period (no provider_invoice_id) is refused BEFORE the import - no import row is stored', async () => {
    fixture();
    mockDb.tables.cost_reconciliation_runs = [{ id: 'legacy', provider: 'openai', period_start: WINDOW.periodStart, period_end: WINDOW.periodEnd, status: 'running', metadata: {} }];
    await expect(ingest()).rejects.toThrow(/period already has a run for invoice unknown \(legacy run\)/);
    expect(mockDb.tables.provider_invoice_imports ?? []).toHaveLength(0);
    expect(mockDb.tables.cost_reconciliation_adjustments ?? []).toHaveLength(0);
    expect(mockDb.writes).toEqual([]);
  });

  it('a run belonging to ANOTHER invoice is refused before the import too', async () => {
    fixture();
    mockDb.tables.cost_reconciliation_runs = [{ id: 'r-x', provider: 'openai', period_start: WINDOW.periodStart, period_end: WINDOW.periodEnd, status: 'completed', metadata: { provider_invoice_id: 'inv-other' } }];
    await expect(ingest()).rejects.toThrow(/period already has a run for invoice inv-other/);
    expect(mockDb.writes).toEqual([]);
  });

  it('e1: a crash AFTER the adjustments, resumed with a DIFFERENT estimate, keeps the run describing its own adjustments', async () => {
    fixture();
    mockDb.fail['cost_reconciliation_runs:update'] = { message: 'process killed' };
    await expect(ingest()).rejects.toThrow(/run completion failed/);
    const before = JSON.parse(JSON.stringify(runs()[0]));
    expect(before.estimated_usd_sum).toBeCloseTo(2, 10);
    mockDb.tables.usage_events.push(cust(ORG_A, 'openai', M, 0.75)); // estimate B (late usage)
    const out = await ingest();
    expect(out).toMatchObject({ status: 'ingested', resumed: true, adjustments_written: 0, totals: { estimated_usd_sum: 2, actual_usd_sum: 4 } });
    const after = runs()[0];
    expect(after.status).toBe('completed');
    expect(after.estimated_usd_sum).toBe(before.estimated_usd_sum);
    expect(after.actual_usd_sum).toBe(before.actual_usd_sum);
    expect(after.started_at).toBe(before.started_at);
    expect(after.metadata).toEqual(before.metadata); // buckets + estimates untouched
    expect(mockDb.writes.filter((w) => w.op === 'upsert')).toHaveLength(1); // only the first attempt's
    const call = (logger.warn as jest.Mock).mock.calls.find((c) => c[0] === 'reconcile_resumed');
    expect(call[1]).toMatchObject({ estimate_changed: true, adjustments_already: 2 });
  });
});
