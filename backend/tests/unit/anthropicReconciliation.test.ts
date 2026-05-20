/**
 * Anthropic reconciliation — pure-module tests (no DB).
 * Covers both normalizer shapes (billing export + messages usage rollup),
 * tolerant parsing, determinism, and matcher integration via the generic
 * reconcileProviderInvoice (provider='anthropic').
 */

import {
  normalizeAnthropicBillingExport,
  normalizeAnthropicMessagesUsage,
  ANTHROPIC_ADAPTER_VERSION_BILLING,
  ANTHROPIC_ADAPTER_VERSION_USAGE,
} from '../../services/billing/reconciliation/anthropicAdapter';
import { reconcileProviderInvoice } from '../../services/billing/reconciliation/reconciliationMatcher';
import type { RateTable } from '../../services/billing/reconciliation/openaiAdapter';

const RATES: RateTable = {
  tokens: {
    'claude-3-5-sonnet-20240620': { in_per_1k: 0.003,  out_per_1k: 0.015 },
    'claude-3-haiku-20240307':    { in_per_1k: 0.00025, out_per_1k: 0.00125 },
  },
  defaultToken: { in_per_1k: 0.001, out_per_1k: 0.004 },
};

describe('anthropicAdapter.normalizeAnthropicBillingExport — pure / tolerant', () => {
  test('billing export with explicit amount_usd is authoritative', () => {
    const r = normalizeAnthropicBillingExport({
      payload: {
        invoice_id: 'INV-1',
        line_items: [{
          period_day: '2026-05-19',
          model: 'claude-3-5-sonnet-20240620',
          input_tokens: 1000,
          output_tokens: 500,
          n_requests: 7,
          amount_usd: 0.42,
          organization_id: 'wsp-abc',
        }],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(ANTHROPIC_ADAPTER_VERSION_BILLING);
    expect(r.warnings).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].total_usd).toBe(0.42); // explicit, not derived from rates
    expect(r.lines[0].model).toBe('claude-3-5-sonnet-20240620');
    expect(r.lines[0].n_requests).toBe(7);
    expect(r.lines[0].provider_org_id).toBe('wsp-abc');
  });

  test('billing export without amount_usd derives USD from rates (token cost)', () => {
    const r = normalizeAnthropicBillingExport({
      payload: {
        line_items: [{
          period_day: '2026-05-19',
          model: 'claude-3-haiku-20240307',
          input_tokens: 2000,
          output_tokens: 1000,
        }],
      },
      rates: RATES,
    });
    // (2000/1000)*0.00025 + (1000/1000)*0.00125 = 0.0005 + 0.00125 = 0.00175
    expect(r.lines[0].total_usd).toBeCloseTo(0.00175, 10);
  });

  test('tolerant: rows missing period_day OR model are skipped with warnings (not thrown)', () => {
    const r = normalizeAnthropicBillingExport({
      payload: {
        line_items: [
          { model: 'claude-3-haiku-20240307', input_tokens: 100 }, // no period_day
          { period_day: '2026-05-19', input_tokens: 100 },          // no model
          { period_day: '2026-05-19', model: 'claude-3-haiku-20240307', input_tokens: 100, output_tokens: 50 },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings).toHaveLength(2);
    expect(r.lines).toHaveLength(1);
  });

  test('determinism: identical payload → identical result', () => {
    const payload = {
      line_items: [{
        period_day: '2026-05-19',
        model: 'claude-3-5-sonnet-20240620',
        input_tokens: 100, output_tokens: 50, amount_usd: 0.5,
      }],
    };
    const a = normalizeAnthropicBillingExport({ payload, rates: RATES });
    const b = normalizeAnthropicBillingExport({ payload, rates: RATES });
    expect(b).toEqual(a);
  });
});

describe('anthropicAdapter.normalizeAnthropicMessagesUsage — rollup + bucketing', () => {
  test('aggregates per (day, model, org); deterministic USD from rates', () => {
    const r = normalizeAnthropicMessagesUsage({
      payload: {
        entries: [
          // Two events for org-1 same day same model → bucketed.
          { created_at: '2026-05-19T10:00:00Z', model: 'claude-3-5-sonnet-20240620',
            usage: { input_tokens: 1000, output_tokens: 500 }, organization_id: 'org-1' },
          { created_at: '2026-05-19T22:00:00Z', model: 'claude-3-5-sonnet-20240620',
            usage: { input_tokens: 500, output_tokens: 250 }, organization_id: 'org-1' },
          // Different org → separate bucket.
          { created_at: '2026-05-19T11:00:00Z', model: 'claude-3-5-sonnet-20240620',
            usage: { input_tokens: 200, output_tokens: 100 }, organization_id: 'org-2' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(ANTHROPIC_ADAPTER_VERSION_USAGE);
    expect(r.lines).toHaveLength(2);
    const org1 = r.lines.find(l => l.provider_org_id === 'org-1')!;
    const org2 = r.lines.find(l => l.provider_org_id === 'org-2')!;
    expect(org1.n_requests).toBe(2);
    expect(org1.input_tokens).toBe(1500);
    expect(org1.output_tokens).toBe(750);
    // (1500/1000)*0.003 + (750/1000)*0.015 = 0.0045 + 0.01125 = 0.01575
    expect(org1.total_usd).toBeCloseTo(0.01575, 10);
    expect(org2.n_requests).toBe(1);
  });

  test('tolerant: entries missing created_at OR model are skipped with warnings', () => {
    const r = normalizeAnthropicMessagesUsage({
      payload: {
        entries: [
          { model: 'claude-3-5-sonnet-20240620', usage: { input_tokens: 100, output_tokens: 50 } },
          { created_at: '2026-05-19T00:00:00Z', usage: { input_tokens: 100, output_tokens: 50 } },
          { created_at: '2026-05-19T00:00:00Z', model: 'claude-3-haiku-20240307',
            usage: { input_tokens: 100, output_tokens: 50 } },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings).toHaveLength(2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].model).toBe('claude-3-haiku-20240307');
  });

  test('determinism: identical payload → identical result and stable ordering', () => {
    const payload = {
      entries: [
        { created_at: '2026-05-19', model: 'claude-3-haiku-20240307', usage: { input_tokens: 1, output_tokens: 1 }, organization_id: 'b' },
        { created_at: '2026-05-19', model: 'claude-3-haiku-20240307', usage: { input_tokens: 1, output_tokens: 1 }, organization_id: 'a' },
      ],
    };
    const r = normalizeAnthropicMessagesUsage({ payload, rates: RATES });
    expect(r.lines.map(l => l.provider_org_id)).toEqual(['a', 'b']);
  });
});

describe('reconcileProviderInvoice — works for provider=anthropic (same matcher core)', () => {
  test('matched bucket: pro-rata variance across orgs; provider tag is anthropic', () => {
    const invoiceLines = [{
      period_day: '2026-05-19',
      kind: 'completion' as const,
      model: 'claude-3-5-sonnet-20240620',
      n_requests: 5, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
      provider_org_id: 'wsp-abc', total_usd: 1.00,
    }];
    const r = reconcileProviderInvoice({
      provider: 'anthropic',
      invoiceLines,
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'claude-3-5-sonnet-20240620', estimated_usd: 0.60 },
        { organization_id: 'org-B', period_day: '2026-05-19', model: 'claude-3-5-sonnet-20240620', estimated_usd: 0.40 },
      ],
    });
    expect(r.adjustments.every(a => a.provider === 'anthropic')).toBe(true);
    expect(r.totals.estimated_usd_sum).toBeCloseTo(1.0, 8);
    expect(r.totals.actual_usd_sum).toBeCloseTo(1.0, 8);
    // Exact match → severity 'none' → reason 'rounding' for both org rows.
    expect(r.adjustments.every(a => a.reason === 'rounding')).toBe(true);
  });

  test("missing_attribution: anthropic invoice, no customer usage → platform-level row tagged 'anthropic'", () => {
    const r = reconcileProviderInvoice({
      provider: 'anthropic',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'completion', model: 'claude-3-haiku-20240307',
        n_requests: 1, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
        provider_org_id: null, total_usd: 0.25,
      }],
      usageAggregates: [],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('anthropic');
    expect(r.adjustments[0].reason).toBe('missing_attribution');
    expect(r.adjustments[0].organization_id).toBeNull();
    expect(r.adjustments[0].actual_usd).toBeCloseTo(0.25, 8);
  });

  test('missing_provider_event: customer anthropic usage, no invoice row → negative platform adjustment', () => {
    const r = reconcileProviderInvoice({
      provider: 'anthropic',
      invoiceLines: [],
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'claude-3-5-sonnet-20240620', estimated_usd: 0.15 },
      ],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('anthropic');
    expect(r.adjustments[0].reason).toBe('missing_provider_event');
    expect(r.adjustments[0].adjustment_usd).toBeCloseTo(-0.15, 8);
  });

  test('replay determinism: identical inputs → identical adjustment set/order/values', () => {
    const args = {
      provider: 'anthropic',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'completion' as const, model: 'claude-3-5-sonnet-20240620',
        n_requests: 1, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
        provider_org_id: null, total_usd: 0.50,
      }],
      usageAggregates: [
        { organization_id: 'org-2', period_day: '2026-05-19', model: 'claude-3-5-sonnet-20240620', estimated_usd: 0.25 },
        { organization_id: 'org-1', period_day: '2026-05-19', model: 'claude-3-5-sonnet-20240620', estimated_usd: 0.25 },
      ],
    };
    const r1 = reconcileProviderInvoice(args);
    const r2 = reconcileProviderInvoice(args);
    expect(r2).toEqual(r1);
    expect(r1.adjustments.map(a => a.organization_id)).toEqual(['org-1', 'org-2']);
  });
});
