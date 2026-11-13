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
const mockDb: { tables: Record<string, Row[]>; failRead: string | null; writes: Array<{ table: string; op: string; rows: Row[] }> } = {
  tables: {}, failRead: null, writes: [],
};
let mockLines: Row[] = [];

function likeToRegex(pattern: string): RegExp {
  return new RegExp('^' + pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let data: Row[] = [...(mockDb.tables[table] ?? [])];
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { data = data.filter((r) => r[c] === v); return b; };
      b.like = (c: string, p: string) => { const re = likeToRegex(p); data = data.filter((r) => re.test(String(r[c] ?? ''))); return b; };
      b.or = (expr: string) => {
        // only the `col.like.pattern,col.like.pattern` form the image reconciler uses
        const alts = expr.split(',').map((a) => { const [c, op, ...rest] = a.split('.'); if (op !== 'like') throw new Error(`fake: unsupported or op ${op}`); return [c, likeToRegex(rest.join('.'))] as const; });
        data = data.filter((r) => alts.some(([c, re]) => re.test(String(r[c] ?? ''))));
        return b;
      };
      b.gte = (c: string, v: string) => { data = data.filter((r) => String(r[c]) >= v); return b; };
      b.lt = (c: string, v: string) => { data = data.filter((r) => String(r[c]) < v); return b; };
      b.then = (res: any, rej: any) => Promise.resolve(
        mockDb.failRead === table ? { data: null, error: { message: 'boom' } } : { data, error: null },
      ).then(res, rej);
      b.insert = (rows: Row | Row[]) => { mockDb.writes.push({ table, op: 'insert', rows: ([] as Row[]).concat(rows) }); return Promise.resolve({ error: null }); };
      b.upsert = (row: Row) => {
        mockDb.writes.push({ table, op: 'upsert', rows: [row] });
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'run-1' }, error: null }) }) };
      };
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

beforeEach(() => { mockDb.tables = {}; mockDb.failRead = null; mockDb.writes = []; mockLines = []; });

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
