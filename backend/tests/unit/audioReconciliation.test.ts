/**
 * Audio reconciliation — pure-module tests (no DB).
 * Covers all three normalizers (Whisper standalone, AssemblyAI rollup,
 * generic audio billing), mixed duration units (s/min/hr/ms), tolerant
 * parsing, determinism, and matcher integration via the generic
 * reconcileProviderInvoice (provider='openai_audio' | 'assemblyai').
 */

import {
  normalizeWhisperUsageExport,
  normalizeAssemblyAiUsageExport,
  normalizeAudioBillingExport,
  AUDIO_ADAPTER_VERSION_WHISPER,
  AUDIO_ADAPTER_VERSION_ASSEMBLYAI,
  AUDIO_ADAPTER_VERSION_BILLING,
} from '../../services/billing/reconciliation/audioAdapter';
import { reconcileProviderInvoice } from '../../services/billing/reconciliation/reconciliationMatcher';
import type { RateTable } from '../../services/billing/reconciliation/openaiAdapter';

const RATES: RateTable = {
  audio: {
    'whisper-1':              { per_minute: 0.006 },
    'assemblyai-transcript':  { per_minute: 0.0062 },
    'assemblyai-best':        { per_minute: 0.015 },
  },
  defaultAudio: { per_minute: 0.005 },
};

// Whisper-style timestamps are epoch-seconds. Derive deterministically so the
// fixture date matches whatever the local TZ behavior is at parse time.
const TS_2026_05_19 = Math.floor(Date.UTC(2026, 4, 19, 0, 0, 0) / 1000);

describe('audioAdapter.normalizeWhisperUsageExport — pure / tolerant', () => {
  test('aggregates per (day, model, org); USD computed from rate (per_minute × seconds/60)', () => {
    const r = normalizeWhisperUsageExport({
      payload: {
        whisper_api_data: [
          { timestamp: TS_2026_05_19, model_id: 'whisper-1', num_seconds: 60, num_requests: 1, organization_id: 'org-1' },
          { timestamp: TS_2026_05_19, model_id: 'whisper-1', num_seconds: 30, num_requests: 1, organization_id: 'org-1' },
          { timestamp: TS_2026_05_19, model_id: 'whisper-1', num_seconds: 120, num_requests: 1, organization_id: 'org-2' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(AUDIO_ADAPTER_VERSION_WHISPER);
    expect(r.warnings).toEqual([]);
    expect(r.lines).toHaveLength(2);
    const o1 = r.lines.find(l => l.provider_org_id === 'org-1')!;
    const o2 = r.lines.find(l => l.provider_org_id === 'org-2')!;
    expect(o1.audio_seconds).toBe(90);
    expect(o1.n_requests).toBe(2);
    // 90/60 * 0.006 = 0.009
    expect(o1.total_usd).toBeCloseTo(0.009, 10);
    expect(o2.audio_seconds).toBe(120);
    // 120/60 * 0.006 = 0.012
    expect(o2.total_usd).toBeCloseTo(0.012, 10);
  });

  test('tolerant: rows missing timestamp OR duration are skipped with warnings', () => {
    const r = normalizeWhisperUsageExport({
      payload: {
        whisper_api_data: [
          { model_id: 'whisper-1', num_seconds: 60 },                       // no timestamp
          { timestamp: TS_2026_05_19, model_id: 'whisper-1' },              // no duration
          { timestamp: TS_2026_05_19, model_id: 'whisper-1', num_seconds: 30 },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings.length).toBe(2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].audio_seconds).toBe(30);
  });

  test('determinism: identical payload → identical result with stable ordering', () => {
    const payload = {
      whisper_api_data: [
        { timestamp: TS_2026_05_19, model_id: 'whisper-1', num_seconds: 10, organization_id: 'b' },
        { timestamp: TS_2026_05_19, model_id: 'whisper-1', num_seconds: 10, organization_id: 'a' },
      ],
    };
    const r1 = normalizeWhisperUsageExport({ payload, rates: RATES });
    const r2 = normalizeWhisperUsageExport({ payload, rates: RATES });
    expect(r2).toEqual(r1);
    expect(r1.lines.map(l => l.provider_org_id)).toEqual(['a', 'b']);
  });
});

describe('audioAdapter.normalizeAssemblyAiUsageExport — rollup + mixed duration units', () => {
  test('aggregates per (day, model, org); supports minutes/hours/seconds inputs', () => {
    const r = normalizeAssemblyAiUsageExport({
      payload: {
        entries: [
          { date: '2026-05-19', model: 'assemblyai-transcript', minutes: 10, n_requests: 5, organization_id: 'org-1' },
          { date: '2026-05-19', model: 'assemblyai-transcript', hours: 0.5, n_requests: 2, organization_id: 'org-1' },
          { date: '2026-05-19', model: 'assemblyai-best',       seconds: 600, account_id: 'org-2' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(AUDIO_ADAPTER_VERSION_ASSEMBLYAI);
    expect(r.warnings).toEqual([]);
    expect(r.lines).toHaveLength(2);
    const o1 = r.lines.find(l => l.model === 'assemblyai-transcript')!;
    expect(o1.audio_seconds).toBe(10 * 60 + 0.5 * 3600); // 600 + 1800 = 2400
    expect(o1.n_requests).toBe(7);
    // 2400/60 * 0.0062 = 0.248
    expect(o1.total_usd).toBeCloseTo(0.248, 10);
    const o2 = r.lines.find(l => l.model === 'assemblyai-best')!;
    expect(o2.audio_seconds).toBe(600);
    // 600/60 * 0.015 = 0.150
    expect(o2.total_usd).toBeCloseTo(0.150, 10);
    expect(o2.provider_org_id).toBe('org-2'); // account_id → org bucket
  });

  test('explicit amount_usd is authoritative over rate-derived', () => {
    const r = normalizeAssemblyAiUsageExport({
      payload: {
        entries: [
          { date: '2026-05-19', model: 'assemblyai-transcript', minutes: 100,
            organization_id: 'wsp-x', amount_usd: 0.99 },
        ],
      },
      rates: RATES,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].total_usd).toBe(0.99);
    expect(r.lines[0].audio_seconds).toBe(6000);
  });

  test('tolerant: missing date OR duration → row skipped', () => {
    const r = normalizeAssemblyAiUsageExport({
      payload: {
        entries: [
          { model: 'assemblyai-transcript', minutes: 1 },                       // no date
          { date: '2026-05-19', model: 'assemblyai-transcript' },                // no duration
          { date: '2026-05-19', model: 'assemblyai-transcript', seconds: 5 },
        ],
      },
      rates: RATES,
    });
    expect(r.warnings.length).toBe(2);
    expect(r.lines).toHaveLength(1);
  });
});

describe('audioAdapter.normalizeAudioBillingExport — provider-agnostic dollar-denominated', () => {
  test('amount_usd is authoritative; duration_ms accepted', () => {
    const r = normalizeAudioBillingExport({
      payload: {
        line_items: [
          { period_day: '2026-05-19', model: 'whisper-1', duration_ms: 60_000,
            n_requests: 1, amount_usd: 0.50, organization_id: 'org-A' },
        ],
      },
      rates: RATES,
    });
    expect(r.adapter_version).toBe(AUDIO_ADAPTER_VERSION_BILLING);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].total_usd).toBe(0.50);  // explicit, NOT rate-derived
    expect(r.lines[0].audio_seconds).toBe(60); // duration_ms → seconds
  });

  test('rate-derived when amount_usd absent', () => {
    const r = normalizeAudioBillingExport({
      payload: {
        line_items: [
          { period_day: '2026-05-19', model: 'assemblyai-transcript', audio_seconds: 300, organization_id: 'org-A' },
        ],
      },
      rates: RATES,
    });
    // 300/60 * 0.0062 = 0.031
    expect(r.lines[0].total_usd).toBeCloseTo(0.031, 10);
  });

  test('tolerant: lines missing period_day, model, or duration → skipped with warnings', () => {
    const r = normalizeAudioBillingExport({
      payload: {
        line_items: [
          { model: 'whisper-1', audio_seconds: 60 },                            // no period_day
          { period_day: '2026-05-19', audio_seconds: 60 },                       // no model
          { period_day: '2026-05-19', model: 'whisper-1' },                      // no duration
          { period_day: '2026-05-19', model: 'whisper-1', audio_seconds: 60 },   // valid
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
        { period_day: '2026-05-19', model: 'whisper-1', audio_seconds: 60, organization_id: 'b' },
        { period_day: '2026-05-19', model: 'whisper-1', audio_seconds: 60, organization_id: 'a' },
      ],
    };
    const a = normalizeAudioBillingExport({ payload, rates: RATES });
    const b = normalizeAudioBillingExport({ payload, rates: RATES });
    expect(b).toEqual(a);
    expect(a.lines.map(l => l.provider_org_id)).toEqual(['a', 'b']);
  });
});

describe('reconcileProviderInvoice — works for audio (openai_audio + assemblyai)', () => {
  test('matched bucket pro-rata: openai_audio provider tag carried through', () => {
    const r = reconcileProviderInvoice({
      provider: 'openai_audio',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'transcription', model: 'whisper-1',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0,
        audio_seconds: 0, provider_org_id: null, total_usd: 1.00,
      }],
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'whisper-1', estimated_usd: 0.40 },
        { organization_id: 'org-B', period_day: '2026-05-19', model: 'whisper-1', estimated_usd: 0.60 },
      ],
    });
    expect(r.adjustments).toHaveLength(2);
    expect(r.adjustments.every(a => a.provider === 'openai_audio')).toBe(true);
    expect(r.totals.actual_usd_sum).toBeCloseTo(1.0, 8);
    // exact match (estimated_sum == actual_sum) → severity 'none' → reason 'rounding'
    expect(r.adjustments.every(a => a.reason === 'rounding')).toBe(true);
  });

  test('missing_attribution: assemblyai invoice spend, no customer usage → platform-level row', () => {
    const r = reconcileProviderInvoice({
      provider: 'assemblyai',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'transcription', model: 'assemblyai-transcript',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0,
        audio_seconds: 0, provider_org_id: null, total_usd: 0.25,
      }],
      usageAggregates: [],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('assemblyai');
    expect(r.adjustments[0].reason).toBe('missing_attribution');
    expect(r.adjustments[0].organization_id).toBeNull();
    expect(r.adjustments[0].actual_usd).toBeCloseTo(0.25, 8);
  });

  test('missing_provider_event: customer audio usage with no invoice → negative platform delta', () => {
    const r = reconcileProviderInvoice({
      provider: 'openai_audio',
      invoiceLines: [],
      usageAggregates: [
        { organization_id: 'org-A', period_day: '2026-05-19', model: 'whisper-1', estimated_usd: 0.05 },
      ],
    });
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].provider).toBe('openai_audio');
    expect(r.adjustments[0].reason).toBe('missing_provider_event');
    expect(r.adjustments[0].adjustment_usd).toBeCloseTo(-0.05, 8);
  });

  test('replay determinism: identical inputs → identical adjustment set/order/values', () => {
    const args = {
      provider: 'assemblyai',
      invoiceLines: [{
        period_day: '2026-05-19', kind: 'transcription' as const, model: 'assemblyai-transcript',
        n_requests: 0, input_tokens: 0, output_tokens: 0, image_count: 0,
        audio_seconds: 0, provider_org_id: null, total_usd: 0.50,
      }],
      usageAggregates: [
        { organization_id: 'org-2', period_day: '2026-05-19', model: 'assemblyai-transcript', estimated_usd: 0.25 },
        { organization_id: 'org-1', period_day: '2026-05-19', model: 'assemblyai-transcript', estimated_usd: 0.25 },
      ],
    };
    const r1 = reconcileProviderInvoice(args);
    const r2 = reconcileProviderInvoice(args);
    expect(r2).toEqual(r1);
    expect(r1.adjustments.map(a => a.organization_id)).toEqual(['org-1', 'org-2']);
  });
});
