/**
 * OpenAI reconciliation — pure-module tests (no DB).
 * Covers: normalizer determinism + tolerant parsing, matcher correctness
 * (bucket aggregation, pro-rata, missing_attribution, missing_provider_event),
 * variance integration, and replay determinism.
 */

import {
  normalizeOpenAiUsageExport,
  OPENAI_ADAPTER_VERSION,
  type RateTable,
} from '../../services/billing/reconciliation/openaiAdapter';
import { reconcileOpenAi } from '../../services/billing/reconciliation/reconciliationMatcher';

const RATES: RateTable = {
  tokens: {
    'gpt-4o-mini': { in_per_1k: 0.00015, out_per_1k: 0.00060 },
    'gpt-4o':      { in_per_1k: 0.00250, out_per_1k: 0.01000 },
  },
  defaultToken: { in_per_1k: 0.0002, out_per_1k: 0.0008 },
  images: { 'dall-e-3': { per_image: 0.04 } },
  audio:  { 'whisper-1': { per_minute: 0.006 } },
};

// Derived (not hand-calculated) so the assertion strings stay in sync.
const TS_DAY_A = Math.floor(Date.UTC(2026, 4, 19, 0, 0, 0) / 1000); // 2026-05-19 UTC
const TS_DAY_B = Math.floor(Date.UTC(2026, 4, 20, 0, 0, 0) / 1000); // 2026-05-20 UTC
void TS_DAY_B;

describe('openaiAdapter.normalizeOpenAiUsageExport — pure / tolerant', () => {
  test('completions + embeddings + dalle + whisper → normalized with deterministic USD', () => {
    const payload = {
      data: [
        { aggregation_timestamp: TS_DAY_A, n_requests: 10, operation: 'completion',
          snapshot_id: 'gpt-4o-mini', n_context_tokens_total: 1000, n_generated_tokens_total: 500,
          organization_id: 'org-abc' },
      ],
      embeddings_data: [
        { aggregation_timestamp: TS_DAY_A, n_requests: 4, snapshot_id: 'gpt-4o-mini',
          n_context_tokens_total: 2000, organization_id: 'org-abc' },
      ],
      dalle_api_data: [
        { timestamp: TS_DAY_A, image_models: 'dall-e-3', num_images: 2, num_requests: 2 },
      ],
      whisper_api_data: [
        { timestamp: TS_DAY_A, model_id: 'whisper-1', num_seconds: 120, num_requests: 1 },
      ],
    };
    const r = normalizeOpenAiUsageExport({ payload, rates: RATES });
    expect(r.adapter_version).toBe(OPENAI_ADAPTER_VERSION);
    expect(r.warnings).toEqual([]);
    expect(r.lines).toHaveLength(4);
    const byKind = Object.fromEntries(r.lines.map(l => [l.kind, l]));
    expect(byKind.completion.total_usd).toBeCloseTo(1 * 0.00015 + 0.5 * 0.00060, 10);
    expect(byKind.embedding.total_usd).toBeCloseTo(2 * 0.00015, 10);
    expect(byKind.image.total_usd).toBeCloseTo(2 * 0.04, 10);
    expect(byKind.transcription.total_usd).toBeCloseTo((120 / 60) * 0.006, 10);
    expect(byKind.completion.period_day).toBe('2026-05-19');
  });

  test('tolerant: missing timestamp / snapshot rows are skipped with warnings, not thrown', () => {
    const payload = {
      data: [
        { n_requests: 1, snapshot_id: 'gpt-4o' }, // missing aggregation_timestamp
        { aggregation_timestamp: TS_DAY_A, n_requests: 1 }, // missing snapshot_id
        { aggregation_timestamp: TS_DAY_A, snapshot_id: 'gpt-4o', n_requests: 1,
          n_context_tokens_total: 100, n_generated_tokens_total: 50, organization_id: null },
      ],
    };
    const r = normalizeOpenAiUsageExport({ payload, rates: RATES });
    expect(r.warnings.length).toBe(2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].model).toBe('gpt-4o');
  });

  test('determinism: same payload → identical result', () => {
    const payload = {
      data: [{ aggregation_timestamp: TS_DAY_A, n_requests: 1, snapshot_id: 'gpt-4o-mini',
               n_context_tokens_total: 100, n_generated_tokens_total: 50 }],
    };
    const a = normalizeOpenAiUsageExport({ payload, rates: RATES });
    const b = normalizeOpenAiUsageExport({ payload, rates: RATES });
    expect(b).toEqual(a);
  });
});

describe('reconciliationMatcher.reconcileOpenAi — pure', () => {
  test('matched bucket: pro-rata variance across orgs by estimated share', () => {
    // Invoice says $1.00 for gpt-4o-mini on day A.
    const invoiceLines = [{
      period_day: '2026-05-19', kind: 'completion' as const, model: 'gpt-4o-mini',
      n_requests: 10, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
      provider_org_id: 'org-abc', total_usd: 1.00,
    }];
    // Our customers estimated $0.50 (org-1: $0.30, org-2: $0.20).
    const usage = [
      { organization_id: 'org-1', period_day: '2026-05-19', model: 'gpt-4o-mini', estimated_usd: 0.30, ledger_hold_transaction_id: 'h1' },
      { organization_id: 'org-2', period_day: '2026-05-19', model: 'gpt-4o-mini', estimated_usd: 0.20, ledger_hold_transaction_id: 'h2' },
    ];
    const r = reconcileOpenAi({ provider: 'openai', invoiceLines, usageAggregates: usage });
    expect(r.totals.estimated_usd_sum).toBeCloseTo(0.5, 8);
    expect(r.totals.actual_usd_sum).toBeCloseTo(1.0, 8);
    // Two org-scoped adjustments summing to the bucket variance (0.5 underestimate).
    const orgAdj = r.adjustments.filter(a => a.organization_id !== null);
    expect(orgAdj).toHaveLength(2);
    const sum = orgAdj.reduce((s, a) => s + a.adjustment_usd, 0);
    expect(sum).toBeCloseTo(0.5, 8);
    // Pro-rata: org-1 share=0.6, org-2 share=0.4 → adjustments 0.3 and 0.2.
    const a1 = orgAdj.find(a => a.organization_id === 'org-1')!;
    const a2 = orgAdj.find(a => a.organization_id === 'org-2')!;
    expect(a1.adjustment_usd).toBeCloseTo(0.30, 8);
    expect(a2.adjustment_usd).toBeCloseTo(0.20, 8);
    // Severity high (100% drift) ⇒ reason 'variance' (not 'rounding').
    expect(a1.reason).toBe('variance');
    expect(a1.severity).toBe('high');
    expect(a1.ledger_hold_transaction_id).toBe('h1');
  });

  test("missing_attribution: invoice present, no customer usage → platform-level row", () => {
    const r = reconcileOpenAi({
      provider: 'openai',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'completion', model: 'gpt-4o',
        n_requests: 1, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
        provider_org_id: 'org-abc', total_usd: 2.50,
      }],
      usageAggregates: [],
    });
    expect(r.adjustments).toHaveLength(1);
    const a = r.adjustments[0];
    expect(a.organization_id).toBeNull();
    expect(a.reason).toBe('missing_attribution');
    expect(a.actual_usd).toBeCloseTo(2.5, 8);
    expect(a.estimated_usd).toBe(0);
  });

  test('missing_provider_event: customer usage exists, no invoice row → platform-level row with negative delta', () => {
    const r = reconcileOpenAi({
      provider: 'openai',
      invoiceLines: [],
      usageAggregates: [
        { organization_id: 'org-1', period_day: '2026-05-19', model: 'gpt-4o-mini', estimated_usd: 0.10 },
      ],
    });
    expect(r.adjustments).toHaveLength(1);
    const a = r.adjustments[0];
    expect(a.organization_id).toBeNull();
    expect(a.reason).toBe('missing_provider_event');
    expect(a.adjustment_usd).toBeCloseTo(-0.10, 8);
    expect(a.severity).toBe('high'); // estimated>0, actual=0 → 100% drift
  });

  test('determinism: identical inputs → identical adjustment ordering & values', () => {
    const invoiceLines = [{
      period_day: '2026-05-19', kind: 'completion' as const, model: 'gpt-4o-mini',
      n_requests: 1, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
      provider_org_id: null, total_usd: 0.50,
    }];
    const usage = [
      { organization_id: 'org-2', period_day: '2026-05-19', model: 'gpt-4o-mini', estimated_usd: 0.25 },
      { organization_id: 'org-1', period_day: '2026-05-19', model: 'gpt-4o-mini', estimated_usd: 0.25 },
    ];
    const r1 = reconcileOpenAi({ provider: 'openai', invoiceLines, usageAggregates: usage });
    const r2 = reconcileOpenAi({ provider: 'openai', invoiceLines, usageAggregates: usage });
    expect(r2).toEqual(r1);
    // Stable org order by sorted id.
    expect(r1.adjustments.map(a => a.organization_id)).toEqual(['org-1', 'org-2']);
  });

  test('rounding-band variance is labeled `rounding`, not `variance`', () => {
    // 1% drift → severity 'none' → reason 'rounding'.
    const r = reconcileOpenAi({
      provider: 'openai',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'completion', model: 'gpt-4o',
        n_requests: 1, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0,
        provider_org_id: null, total_usd: 1.01,
      }],
      usageAggregates: [
        { organization_id: 'org-1', period_day: '2026-05-19', model: 'gpt-4o', estimated_usd: 1.00 },
      ],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].reason).toBe('rounding');
    expect(r.adjustments[0].severity).toBe('none');
  });

  test('multi-bucket: variance computed independently per (day, model)', () => {
    const r = reconcileOpenAi({
      provider: 'openai',
      invoiceLines: [
        { period_day: '2026-05-19', kind: 'completion', model: 'gpt-4o-mini', n_requests: 1, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0, provider_org_id: null, total_usd: 1 },
        { period_day: '2026-05-20', kind: 'completion', model: 'gpt-4o',      n_requests: 1, input_tokens: 0, output_tokens: 0, image_count: 0, audio_seconds: 0, provider_org_id: null, total_usd: 2 },
      ],
      usageAggregates: [
        { organization_id: 'org-1', period_day: '2026-05-19', model: 'gpt-4o-mini', estimated_usd: 1 },
        { organization_id: 'org-1', period_day: '2026-05-20', model: 'gpt-4o',      estimated_usd: 1 },
      ],
    });
    expect(r.buckets).toHaveLength(2);
    expect(r.totals.estimated_usd_sum).toBeCloseTo(2, 8);
    expect(r.totals.actual_usd_sum).toBeCloseTo(3, 8);
  });
});
