/**
 * Image reconciliation — pure-module tests (no DB).
 * Covers all three normalizers (DALL·E standalone, generic image usage,
 * generic image billing), tolerant parsing, determinism, and matcher
 * integration via reconcileProviderInvoice (provider='openai_image' / 'image:*').
 */

import {
  normalizeDalleUsageExport,
  normalizeImageUsageExport,
  normalizeImageBillingExport,
  IMAGE_ADAPTER_VERSION_BILLING,
  IMAGE_ADAPTER_VERSION_DALLE,
  IMAGE_ADAPTER_VERSION_USAGE,
} from '../../services/billing/reconciliation/imageAdapter';
import { reconcileProviderInvoice } from '../../services/billing/reconciliation/reconciliationMatcher';
import type { RateTable } from '../../services/billing/reconciliation/openaiAdapter';

const RATES: RateTable = {
  images: {
    'dall-e-3':    { per_image: 0.04 },
    'gpt-image-1': { per_image: 0.02 },
    'imagen-3':    { per_image: 0.03 },
    'stable-xl':   { per_image: 0.01 },
  },
  defaultImage: { per_image: 0.04 },
};

// DALL·E timestamps are epoch-seconds. Derive deterministically.
const TS_2026_05_19 = Math.floor(Date.UTC(2026, 4, 19, 0, 0, 0) / 1000);

describe('imageAdapter.normalizeDalleUsageExport — pure / tolerant', () => {
  test('aggregates per (day, model, org); USD = count × per_image', () => {
    const r = normalizeDalleUsageExport({
      payload: {
        dalle_api_data: [
          { timestamp: TS_2026_05_19, image_models: 'dall-e-3', num_images: 5, num_requests: 5, organization_id: 'org-1' },
          { timestamp: TS_2026_05_19, image_models: 'dall-e-3', num_images: 3, num_requests: 3, organization_id: 'org-1' },
          { timestamp: TS_2026_05_19, image_models: 'gpt-image-1', num_images: 10, num_requests: 5, organization_id: 'org-2' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(IMAGE_ADAPTER_VERSION_DALLE);
    expect(r.warnings).toEqual([]);
    expect(r.lines).toHaveLength(2);
    const o1 = r.lines.find(l => l.model === 'dall-e-3')!;
    expect(o1.image_count).toBe(8);
    expect(o1.n_requests).toBe(8);
    // 8 × 0.04 = 0.32
    expect(o1.total_usd).toBeCloseTo(0.32, 10);
    expect(o1.provider_org_id).toBe('org-1');
    const o2 = r.lines.find(l => l.model === 'gpt-image-1')!;
    expect(o2.image_count).toBe(10);
    // 10 × 0.02 = 0.20
    expect(o2.total_usd).toBeCloseTo(0.20, 10);
  });

  test('tolerant: rows missing timestamp OR image_count are skipped with warnings', () => {
    const r = normalizeDalleUsageExport({
      payload: {
        dalle_api_data: [
          { image_models: 'dall-e-3', num_images: 1 },                      // no timestamp
          { timestamp: TS_2026_05_19, image_models: 'dall-e-3' },           // no count
          { timestamp: TS_2026_05_19, image_models: 'dall-e-3', num_images: 1 },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings.length).toBe(2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].image_count).toBe(1);
  });

  test('determinism: identical payload → identical result with stable ordering', () => {
    const payload = {
      dalle_api_data: [
        { timestamp: TS_2026_05_19, image_models: 'dall-e-3', num_images: 1, organization_id: 'b' },
        { timestamp: TS_2026_05_19, image_models: 'dall-e-3', num_images: 1, organization_id: 'a' },
      ],
    };
    const a = normalizeDalleUsageExport({ payload, rates: RATES });
    const b = normalizeDalleUsageExport({ payload, rates: RATES });
    expect(b).toEqual(a);
    expect(a.lines.map(l => l.provider_org_id)).toEqual(['a', 'b']);
  });
});

describe('imageAdapter.normalizeImageUsageExport — generic rollup', () => {
  test('aggregates per (day, model, org); resolution/quality preserved but not in bucket key', () => {
    const r = normalizeImageUsageExport({
      payload: {
        entries: [
          { date: '2026-05-19', model: 'imagen-3', image_count: 2, resolution: '1024x1024', quality: 'standard', organization_id: 'org-1' },
          { date: '2026-05-19', model: 'imagen-3', image_count: 1, resolution: '1024x1024', quality: 'hd',       organization_id: 'org-1' },
          { date: '2026-05-19', model: 'stable-xl', image_count: 5, account_id: 'org-2' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(IMAGE_ADAPTER_VERSION_USAGE);
    expect(r.lines).toHaveLength(2);
    const im = r.lines.find(l => l.model === 'imagen-3')!;
    expect(im.image_count).toBe(3); // 2 + 1 collapsed (resolution/quality do NOT split bucket)
    // 3 × 0.03 = 0.09
    expect(im.total_usd).toBeCloseTo(0.09, 10);
    const stab = r.lines.find(l => l.model === 'stable-xl')!;
    expect(stab.image_count).toBe(5);
    // 5 × 0.01 = 0.05
    expect(stab.total_usd).toBeCloseTo(0.05, 10);
    expect(stab.provider_org_id).toBe('org-2'); // account_id → org
  });

  test('explicit amount_usd is authoritative over rate-derived', () => {
    const r = normalizeImageUsageExport({
      payload: {
        entries: [
          { date: '2026-05-19', model: 'imagen-3', image_count: 10,
            organization_id: 'org-X', amount_usd: 0.99 },
        ],
      },
      rates: RATES,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].total_usd).toBe(0.99); // explicit, not 10 × 0.03 = 0.30
  });

  test('tolerant: entries missing date/model/count → skipped with warnings', () => {
    const r = normalizeImageUsageExport({
      payload: {
        entries: [
          { model: 'imagen-3', image_count: 1 },                  // no date
          { date: '2026-05-19', image_count: 1 },                  // no model
          { date: '2026-05-19', model: 'imagen-3' },               // no count
          { date: '2026-05-19', model: 'imagen-3', image_count: 1 },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings.length).toBe(3);
    expect(r.lines).toHaveLength(1);
  });
});

describe('imageAdapter.normalizeImageBillingExport — provider-agnostic billing', () => {
  test('amount_usd authoritative when present; count-rate fallback when absent', () => {
    const r = normalizeImageBillingExport({
      payload: {
        line_items: [
          { period_day: '2026-05-19', model: 'dall-e-3', image_count: 5, amount_usd: 0.20, organization_id: 'org-A' },
          { period_day: '2026-05-19', model: 'gpt-image-1', image_count: 10, organization_id: 'org-B' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(IMAGE_ADAPTER_VERSION_BILLING);
    expect(r.lines).toHaveLength(2);
    const a = r.lines.find(l => l.provider_org_id === 'org-A')!;
    expect(a.total_usd).toBe(0.20); // explicit
    const b = r.lines.find(l => l.provider_org_id === 'org-B')!;
    // 10 × 0.02 = 0.20 (rate-derived)
    expect(b.total_usd).toBeCloseTo(0.20, 10);
  });

  test('tolerant: missing period_day, model, OR count → skipped', () => {
    const r = normalizeImageBillingExport({
      payload: {
        line_items: [
          { model: 'dall-e-3', image_count: 1 },                  // no period_day
          { period_day: '2026-05-19', image_count: 1 },            // no model
          { period_day: '2026-05-19', model: 'dall-e-3' },         // no count
          { period_day: '2026-05-19', model: 'dall-e-3', image_count: 1 },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings.length).toBe(3);
    expect(r.lines).toHaveLength(1);
  });

  test('determinism: identical input → identical normalized output', () => {
    const payload = {
      line_items: [
        { period_day: '2026-05-19', model: 'dall-e-3', image_count: 1, organization_id: 'b' },
        { period_day: '2026-05-19', model: 'dall-e-3', image_count: 1, organization_id: 'a' },
      ],
    };
    const a = normalizeImageBillingExport({ payload, rates: RATES });
    const b = normalizeImageBillingExport({ payload, rates: RATES });
    expect(b).toEqual(a);
    expect(a.lines.map(l => l.provider_org_id)).toEqual(['a', 'b']);
  });
});

describe('reconcileProviderInvoice — works for image (openai_image + image:imagen)', () => {
  test('matched bucket pro-rata: openai_image provider tag carried through', () => {
    const r = reconcileProviderInvoice({
      provider: 'openai_image',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'image', model: 'dall-e-3',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0,
        audio_seconds: 0, provider_org_id: null, total_usd: 0.40,
      }],
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'dall-e-3', estimated_usd: 0.16 },
        { organization_id: 'org-B', period_day: '2026-05-19', model: 'dall-e-3', estimated_usd: 0.24 },
      ],
    });
    expect(r.adjustments).toHaveLength(2);
    expect(r.adjustments.every(a => a.provider === 'openai_image')).toBe(true);
    expect(r.totals.actual_usd_sum).toBeCloseTo(0.40, 8);
    expect(r.adjustments.every(a => a.reason === 'rounding')).toBe(true); // exact match
  });

  test('missing_attribution: image invoice spend, no customer usage → platform-level row', () => {
    const r = reconcileProviderInvoice({
      provider: 'openai_image',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'image', model: 'dall-e-3',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0,
        audio_seconds: 0, provider_org_id: null, total_usd: 0.40,
      }],
      usageAggregates: [],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('openai_image');
    expect(r.adjustments[0].reason).toBe('missing_attribution');
    expect(r.adjustments[0].organization_id).toBeNull();
    expect(r.adjustments[0].actual_usd).toBeCloseTo(0.40, 8);
  });

  test('missing_provider_event: customer image usage with no invoice → negative platform delta', () => {
    const r = reconcileProviderInvoice({
      provider: 'image:imagen',
      invoiceLines: [],
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'imagen-3', estimated_usd: 0.09 },
      ],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('image:imagen');
    expect(r.adjustments[0].reason).toBe('missing_provider_event');
    expect(r.adjustments[0].adjustment_usd).toBeCloseTo(-0.09, 8);
  });

  test('replay determinism: identical inputs → identical adjustment set/order/values', () => {
    const args = {
      provider: 'openai_image',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'image' as const, model: 'dall-e-3',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0,
        audio_seconds: 0, provider_org_id: null, total_usd: 0.40,
      }],
      usageAggregates: [
        { organization_id: 'org-2', period_day: '2026-05-19', model: 'dall-e-3', estimated_usd: 0.20 },
        { organization_id: 'org-1', period_day: '2026-05-19', model: 'dall-e-3', estimated_usd: 0.20 },
      ],
    };
    const r1 = reconcileProviderInvoice(args);
    const r2 = reconcileProviderInvoice(args);
    expect(r2).toEqual(r1);
    expect(r1.adjustments.map(a => a.organization_id)).toEqual(['org-1', 'org-2']);
  });
});
