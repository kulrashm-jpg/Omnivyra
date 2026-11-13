/**
 * Provider reconcilers — PLATFORM rows (usage_events.organization_id IS NULL).
 *
 * WHY
 * Migration 20270217000038 makes usage_events.organization_id nullable; NULL is
 * legal only with metadata->>'billing_scope' = 'platform' (platform AI spend
 * that belongs to no customer company). Before this fix every provider
 * reconciler read `String(r.organization_id ?? '')`, so a NULL row became ''
 * and was silently dropped from the estimates. Its share of the provider
 * invoice then landed on whichever customer orgs shared the bucket as
 * "variance" — platform spend attributed to a company. The sort used
 * `a.organization_id.localeCompare(...)`, which throws on null.
 *
 * WHAT IS PROVEN HERE (all five orchestrators, one parametrised suite)
 *  1. CONTROL (org rows only): the exact insert payload for
 *     cost_reconciliation_adjustments is a golden literal derived by hand from
 *     the pre-fix algorithm. Every number is a dyadic fraction, so `toEqual`
 *     is exact. This block uses no new export and is expected to pass on the
 *     pre-fix code too.
 *  2. A NULL-org row alongside a normal org row: the run does not throw, the
 *     platform group's adjustment carries organization_id === null (never ''),
 *     the normal org's group keeps its own estimate and is charged only its
 *     own pro-rata share (not the platform's).
 *  3. Harness positive control: the supabase stub REJECTS a non-uuid
 *     organization_id on cost_reconciliation_adjustments (as the uuid column
 *     does), so a regression to '' fails the run instead of passing silently.
 *
 * The adapters' normalizers are stubbed to return a fixed invoice so the
 * suite exercises only the usage_events read, grouping, matcher and insert.
 */

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

// Every `normalize*` export of every provider adapter returns the fixture invoice.
function mockStubNormalizers(actual: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...actual };
  for (const k of Object.keys(actual)) {
    if (k.startsWith('normalize') && typeof actual[k] === 'function') {
      out[k] = () => ({ adapter_version: 'test_v1', lines: mockInvoiceLines, warnings: [] });
    }
  }
  return out;
}
jest.mock('../../services/billing/reconciliation/openaiAdapter', () =>
  mockStubNormalizers(jest.requireActual('../../services/billing/reconciliation/openaiAdapter')));
jest.mock('../../services/billing/reconciliation/anthropicAdapter', () =>
  mockStubNormalizers(jest.requireActual('../../services/billing/reconciliation/anthropicAdapter')));
jest.mock('../../services/billing/reconciliation/geminiAdapter', () =>
  mockStubNormalizers(jest.requireActual('../../services/billing/reconciliation/geminiAdapter')));
jest.mock('../../services/billing/reconciliation/audioAdapter', () =>
  mockStubNormalizers(jest.requireActual('../../services/billing/reconciliation/audioAdapter')));
jest.mock('../../services/billing/reconciliation/imageAdapter', () =>
  mockStubNormalizers(jest.requireActual('../../services/billing/reconciliation/imageAdapter')));

import { ingestOpenAiInvoice } from '../../services/billing/reconciliation/openaiReconciler';
import { ingestAnthropicInvoice } from '../../services/billing/reconciliation/anthropicReconciler';
import { ingestGeminiInvoice } from '../../services/billing/reconciliation/geminiReconciler';
import { ingestAudioInvoice } from '../../services/billing/reconciliation/audioReconciler';
import { ingestImageInvoice } from '../../services/billing/reconciliation/imageReconciler';
import {
  reconcileProviderInvoice,
  compareOrganizationId,
} from '../../services/billing/reconciliation/reconciliationMatcher';

// ── supabase stub ───────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let mockInvoiceLines: Array<Record<string, unknown>> = [];
let mockUsageRows: Array<Record<string, unknown>> = [];
let mockInserted: Record<string, Array<Record<string, unknown>>> = {};

function mockFrom(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lt', 'lte', 'like', 'or', 'order', 'limit', 'upsert']) {
    b[m] = () => b;
  }
  b.insert = (payload: unknown) => {
    const rows = (Array.isArray(payload) ? payload : [payload]) as Array<Record<string, unknown>>;
    if (table === 'cost_reconciliation_adjustments') {
      // Faithful to the column type: uuid NULL. '' and other non-uuids are rejected.
      const bad = rows.find((r) => r.organization_id !== null && !UUID_RE.test(String(r.organization_id)));
      if (bad) {
        return Promise.resolve({ data: null, error: { message: `invalid input syntax for type uuid: "${String(bad.organization_id)}"` } });
      }
    }
    (mockInserted[table] ??= []).push(...rows);
    return Promise.resolve({ data: null, error: null });
  };
  b.single = () => Promise.resolve({ data: { id: 'run-1' }, error: null });
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve(table === 'usage_events' ? { data: mockUsageRows, error: null } : { data: [], error: null }).then(onF, onR);
  return b;
}

// ── fixtures ────────────────────────────────────────────────────────────────

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-01';
const BASE = { providerInvoiceId: 'INV-1', periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-11-02T00:00:00Z', payload: {}, rates: {} };

function line(model: string, total_usd: number, n_requests: number) {
  return {
    period_day: DAY, kind: 'completion', model, n_requests,
    input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
    provider_org_id: 'prov-org', total_usd,
  };
}
function usage(organization_id: string | null, model: string, total_cost_usd: number, hold: string | null) {
  return { organization_id, model_name: model, total_cost_usd, created_at: `${DAY}T10:00:00Z`, ledger_hold_transaction_id: hold };
}

type Case = { name: string; provider: string; run: () => Promise<unknown> };
const CASES: Case[] = [
  { name: 'openai',    provider: 'openai',       run: () => ingestOpenAiInvoice({ ...BASE }) },
  { name: 'anthropic', provider: 'anthropic',    run: () => ingestAnthropicInvoice({ ...BASE, kind: 'billing' }) },
  { name: 'gemini',    provider: 'gemini',       run: () => ingestGeminiInvoice({ ...BASE, kind: 'gcb_export' }) },
  { name: 'audio',     provider: 'openai_audio', run: () => ingestAudioInvoice({ ...BASE, kind: 'whisper_usage', providerTag: 'openai_audio' }) },
  { name: 'image',     provider: 'openai_image', run: () => ingestImageInvoice({ ...BASE, kind: 'dalle_usage', providerTag: 'openai_image' }) },
];

const adjustments = () => mockInserted['cost_reconciliation_adjustments'] ?? [];

beforeEach(() => {
  mockInvoiceLines = [];
  mockUsageRows = [];
  mockInserted = {};
});

// ── 3. harness positive control ─────────────────────────────────────────────

describe('harness: the adjustments stub enforces the uuid column type', () => {
  test("rejects organization_id '' and accepts null / a uuid", async () => {
    const t = mockFrom('cost_reconciliation_adjustments') as { insert: (r: unknown) => Promise<{ error: { message: string } | null }> };
    expect((await t.insert([{ organization_id: '' }])).error?.message).toMatch(/invalid input syntax for type uuid/);
    expect((await t.insert([{ organization_id: null }])).error).toBeNull();
    expect((await t.insert([{ organization_id: ORG_A }])).error).toBeNull();
  });
});

describe.each(CASES)('$name reconciler', ({ provider, run }) => {
  // ── 1. CONTROL: ordinary org rows, golden insert payload ──────────────────
  test('CONTROL: org-only usage produces exactly the pre-fix adjustments', async () => {
    mockInvoiceLines = [line('m-1', 1.0, 4), line('m-2', 0.5, 2)];
    mockUsageRows = [
      usage(ORG_A, 'm-1', 0.25, 'h-a1'),
      usage(ORG_B, 'm-1', 0.125, 'h-b'),
      usage(ORG_A, 'm-1', 0.125, null),
    ];
    const out = await run();
    expect(out).toEqual({
      status: 'ingested', run_id: 'run-1', adjustments_written: 3,
      totals: { estimated_usd_sum: 0.5, actual_usd_sum: 1.5 }, warnings: [],
    });
    expect(adjustments()).toEqual([
      {
        run_id: 'run-1', organization_id: ORG_A, provider, action_key: null, ledger_hold_transaction_id: 'h-a1',
        estimated_usd: 0.375, actual_usd: 0.75, reason: 'variance',
        metadata: { period_day: DAY, model: 'm-1', share: 0.75, severity: 'high' },
      },
      {
        run_id: 'run-1', organization_id: ORG_B, provider, action_key: null, ledger_hold_transaction_id: 'h-b',
        estimated_usd: 0.125, actual_usd: 0.25, reason: 'variance',
        metadata: { period_day: DAY, model: 'm-1', share: 0.25, severity: 'high' },
      },
      {
        run_id: 'run-1', organization_id: null, provider, action_key: null, ledger_hold_transaction_id: null,
        estimated_usd: 0, actual_usd: 0.5, reason: 'missing_attribution',
        metadata: { period_day: DAY, model: 'm-2', n_requests: 2, provider_org_id: 'prov-org', severity: 'medium' },
      },
    ]);
  });

  // ── 2. NULL-org (platform) row alongside a normal org row ─────────────────
  test('platform row: run does not throw, platform adjustment has organization_id null, org keeps its own share', async () => {
    mockInvoiceLines = [line('m-1', 1.0, 4)];
    mockUsageRows = [
      usage(ORG_A, 'm-1', 0.25, 'h-a1'),
      usage(null, 'm-1', 0.125, null),
      usage(null, 'm-1', 0.125, null), // two platform rows -> ONE platform group
    ];
    const out = await run();
    expect(out).toMatchObject({ status: 'ingested', adjustments_written: 2, totals: { estimated_usd_sum: 0.5, actual_usd_sum: 1.0 } });

    const rows = adjustments();
    // Never '' — every organization_id is a uuid or null.
    for (const r of rows) expect(r.organization_id === null || UUID_RE.test(String(r.organization_id))).toBe(true);
    expect(rows.some((r) => r.organization_id === '')).toBe(false);

    // Platform sorts first; its group carries null.
    expect(rows).toEqual([
      {
        run_id: 'run-1', organization_id: null, provider, action_key: null, ledger_hold_transaction_id: null,
        estimated_usd: 0.25, actual_usd: 0.5, reason: 'variance',
        metadata: { period_day: DAY, model: 'm-1', share: 0.5, severity: 'high' },
      },
      {
        run_id: 'run-1', organization_id: ORG_A, provider, action_key: null, ledger_hold_transaction_id: 'h-a1',
        // ORG_A's own estimate is unchanged (0.25); it is charged only its own
        // 50% share of the variance, not the platform's (pre-fix: actual 1.0).
        estimated_usd: 0.25, actual_usd: 0.5, reason: 'variance',
        metadata: { period_day: DAY, model: 'm-1', share: 0.5, severity: 'high' },
      },
    ]);
  });

  test('platform-only bucket: one null-org adjustment, no throw', async () => {
    mockInvoiceLines = [line('m-1', 0.5, 1)];
    mockUsageRows = [usage(null, 'm-1', 0.5, null)];
    await expect(run()).resolves.toMatchObject({ status: 'ingested', adjustments_written: 1 });
    expect(adjustments()).toEqual([
      {
        run_id: 'run-1', organization_id: null, provider, action_key: null, ledger_hold_transaction_id: null,
        estimated_usd: 0.5, actual_usd: 0.5, reason: 'rounding',
        metadata: { period_day: DAY, model: 'm-1', share: 1, severity: 'none' },
      },
    ]);
  });
});

// ── pure matcher + comparator ───────────────────────────────────────────────

describe('reconciliationMatcher null-safe organization_id', () => {
  test('compareOrganizationId: null first, non-null identical to localeCompare', () => {
    expect(compareOrganizationId(null, null)).toBe(0);
    expect(compareOrganizationId(null, ORG_A)).toBeLessThan(0);
    expect(compareOrganizationId(ORG_A, null)).toBeGreaterThan(0);
    expect(Math.sign(compareOrganizationId(ORG_A, ORG_B))).toBe(Math.sign(ORG_A.localeCompare(ORG_B)));
    expect(Math.sign(compareOrganizationId(ORG_B, ORG_A))).toBe(Math.sign(ORG_B.localeCompare(ORG_A)));
  });

  test('reconcileProviderInvoice accepts a null-org aggregate in a matched bucket (input order irrelevant)', () => {
    const invoiceLines = [line('m-1', 1.0, 2)] as unknown as Parameters<typeof reconcileProviderInvoice>[0]['invoiceLines'];
    const a = { organization_id: ORG_A, period_day: DAY, model: 'm-1', estimated_usd: 0.25, ledger_hold_transaction_id: 'h-a1' };
    const p = { organization_id: null, period_day: DAY, model: 'm-1', estimated_usd: 0.25, ledger_hold_transaction_id: null };
    const r1 = reconcileProviderInvoice({ provider: 'openai', invoiceLines, usageAggregates: [a, p] });
    const r2 = reconcileProviderInvoice({ provider: 'openai', invoiceLines, usageAggregates: [p, a] });
    expect(r2).toEqual(r1);
    expect(r1.adjustments.map((x) => x.organization_id)).toEqual([null, ORG_A]);
  });
});
