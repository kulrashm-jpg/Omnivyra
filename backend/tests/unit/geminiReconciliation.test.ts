/**
 * Gemini reconciliation — pure-module tests (no DB).
 * Covers both normalizers: Google Cloud Billing export filter/extraction,
 * Gemini usageMetadata rollup, tolerant parsing, determinism, and matcher
 * integration via the generic reconcileProviderInvoice (provider='gemini').
 */

import {
  normalizeGoogleCloudBillingExport,
  normalizeGeminiUsageMetadata,
  GEMINI_ADAPTER_VERSION_BILLING,
  GEMINI_ADAPTER_VERSION_USAGE,
} from '../../services/billing/reconciliation/geminiAdapter';
import { reconcileProviderInvoice } from '../../services/billing/reconciliation/reconciliationMatcher';
import type { RateTable } from '../../services/billing/reconciliation/openaiAdapter';

const RATES: RateTable = {
  tokens: { 'gemini-1.5-flash': { in_per_1k: 0.000075, out_per_1k: 0.00030 } },
  defaultToken: { in_per_1k: 0.0002, out_per_1k: 0.0008 },
};

describe('geminiAdapter.normalizeGoogleCloudBillingExport — pure / tolerant / Gemini-filtered', () => {
  test('filters non-Gemini rows; extracts model from SKU description; cost is authoritative', () => {
    const r = normalizeGoogleCloudBillingExport({
      payload: {
        rows: [
          // Non-Gemini service — must be filtered out.
          { service: { description: 'Cloud Storage' }, sku: { description: 'Standard Storage' },
            usage_start_time: '2026-05-19T00:00:00Z', usage: { amount: 100, unit: 'bytes' }, cost: 5 },
          // Gemini input-tokens SKU.
          { service: { description: 'Generative Language API' },
            sku: { description: 'Gemini 1.5 Flash Input Token' },
            usage_start_time: '2026-05-19T00:00:00Z',
            project: { id: 'proj-1' },
            usage: { amount: 1000, unit: 'tokens' },
            cost: 0.075, currency: 'USD' },
          // Gemini output-tokens SKU same day.
          { service: { description: 'Generative Language API' },
            sku: { description: 'Gemini 1.5 Flash Output Token' },
            usage_start_time: '2026-05-19T00:00:00Z',
            project: { id: 'proj-1' },
            usage: { amount: 500, unit: 'tokens' },
            cost: 0.150, currency: 'USD' },
        ],
      },
    });
    expect(r.adapter_version).toBe(GEMINI_ADAPTER_VERSION_BILLING);
    expect(r.warnings).toEqual([]);
    expect(r.lines).toHaveLength(2);
    expect(r.lines.every(l => l.model === 'gemini-1.5-flash')).toBe(true);
    const inputRow  = r.lines.find(l => l.input_tokens > 0)!;
    const outputRow = r.lines.find(l => l.output_tokens > 0)!;
    expect(inputRow.total_usd).toBe(0.075);   // authoritative cost
    expect(outputRow.total_usd).toBe(0.150);
    expect(inputRow.provider_org_id).toBe('proj-1'); // project id captured (NOT customer org)
  });

  test('projectOrgMap (when supplied by caller) maps project_id → customer org_id', () => {
    const r = normalizeGoogleCloudBillingExport({
      payload: {
        rows: [{
          service: { description: 'Generative Language API' },
          sku: { description: 'Gemini 1.5 Flash Input Token' },
          usage_start_time: '2026-05-19T00:00:00Z',
          project: { id: 'proj-1' },
          usage: { amount: 1000 }, cost: 0.075,
        }],
      },
      projectOrgMap: { 'proj-1': 'org-A' },
    });
    expect(r.lines[0].provider_org_id).toBe('org-A');
  });

  test('tolerant: rows missing usage_start_time / unrecognized SKU are skipped with warnings', () => {
    const r = normalizeGoogleCloudBillingExport({
      payload: {
        rows: [
          { service: { description: 'Generative Language API' },
            sku: { description: 'Gemini 1.5 Flash Input Token' },
            usage: { amount: 100 }, cost: 0.01 }, // no usage_start_time
          { service: { description: 'Generative Language API' },
            sku: { description: 'Mystery SKU' },
            usage_start_time: '2026-05-19T00:00:00Z',
            usage: { amount: 100 }, cost: 0.01 }, // model still extractable as 'gemini:mystery sku'
        ],
      },
    });
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    // Second row should normalize with a service-level model fallback (not lost).
    expect(r.lines.length).toBeGreaterThanOrEqual(1);
  });

  test('determinism: identical payload → identical result', () => {
    const payload = {
      rows: [{
        service: { description: 'Generative Language API' },
        sku: { description: 'Gemini 1.5 Flash Input Token' },
        usage_start_time: '2026-05-19T00:00:00Z',
        project: { id: 'proj-1' },
        usage: { amount: 100 }, cost: 0.01,
      }],
    };
    const a = normalizeGoogleCloudBillingExport({ payload });
    const b = normalizeGoogleCloudBillingExport({ payload });
    expect(b).toEqual(a);
  });
});

describe('geminiAdapter.normalizeGeminiUsageMetadata — rollup + bucketing', () => {
  test('aggregates per (day, model, org); USD computed from rate table (Gemini API returns no $)', () => {
    const r = normalizeGeminiUsageMetadata({
      payload: {
        entries: [
          { created_at: '2026-05-19T10:00:00Z', model: 'gemini-1.5-flash',
            usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
            organization_id: 'org-1' },
          { created_at: '2026-05-19T22:00:00Z', model: 'gemini-1.5-flash',
            usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 250 },
            organization_id: 'org-1' },
          { created_at: '2026-05-19T11:00:00Z', model: 'gemini-1.5-flash',
            usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
            workspace_id: 'org-2' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(GEMINI_ADAPTER_VERSION_USAGE);
    expect(r.lines).toHaveLength(2);
    const o1 = r.lines.find(l => l.provider_org_id === 'org-1')!;
    expect(o1.n_requests).toBe(2);
    expect(o1.input_tokens).toBe(1500);
    expect(o1.output_tokens).toBe(750);
    // (1500/1000)*0.000075 + (750/1000)*0.00030 = 0.0001125 + 0.000225 = 0.0003375
    expect(o1.total_usd).toBeCloseTo(0.0003375, 10);
  });

  test('tolerant: entries missing created_at / model skipped with warnings', () => {
    const r = normalizeGeminiUsageMetadata({
      payload: {
        entries: [
          { model: 'gemini-1.5-flash', usageMetadata: { promptTokenCount: 100 } }, // no created_at
          { created_at: '2026-05-19T00:00:00Z', usageMetadata: { promptTokenCount: 100 } }, // no model
          { created_at: '2026-05-19T00:00:00Z', model: 'gemini-1.5-flash',
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings.length).toBe(2);
    expect(r.lines).toHaveLength(1);
  });

  test('determinism: stable ordering and identical result', () => {
    const payload = {
      entries: [
        { created_at: '2026-05-19', model: 'gemini-1.5-flash',
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }, organization_id: 'b' },
        { created_at: '2026-05-19', model: 'gemini-1.5-flash',
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }, organization_id: 'a' },
      ],
    };
    const r1 = normalizeGeminiUsageMetadata({ payload, rates: RATES });
    const r2 = normalizeGeminiUsageMetadata({ payload, rates: RATES });
    expect(r2).toEqual(r1);
    expect(r1.lines.map(l => l.provider_org_id)).toEqual(['a', 'b']);
  });
});

describe('reconcileProviderInvoice — works for provider=gemini (same matcher core)', () => {
  test('missing_attribution when GCB invoice has spend but no customer-attributed usage', () => {
    // This is the realistic Gemini case today: visibility-probe usage_events
    // lack org attribution (Phase 4.1 Task 2 deferred), so platform-level
    // adjustments are the honest, correct output.
    const r = reconcileProviderInvoice({
      provider: 'gemini',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'completion', model: 'gemini-1.5-flash',
        n_requests: 0, input_tokens: 1000, output_tokens: 0, image_count: 0, audio_seconds: 0,
        provider_org_id: 'proj-1', total_usd: 0.075,
      }],
      usageAggregates: [],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('gemini');
    expect(r.adjustments[0].reason).toBe('missing_attribution');
    expect(r.adjustments[0].actual_usd).toBeCloseTo(0.075, 8);
  });

  test('matched bucket pro-rata: gemini provider tag carried through every row', () => {
    const r = reconcileProviderInvoice({
      provider: 'gemini',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'completion', model: 'gemini-1.5-flash',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
        provider_org_id: null, total_usd: 1.00,
      }],
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'gemini-1.5-flash', estimated_usd: 0.6 },
        { organization_id: 'org-B', period_day: '2026-05-19', model: 'gemini-1.5-flash', estimated_usd: 0.4 },
      ],
    });
    expect(r.adjustments).toHaveLength(2);
    expect(r.adjustments.every(a => a.provider === 'gemini')).toBe(true);
  });

  test('missing_provider_event: customer gemini usage with no invoice → negative platform delta', () => {
    const r = reconcileProviderInvoice({
      provider: 'gemini',
      invoiceLines: [],
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'gemini-1.5-flash', estimated_usd: 0.10 },
      ],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('gemini');
    expect(r.adjustments[0].reason).toBe('missing_provider_event');
    expect(r.adjustments[0].adjustment_usd).toBeCloseTo(-0.10, 8);
  });

  test('replay determinism: same input → same adjustment set/order/values', () => {
    const args = {
      provider: 'gemini',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'completion' as const, model: 'gemini-1.5-flash',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
        provider_org_id: null, total_usd: 0.50,
      }],
      usageAggregates: [
        { organization_id: 'org-2', period_day: '2026-05-19', model: 'gemini-1.5-flash', estimated_usd: 0.25 },
        { organization_id: 'org-1', period_day: '2026-05-19', model: 'gemini-1.5-flash', estimated_usd: 0.25 },
      ],
    };
    const r1 = reconcileProviderInvoice(args);
    const r2 = reconcileProviderInvoice(args);
    expect(r2).toEqual(r1);
    expect(r1.adjustments.map(a => a.organization_id)).toEqual(['org-1', 'org-2']);
  });
});
