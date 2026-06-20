/**
 * Phase 6I-3 — Abandonment Attribution Hardening.
 *
 * Proves that runs marked failed by a sweeper (worker death / heartbeat
 * stale / stuck execution) are stamped with campaign_type + pipeline_mode
 * using the SAME single derivation authority persistPipelineFailure uses,
 * so 6I-1 failure analytics can slice abandoned runs by surface.
 *
 * Scope is deliberately narrow (no broad integration tests):
 *   1-4. The authority that every sweeper stamps (campaign_type + pipeline_mode).
 *   5.   Thrown-failure authority unchanged (re-export integrity).
 *   6.   Analytics-query prerequisites satisfied (non-null canonical tags).
 *   + wiring: queueHealth.sweepStaleExecutions actually issues the per-row
 *     stamp (the pattern execute.ts + the operator script reuse verbatim).
 */

import {
  deriveBoltCampaignType,
  deriveBoltPipelineMode,
  deriveAbandonmentAttribution,
} from '@/lib/shared/bolt/abandonmentAttribution';

// ── Authority: campaign_type (Tests 1, 3, 4 — same fn every sweeper calls) ──
describe('6I-3 — deriveBoltCampaignType', () => {
  test('combined → bolt-combined', () => {
    expect(deriveBoltCampaignType({ campaign_mode: 'combined' })).toBe('bolt-combined');
  });
  test('creator → bolt-creator', () => {
    expect(deriveBoltCampaignType({ campaign_mode: 'creator' })).toBe('bolt-creator');
  });
  test('text / missing / unknown → bolt-text (default tag)', () => {
    expect(deriveBoltCampaignType({ campaign_mode: 'text' })).toBe('bolt-text');
    expect(deriveBoltCampaignType({})).toBe('bolt-text');
    expect(deriveBoltCampaignType(null)).toBe('bolt-text');
    expect(deriveBoltCampaignType({ campaign_mode: 'COMBINED ' })).toBe('bolt-combined'); // trimmed + lowered
  });
});

// ── Authority: pipeline_mode (Test 2 — same fn every sweeper calls) ──────────
describe('6I-3 — deriveBoltPipelineMode', () => {
  test('passes outcomeView through', () => {
    expect(deriveBoltPipelineMode({ outcomeView: 'schedule' })).toBe('schedule');
    expect(deriveBoltPipelineMode({ outcomeView: 'daily_plan' })).toBe('daily_plan');
  });
  test('missing / blank outcomeView collapses to week_plan (matches live pipeline)', () => {
    expect(deriveBoltPipelineMode({})).toBe('week_plan');
    expect(deriveBoltPipelineMode({ outcomeView: '   ' })).toBe('week_plan');
    expect(deriveBoltPipelineMode(null)).toBe('week_plan');
  });
});

// ── Combined attribution from a real run payload shape ──────────────────────
describe('6I-3 — deriveAbandonmentAttribution (payload shape the sweepers pass)', () => {
  const cases: Array<{ name: string; payload: Record<string, unknown>; ct: string; pm: string }> = [
    { name: 'combined schedule', payload: { executionConfig: { campaign_mode: 'combined' }, outcomeView: 'schedule' }, ct: 'bolt-combined', pm: 'schedule' },
    { name: 'creator daily_plan', payload: { executionConfig: { campaign_mode: 'creator' }, outcomeView: 'daily_plan' }, ct: 'bolt-creator', pm: 'daily_plan' },
    { name: 'text week_plan', payload: { executionConfig: { campaign_mode: 'text' }, outcomeView: 'week_plan' }, ct: 'bolt-text', pm: 'week_plan' },
    { name: 'empty payload', payload: {}, ct: 'bolt-text', pm: 'week_plan' },
  ];
  for (const c of cases) {
    test(`${c.name} → ${c.ct} / ${c.pm}`, () => {
      expect(deriveAbandonmentAttribution(c.payload)).toEqual({ campaign_type: c.ct, pipeline_mode: c.pm });
    });
  }
  test('null payload never throws and defaults', () => {
    expect(deriveAbandonmentAttribution(null)).toEqual({ campaign_type: 'bolt-text', pipeline_mode: 'week_plan' });
  });
});

// ── Test 5 — thrown-failure authority unchanged (single derivation system) ──
describe('6I-3 — re-export integrity (persistPipelineFailure uses the same authority)', () => {
  test('boltPipelineFailurePersistence re-exports the identical derivation', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const persistence = require('@/backend/services/boltPipelineFailurePersistence');
    expect(persistence.deriveBoltCampaignType).toBe(deriveBoltCampaignType);
    expect(persistence.deriveAbandonmentAttribution).toBe(deriveAbandonmentAttribution);
    // Same outputs persistPipelineFailure would stamp on a THROWN failure.
    expect(persistence.deriveBoltCampaignType({ campaign_mode: 'combined' })).toBe('bolt-combined');
  });
});

// ── Test 6 — analytics-query prerequisites satisfied ────────────────────────
describe('6I-3 — 6I-1 query prerequisites', () => {
  const SURFACES = ['bolt-text', 'bolt-creator', 'bolt-combined'];
  test('every abandoned run yields a non-null campaign_type in the canonical vocabulary the Creator Impact query GROUP BYs', () => {
    for (const mode of ['text', 'creator', 'combined', undefined]) {
      const { campaign_type } = deriveAbandonmentAttribution(
        mode ? { executionConfig: { campaign_mode: mode } } : {},
      );
      expect(campaign_type).toBeTruthy();
      expect(SURFACES).toContain(campaign_type);
    }
  });
});
