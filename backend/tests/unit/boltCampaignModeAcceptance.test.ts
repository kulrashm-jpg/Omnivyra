/**
 * Regression tests for campaign_mode acceptance.
 *
 * Fixes the BOLT execution failure where the UI was sending
 * `campaign_mode: 'fast'` (and `'text_based'` / `'creator_dependent'`
 * from the recommendation-cards flow) — neither matched the canonical
 * vocabulary the pipeline + pre-execution validator expect.
 *
 * Locks in:
 *   - valid canonical values pass
 *   - the legacy `'fast'` mis-tag is rejected with a precise code
 *   - other unknowns (`'slow'`, `'turbo'`, '') are rejected
 *   - null / undefined behave as "mode not specified" (no error)
 *   - resolveCampaignMode coerces unknowns to the safe default ('text')
 *
 * The validator is exercised in isolation here — no live planner
 * or DB. The `checkCampaignVersion` flag is left off so the test is
 * fully synchronous and DB-free.
 */

import { validateBoltPreExecution } from '../../services/boltPreExecutionValidator';
import { resolveCampaignMode } from '../../../lib/shared/bolt/formatGovernance';
import { BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

function baseInput(modeOverride: unknown): {
  companyId: string;
  generatedCampaignId: null;
  sourceStrategicTheme: { title: string };
  executionConfig: Record<string, unknown>;
  outcomeView: 'week_plan';
  selectedPlatforms: string[];
} {
  const ec: Record<string, unknown> = {
    text_formats: ['post'],
    target_audience: 'devs',
    campaign_goal: 'awareness',
    frequency_per_week: 3,
    campaign_duration: 2,
    tentative_start: '2026-06-01',
  };
  if (modeOverride !== undefined) ec.campaign_mode = modeOverride;
  return {
    companyId: '11111111-1111-1111-1111-111111111111',
    generatedCampaignId: null,
    sourceStrategicTheme: { title: 'Test theme' },
    executionConfig: ec,
    outcomeView: 'week_plan',
    selectedPlatforms: ['linkedin'],
  };
}

describe('campaign_mode — VALID canonical values', () => {
  test.each(['text', 'creator', 'combined'])('campaign_mode=%s passes validator', async (mode) => {
    // For 'creator' / 'combined' modes the validator also requires a
    // creator format to satisfy the "at least one format selected" check.
    const input = baseInput(mode);
    if (mode === 'creator' || mode === 'combined') {
      (input.executionConfig as Record<string, unknown>).content_formats = ['carousel'];
      delete (input.executionConfig as Record<string, unknown>).text_formats;
    }
    const r = await validateBoltPreExecution(input);
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE)).toBe(false);
    expect(r.campaignMode).toBe(mode === 'creator' ? 'creator' : mode === 'combined' ? 'combined' : 'text');
  });
});

describe('campaign_mode — INVALID values from prior UI bugs', () => {
  test.each([
    'fast',         // the reported bug — useBoltStrategy.tsx pre-fix
    'slow',
    'turbo',
    'text_based',   // legacy display-tier value from TrendCampaignsRecommendationCards pre-fix
    'creator_dependent',
    'FAST',         // verify the literal isn't accidentally case-coerced away
  ])('campaign_mode=%s is rejected with STRATEGY_INVALID_CAMPAIGN_MODE', async (mode) => {
    const r = await validateBoltPreExecution(baseInput(mode));
    expect(r.ok).toBe(false);
    const code = r.errors.find((e) => e.field === 'campaign_mode')?.code
      ?? r.errors[0]?.code;
    expect(code).toBe(BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE);
  });
});

describe('campaign_mode — null / empty / undefined', () => {
  test('missing campaign_mode does not produce a mode-validation error', async () => {
    const r = await validateBoltPreExecution(baseInput(undefined));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE)).toBe(false);
  });
  test('null campaign_mode does not produce a mode-validation error', async () => {
    const r = await validateBoltPreExecution(baseInput(null));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE)).toBe(false);
  });
  test('empty-string campaign_mode does not produce a mode-validation error', async () => {
    const r = await validateBoltPreExecution(baseInput(''));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE)).toBe(false);
  });
});

describe('resolveCampaignMode — unknown values fall through to default text', () => {
  test.each([['fast', 'text'], ['turbo', 'text'], ['text_based', 'text'], ['unknown', 'text']])(
    'resolveCampaignMode(%s) → %s',
    (input, expected) => {
      // resolveCampaignMode itself is permissive (it's the OUTPUT side,
      // used to choose pipeline behavior), while the VALIDATOR is strict
      // (it's the INPUT side). The combination means a bad input is
      // rejected by the validator BEFORE resolveCampaignMode is asked
      // to interpret it, but if it ever slips past, the fallback is safe.
      expect(resolveCampaignMode({ campaign_mode: input })).toBe(expected);
    }
  );
});

describe('UI payload-generation — verifies the post-fix payload shapes', () => {
  // These reproduce the exact field shapes the two UI sites build,
  // post-fix, and confirm they pass the validator.

  test('useBoltStrategy.tsx post-fix payload passes', async () => {
    const ec = {
      target_audience: 'data scientists',
      content_depth: 'standard',
      frequency_per_week: 3,
      format_frequency: { post: 3 },
      campaign_duration: 2,
      tentative_start: '2026-06-01',
      campaign_goal: 'awareness',
      campaign_goals: ['awareness'],
      // Post-fix value — was 'fast' pre-fix.
      campaign_mode: 'text',
      communication_style: ['professional'],
      tone: 'professional',
      content_formats: ['post'],
    };
    const r = await validateBoltPreExecution({
      companyId: '11111111-1111-1111-1111-111111111111',
      generatedCampaignId: null,
      sourceStrategicTheme: { title: 'T' },
      executionConfig: ec,
      outcomeView: 'week_plan',
      selectedPlatforms: ['linkedin'],
    });
    expect(r.ok).toBe(true);
  });

  test('TrendCampaignsRecommendationCards.tsx post-fix payload passes', async () => {
    // The new ternary at the call site emits 'text' for the 'text_based'
    // UI default — verify the producer of that derived value passes.
    const uiValue: 'text_based' | 'creator_dependent' = 'text_based';
    const normalized = uiValue === 'creator_dependent' ? 'creator' : 'text';
    const r = await validateBoltPreExecution({
      companyId: '11111111-1111-1111-1111-111111111111',
      generatedCampaignId: null,
      sourceStrategicTheme: { title: 'T' },
      executionConfig: {
        target_audience: 'devs',
        content_depth: 'standard',
        frequency_per_week: 3,
        campaign_duration: 2,
        tentative_start: '2026-06-01',
        campaign_goal: 'awareness',
        campaign_mode: normalized,
        content_formats: ['post'],
      },
      outcomeView: 'week_plan',
      selectedPlatforms: ['linkedin'],
    });
    expect(r.ok).toBe(true);
    expect(r.campaignMode).toBe('text');
  });
});
